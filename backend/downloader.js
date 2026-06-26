/**
 * Downloader Module
 * 
 * This module coordinates external download tools and fallback mechanisms to download 
 * media from various platforms.
 * 
 * Download Fallback Chain:
 * 1. For standard posts, we first attempt to download using `yt-dlp`.
 * 2. If `yt-dlp` metadata extraction fails or download fails, we automatically fall back 
 *    to `gallery-dl` via `downloadWithGalleryDl`.
 * 3. Special Handlers:
 *    - TikTok photo slideshows are automatically routed to `gallery-dl` with slideshow-specific prefixes.
 *    - VSCO URLs are directly handled. If `gallery-dl` fails due to user-agent blocking or format errors, 
 *      the module automatically executes `downloadVscoDirect` or `downloadVscoGalleryDirect` fallback methods, 
 *      which perform scraping using curl_cffi / browser fetch emulation scripts to bypass rate/WAF blocks.
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { dbRun, dbGet } from './database.js';
import { createVideoArchiveBase } from './archive-naming.js';
import {
  extractUsername as extractNormalizedUsername,
  isTikTokUrl,
  requireTikTokUsername,
} from './identity.js';
import { logger } from './logger.js';
import { createVideoThumbnail } from './thumbnails.js';
import {
  isMediaFile,
  isImageFile,
  isVideoFile,
  isAudioFile,
  collectMediaFiles,
  inferTypeFromFiles,
  setMediaDates,
  MEDIA_EXTENSIONS,
  getExtensionFromUrl,
  listFiles,
} from './utils/media-files.js';
import { toWebPath, safeSegment } from './utils/path-utils.js';
import { buildBrowserVideoArgs } from './yt-dlp-options.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOWNLOADS_DIR =
  process.env.DOWNLOADS_DIR || path.join(__dirname, '../downloads');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const COOKIES_PATH = path.join(DATA_DIR, 'cookies.txt');
const VSCO_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:139.0) Gecko/20100101 Firefox/139.0';
const VSCO_REQUEST_HEADERS = {
  'User-Agent': VSCO_USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://vsco.co/',
};
const GALLERY_DL_DEFAULT_FILENAME = '{id}.{extension}';
const VSCO_FETCH_SCRIPT = String.raw`
import os
import sys
from curl_cffi import requests

mode = sys.argv[1]
url = sys.argv[2]
referer = sys.argv[3]
output_path = sys.argv[4] if len(sys.argv) > 4 else ""
accept = os.environ.get("VSCO_FETCH_ACCEPT") or ("text/html,application/xhtml+xml" if mode == "page" else "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.8")
headers = {
    "User-Agent": os.environ.get("VSCO_USER_AGENT", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:139.0) Gecko/20100101 Firefox/139.0"),
    "Accept": accept,
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": referer,
}
if os.environ.get("VSCO_AUTHORIZATION"):
    headers["Authorization"] = os.environ["VSCO_AUTHORIZATION"]
if os.environ.get("VSCO_CLIENT_PLATFORM"):
    headers["X-Client-Platform"] = os.environ["VSCO_CLIENT_PLATFORM"]
if os.environ.get("VSCO_CLIENT_BUILD"):
    headers["X-Client-Build"] = os.environ["VSCO_CLIENT_BUILD"]
response = requests.get(
    url,
    headers=headers,
    impersonate=os.environ.get("VSCO_IMPERSONATE", "chrome124"),
    timeout=float(os.environ.get("VSCO_FETCH_TIMEOUT", "30")),
    allow_redirects=True,
)
if response.status_code >= 400:
    sys.stderr.write(f"VSCO browser fetch failed: HTTP {response.status_code} {response.url}\n")
    sys.exit(2)
if mode in ("page", "json"):
    sys.stdout.write(response.text)
elif mode == "download":
    if not output_path:
        sys.stderr.write("Output path is required for download mode\n")
        sys.exit(3)
    with open(output_path, "wb") as file:
        file.write(response.content)
else:
    sys.stderr.write(f"Unsupported mode: {mode}\n")
    sys.exit(4)
`;

export const extractUsername = extractNormalizedUsername;

const registerProcess = (proc, options = {}) => {
  if (typeof options.onProcess === 'function') {
    options.onProcess(proc);
  }
};

const hasCookies = () =>
  fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 0;

const hashValue = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

const getHostname = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return 'unknown-source';
  }
};

const isVscoUrl = (url) => /(^|\.)vsco\.co$/i.test(getHostname(url));

const getVscoUser = (url) => {
  try {
    return (
      new URL(url).pathname.split('/').filter(Boolean)[0]?.toLowerCase() || ''
    );
  } catch {
    return '';
  }
};

const getVscoMediaId = (url) => {
  try {
    return new URL(url).pathname.match(/\/media\/([0-9a-fA-F]+)/)?.[1] || '';
  } catch {
    return '';
  }
};

const isVscoMediaUrl = (url) => Boolean(getVscoMediaId(url));

const getVscoGalleryUrl = (url) => {
  const user = getVscoUser(url);
  return user ? `https://vsco.co/${user}/gallery` : url;
};

const sourceIdFromUrl = (url, metadata = {}) => {
  if (isTikTokUrl(url) || isTikTokUrl(metadata.webpage_url || '')) {
    return requireTikTokUsername(url, metadata);
  }
  if (isVscoUrl(url)) {
    return getVscoUser(url) || getHostname(url);
  }
  return safeSegment(
    metadata.uploader ||
      metadata.channel ||
      metadata.extractor_key ||
      getHostname(url),
    'source',
  );
};

const sourceUrlFromId = (channelId, url) => {
  if (channelId.startsWith('@')) return `https://www.tiktok.com/${channelId}`;
  const hostname = getHostname(url);
  return hostname === 'unknown-source' ? url : `https://${hostname}`;
};

const createPostId = (url, metadata = {}) => {
  if (
    (isTikTokUrl(url) || isTikTokUrl(metadata.webpage_url || '')) &&
    metadata.id
  ) {
    return String(metadata.id);
  }
  if (isVscoUrl(url)) {
    const mediaId = getVscoMediaId(url) || metadata.id;
    if (mediaId) return `vsco_${safeSegment(mediaId)}`.slice(0, 160);
  }
  const extractor = safeSegment(
    metadata.extractor_key || getHostname(url),
    'media',
  );
  const id = safeSegment(metadata.id || hashValue(url), hashValue(url));
  return `${extractor}_${id}`.slice(0, 160);
};

const uploadDateFromMetadata = (metadata = {}) => {
  const rawDate = metadata.upload_date;
  if (rawDate && String(rawDate).length === 8) {
    const value = String(rawDate);
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (metadata.timestamp) {
    const date = new Date(metadata.timestamp * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
};

const ensureSourceChannel = async ({ channelId, url }) => {
  const channelExists = await dbGet('SELECT id FROM channels WHERE id = ?', [
    channelId,
  ]);
  if (channelExists) return;

  await dbRun(
    'INSERT INTO channels (id, username, url, created_at, is_monitored) VALUES (?, ?, ?, ?, 0)',
    [
      channelId,
      channelId.replace(/^@/, ''),
      sourceUrlFromId(channelId, url),
      new Date().toISOString(),
    ],
  );
};

const savePost = async (postData) => {
  await ensureSourceChannel({
    channelId: postData.channel_id,
    url: postData.url,
  });

  await dbRun(
    `INSERT OR REPLACE INTO posts
     (id, channel_id, type, title, description, url, upload_date, file_path, thumbnail_path, downloaded_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      postData.id,
      postData.channel_id,
      postData.type,
      postData.title,
      postData.description,
      postData.url,
      postData.upload_date,
      postData.file_path,
      postData.thumbnail_path,
      postData.downloaded_at,
      postData.metadata_json,
    ],
  );
};

const DEFAULT_DOWNLOAD_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
const DOWNLOAD_TIMEOUT_MS = process.env.DOWNLOAD_TIMEOUT_MS 
  ? parseInt(process.env.DOWNLOAD_TIMEOUT_MS, 10) 
  : DEFAULT_DOWNLOAD_TIMEOUT;

/**
 * Consolidate execution of external child processes with standard logging, timeout,
 * and registration options.
 */
const runProcess = ({
  command,
  args,
  label,
  postId = null,
  options = {},
  env = {},
  onStdout = null,
  captureStdout = false,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
}) => {
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) {
      return reject(new Error(`${label} execution was aborted before start.`));
    }

    const mergedEnv = { ...process.env, ...env };
    const proc = spawn(command, args, { env: mergedEnv });
    registerProcess(proc, options);

    let stdout = '';
    let stderr = '';
    let timeoutTimer = null;
    let aborted = false;

    // Set up AbortSignal handling if provided
    const abortHandler = () => {
      aborted = true;
      cleanupAndKill('SIGTERM');
      reject(new Error(`${label} execution aborted via signal.`));
    };
    if (signal) {
      signal.addEventListener('abort', abortHandler);
    }

    // Set up timeout handling
    if (timeoutMs && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        aborted = true;
        cleanupAndKill('SIGKILL');
        const err = new Error(`${label} execution timed out after ${timeoutMs / 1000} seconds.`);
        err.code = 'ETIMEDOUT';
        reject(err);
      }, timeoutMs);
    }

    const cleanupAndKill = (killSignal = 'SIGTERM') => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      if (!proc.killed) {
        proc.kill(killSignal);
      }
    };

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      if (captureStdout) {
        stdout += text;
      }
      if (postId) {
        logger.info(`${label} stdout`, { post_id: postId, output: text.trim() });
      }
      if (onStdout) {
        onStdout(text);
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (postId) {
        logger.warn(`${label} stderr`, { post_id: postId, output: text.trim() });
      }
    });

    proc.on('error', (error) => {
      cleanupAndKill();
      if (!aborted) reject(error);
    });

    proc.on('close', (code, procSignal) => {
      cleanupAndKill();
      if (aborted) return; // Promise already settled by timeout or abort

      if (code !== 0) {
        const errMsg = stderr.trim() || `${label} failed${procSignal ? ` (${procSignal})` : ` (code ${code})`}`;
        reject(new Error(errMsg));
      } else {
        resolve(captureStdout ? stdout : undefined);
      }
    });
  });
};

const spawnTool = ({ command, args, label, postId, options, onStdout }) =>
  runProcess({
    command,
    args,
    label,
    postId,
    options,
    onStdout,
    captureStdout: false,
  });

const spawnCapture = ({ command, args, label, options, env = {} }) =>
  runProcess({
    command,
    args,
    label,
    options,
    env,
    captureStdout: true,
  });

const runVscoBrowserFetch = async ({
  mode,
  url,
  referer,
  outputPath = '',
  options,
  accept,
  authorization,
}) => {
  const args = ['-c', VSCO_FETCH_SCRIPT, mode, url, referer, outputPath];
  const env = {
    VSCO_USER_AGENT,
    ...(accept ? { VSCO_FETCH_ACCEPT: accept } : {}),
    ...(authorization
      ? {
          VSCO_AUTHORIZATION: authorization,
          VSCO_CLIENT_PLATFORM: 'web',
          VSCO_CLIENT_BUILD: '1',
        }
      : {}),
  };

  try {
    return await spawnCapture({
      command: 'python3',
      args,
      label: 'VSCO browser fetch',
      options,
      env,
    });
  } catch (error) {
    if (!/curl_cffi|No module named/i.test(error.message)) throw error;
    return spawnCapture({
      command: 'uv',
      args: ['run', '--with', 'curl-cffi', 'python', ...args],
      label: 'VSCO browser fetch via uv',
      options,
      env,
    });
  }
};

const normalizeVscoMediaUrl = (media = {}) => {
  if ((media.isVideo || media.is_video) && (media.videoUrl || media.video_url))
    return String(media.videoUrl || media.video_url);
  if (media.playbackUrl || media.playback_url)
    return String(media.playbackUrl || media.playback_url);
  const rawUrl =
    media.responsiveUrl ||
    media.responsive_url ||
    media.posterUrl ||
    media.poster_url;
  if (!rawUrl) return '';
  if (rawUrl.startsWith('http')) return rawUrl;
  const base = rawUrl.replace(/^\/\//, '');
  const [cdn, ...rest] = base.split('/');
  const mediaPath = rest.join('/');
  if (cdn.startsWith('aws')) return `https://image-${cdn}.vsco.co/${mediaPath}`;
  if (/^\d+$/.test(cdn)) return `https://image.vsco.co/${base}`;
  return `https://${base}`;
};

const extractVscoPreloadedState = (html) => {
  const marker = '__PRELOADED_STATE__ = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('VSCO page did not include preload state');
  const afterMarker = html.slice(start + marker.length);
  const end = afterMarker.indexOf('</script>');
  const rawJson = (end === -1 ? afterMarker : afterMarker.slice(0, end))
    .trim()
    .replace(/;$/, '')
    .replaceAll('":undefined', '":null');
  return JSON.parse(rawJson);
};

const fetchVscoPage = async (url, options = {}) => {
  const res = await fetch(url, {
    headers: VSCO_REQUEST_HEADERS,
    redirect: 'follow',
  });
  const html = await res.text();
  if (res.ok && html.includes('__PRELOADED_STATE__')) return html;

  try {
    return await runVscoBrowserFetch({
      mode: 'page',
      url,
      referer: `https://vsco.co/${getVscoUser(url) || ''}`,
      options,
      accept: VSCO_REQUEST_HEADERS.Accept,
    });
  } catch (error) {
    const reason = res.ok
      ? 'missing preload state'
      : `${res.status} ${res.statusText}`;
    throw new Error(
      `VSCO page request failed (${reason}); browser fallback failed: ${error.message}`,
    );
  }
};

const downloadVscoAsset = async ({
  mediaUrl,
  filePath,
  referer,
  isVideo,
  options,
}) => {
  const accept = isVideo
    ? 'video/mp4,video/*;q=0.9,*/*;q=0.8'
    : 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.8';
  const res = await fetch(mediaUrl, {
    headers: {
      ...VSCO_REQUEST_HEADERS,
      Accept: accept,
      Referer: referer,
    },
    redirect: 'follow',
  });

  if (res.ok && res.body) {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(filePath));
    return;
  }

  await runVscoBrowserFetch({
    mode: 'download',
    url: mediaUrl,
    referer,
    outputPath: filePath,
    options,
    accept,
  });
};

const downloadVscoDirect = async ({ url, itemDir, postId, options }) => {
  const html = await fetchVscoPage(url, options);
  const state = extractVscoPreloadedState(html);
  const mediaEntry = Object.values(state?.medias?.byId || {})[0];
  const media = mediaEntry?.media || mediaEntry;
  if (!media) throw new Error('VSCO page did not include media metadata');

  const mediaUrl = normalizeVscoMediaUrl(media);
  if (!mediaUrl)
    throw new Error('VSCO media metadata did not include a downloadable URL');

  const isVideo = Boolean(media.isVideo || media.videoUrl || media.playbackUrl);
  const extension = getExtensionFromUrl(mediaUrl, isVideo ? '.mp4' : '.jpg');
  const filePath = path.join(
    itemDir,
    `${safeSegment(media.id || postId)}${extension}`,
  );
  await downloadVscoAsset({
    mediaUrl,
    filePath,
    referer: url,
    isVideo,
    options,
  });
  return {
    media,
    filePath,
  };
};

const unwrapVscoMedia = (item = {}) => {
  if (item.media) return item.media;
  if (item.image) return item.image;
  if (item.video) return item.video;
  if (item.type && item[item.type]) return item[item.type];
  return item;
};

const getVscoMediaUploadDate = (media = {}) => {
  const raw =
    media.uploadDate ||
    media.upload_date ||
    media.createdDate ||
    media.created_date ||
    media.captureDate ||
    media.capture_date;
  if (!raw) return '';
  const date = new Date(Number(raw));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const getVscoPreloadedMedia = (state = {}) =>
  [
    ...Object.values(state?.medias?.byId || {}).map(unwrapVscoMedia),
    ...Object.values(state?.entities?.images || {}),
    ...Object.values(state?.entities?.videos || {}),
  ].filter((media) => media && normalizeVscoMediaUrl(media));

const uniqueVscoMedia = (items) => {
  const seen = new Set();
  return items.filter((media) => {
    const key = String(media.id || media._id || normalizeVscoMediaUrl(media));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fetchVscoGalleryApiPage = async ({
  apiUrl,
  galleryUrl,
  token,
  options,
}) => {
  const text = await runVscoBrowserFetch({
    mode: 'json',
    url: apiUrl,
    referer: galleryUrl,
    options,
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  });
  return JSON.parse(text);
};

const downloadVscoGalleryDirect = async ({
  url,
  itemDir,
  options,
  onProgress,
}) => {
  const galleryUrl = getVscoGalleryUrl(url);
  const user = getVscoUser(url);
  const html = await fetchVscoPage(galleryUrl, options);
  const state = extractVscoPreloadedState(html);
  const token = state?.users?.currentUser?.tkn;
  const site = state?.sites?.siteByUsername?.[user]?.site;
  const siteId = site?.id;
  let mediaItems = getVscoPreloadedMedia(state);

  if (token && siteId) {
    let cursor = '';
    let page = 0;
    const maxPages = Number.parseInt(
      process.env.VSCO_DIRECT_GALLERY_MAX_PAGES || '250',
      10,
    );

    try {
      do {
        const params = new URLSearchParams({
          site_id: String(siteId),
          limit: '30',
        });
        if (cursor) params.set('cursor', cursor);
        const apiUrl = `https://vsco.co/api/3.0/medias/profile?${params.toString()}`;
        const data = await fetchVscoGalleryApiPage({
          apiUrl,
          galleryUrl,
          token,
          options,
        });
        const pageMedia = (data.media || data.medias || []).map(
          unwrapVscoMedia,
        );
        mediaItems = mediaItems.concat(pageMedia);
        cursor = data.next_cursor || '';
        page += 1;
        onProgress?.(
          35,
          `Fetched VSCO gallery page ${page} with ${pageMedia.length} items...`,
        );
      } while (cursor && page < maxPages);
    } catch (error) {
      logger.warn(
        'VSCO gallery API fallback failed; using preloaded gallery media',
        { url, error },
      );
    }
  }

  mediaItems = uniqueVscoMedia(mediaItems);
  if (mediaItems.length === 0) {
    throw new Error('VSCO gallery fallback did not find downloadable media');
  }

  let downloaded = 0;
  for (const media of mediaItems) {
    const mediaUrl = normalizeVscoMediaUrl(media);
    if (!mediaUrl) continue;
    const mediaId = safeSegment(media.id || media._id || hashValue(mediaUrl));
    const isVideo = Boolean(
      media.isVideo ||
      media.is_video ||
      media.videoUrl ||
      media.video_url ||
      media.playbackUrl ||
      media.playback_url,
    );
    const extension = getExtensionFromUrl(mediaUrl, isVideo ? '.mp4' : '.jpg');
    const filePath = path.join(itemDir, `${mediaId}${extension}`);
    await downloadVscoAsset({
      mediaUrl,
      filePath,
      referer: galleryUrl,
      isVideo,
      options,
    });
    downloaded += 1;
    onProgress?.(
      35 + Math.min(40, Math.round((downloaded / mediaItems.length) * 40)),
      `Downloaded ${downloaded}/${mediaItems.length} VSCO gallery items...`,
    );
  }

  return {
    mediaCount: mediaItems.length,
    downloaded,
    firstUploadDate: getVscoMediaUploadDate(mediaItems[0]),
    site,
  };
};

// Fetch post metadata from yt-dlp without downloading
export const getMetadata = async (url, options = {}) => {
  const args = ['--dump-json', '--skip-download', '--no-warnings'];
  if (hasCookies()) args.push('--cookies', COOKIES_PATH);
  args.push(url);

  const stdout = await runProcess({
    command: 'yt-dlp',
    args,
    label: 'yt-dlp metadata',
    options,
    captureStdout: true,
  });

  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`Failed to parse metadata JSON: ${e.message}`);
  }
};

// Fetch all video entries in a profile (flat-playlist scan)
export const scanProfile = async (profileUrl, options = {}) => {
  const args = ['--flat-playlist', '--dump-json', '--no-warnings'];
  if (hasCookies()) args.push('--cookies', COOKIES_PATH);
  args.push(profileUrl);

  const stdout = await runProcess({
    command: 'yt-dlp',
    args,
    label: 'yt-dlp profile scan',
    options,
    captureStdout: true,
  });

  try {
    const lines = stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim() !== '');
    return lines.map((line) => JSON.parse(line));
  } catch (e) {
    throw new Error(`Failed to parse profile scan output: ${e.message}`);
  }
};

const buildPostData = ({
  id,
  channelId,
  type,
  title,
  description,
  url,
  uploadDate,
  filePath,
  thumbnailPath,
  metadata,
}) => ({
  id,
  channel_id: channelId,
  type,
  title,
  description,
  url,
  upload_date: uploadDate,
  file_path: filePath,
  thumbnail_path: thumbnailPath,
  downloaded_at: new Date().toISOString(),
  metadata_json: JSON.stringify(metadata),
});

export const downloadWithGalleryDl = async (
  url,
  onProgress,
  options,
  context = {},
) => {
  const postId = context.postId || createPostId(url, context.metadata);
  const channelId = context.channelId || sourceIdFromUrl(url, context.metadata);
  const uploadDate =
    context.uploadDate || uploadDateFromMetadata(context.metadata);
  const title =
    context.title || context.metadata?.title || `${getHostname(url)} media`;
  const description =
    context.description || context.metadata?.description || title;
  const sourceDir = safeSegment(channelId);
  const postPrefix = safeSegment(`${channelId}_${postId}`);
  const itemDirName = channelId.startsWith('@')
    ? postPrefix
    : safeSegment(postId);
  const itemDir = path.join(DOWNLOADS_DIR, sourceDir, itemDirName);

  fs.mkdirSync(itemDir, { recursive: true });
  onProgress(
    20,
    `Downloading media with gallery-dl${isVscoUrl(url) ? ' using VSCO settings' : ''}...`,
  );

  const filenameFormat =
    context.preferredType === 'slideshow' && channelId.startsWith('@')
      ? `${postPrefix}_image_{num}.{extension}`
      : context.filenameFormat || GALLERY_DL_DEFAULT_FILENAME;
  const galleryArgs = [
    '--directory',
    itemDir,
    '--filename',
    filenameFormat,
    '--no-input',
  ];

  if (isVscoUrl(url)) {
    galleryArgs.push(
      '-o',
      'extractor.vsco.browser=firefox',
      '-o',
      `extractor.vsco.headers.User-Agent=${VSCO_USER_AGENT}`,
      '-o',
      `extractor.vsco.headers.Accept=${VSCO_REQUEST_HEADERS.Accept}`,
      '-o',
      `extractor.vsco.headers.Accept-Language=${VSCO_REQUEST_HEADERS['Accept-Language']}`,
      '-o',
      `extractor.vsco.headers.Referer=https://vsco.co/${getVscoUser(url) || ''}`,
    );
  }
  if (hasCookies()) {
    galleryArgs.push('--cookies', COOKIES_PATH);
  }
  galleryArgs.push(url);

  let toolError = null;
  try {
    await spawnTool({
      command: 'gallery-dl',
      args: galleryArgs,
      label: 'gallery-dl',
      postId,
      options,
    });
  } catch (error) {
    toolError = error;
    if (isVscoUrl(url)) {
      logger.warn('gallery-dl VSCO download failed; trying direct fallback', {
        post_id: postId,
        error,
      });
      onProgress(
        35,
        'gallery-dl was blocked by VSCO. Trying VSCO direct fallback...',
      );
      try {
        if (isVscoMediaUrl(url)) {
          const fallback = await downloadVscoDirect({
            url,
            itemDir,
            postId,
            options,
          });
          context.metadata = {
            ...(context.metadata || {}),
            vsco_direct_media: fallback.media,
          };
        } else {
          const fallback = await downloadVscoGalleryDirect({
            url,
            itemDir,
            options,
            onProgress,
          });
          context.metadata = {
            ...(context.metadata || {}),
            vsco_direct_gallery: fallback,
          };
        }
        toolError = null;
      } catch (fallbackError) {
        toolError = fallbackError;
      }
    }
  }

  const files = collectMediaFiles(itemDir);
  if (files.length === 0) {
    throw new Error(
      `gallery-dl failed to download any supported media. Error: ${toolError?.message || 'No media files found'}`,
    );
  }

  onProgress(80, 'Preserving file dates...');
  setMediaDates(files, uploadDate);

  const type = inferTypeFromFiles(files, context.preferredType);
  const finalFilePath =
    files.length === 1
      ? toWebPath(DOWNLOADS_DIR, files[0])
      : toWebPath(DOWNLOADS_DIR, itemDir);
  const firstImage = files.find(isImageFile);
  const finalThumbnailPath = firstImage
    ? toWebPath(DOWNLOADS_DIR, firstImage)
    : '';
  const metadata = {
    ...(context.metadata || {}),
    downloader:
      context.metadata?.vsco_direct_gallery ||
      context.metadata?.vsco_direct_media
        ? 'gallery-dl+vsco-direct-fallback'
        : 'gallery-dl',
    gallery_dl_filename: filenameFormat,
    gallery_dl_tls12: isVscoUrl(url) ? true : undefined,
    vsco_user: isVscoUrl(url) ? getVscoUser(url) : undefined,
    vsco_media_id: isVscoUrl(url) ? getVscoMediaId(url) : undefined,
    yt_dlp_error: context.ytDlpError,
    media_files: files.map((f) => toWebPath(DOWNLOADS_DIR, f)),
  };

  onProgress(90, 'Saving media metadata to database...');
  const postData = buildPostData({
    id: postId,
    channelId,
    type,
    title,
    description,
    url,
    uploadDate,
    filePath: finalFilePath,
    thumbnailPath: finalThumbnailPath,
    metadata,
  });
  await savePost(postData);

  logger.info('gallery downloader completed', {
    post_id: postId,
    channel_id: channelId,
    files: files.length,
  });
  onProgress(100, 'Success');
  return postData;
};

const downloadWithYtDlp = async (url, metadata, onProgress, options) => {
  const postId = createPostId(url, metadata);
  const channelId = sourceIdFromUrl(url, metadata);
  const uploadDate = uploadDateFromMetadata(metadata);
  const title = metadata.title || `${getHostname(url)} media`;
  const description = metadata.description || title;
  const channelDir = path.join(DOWNLOADS_DIR, safeSegment(channelId));
  const outputBase = createVideoArchiveBase({
    creator: channelId,
    uploadDate,
    postId,
  });

  fs.mkdirSync(channelDir, { recursive: true });
  onProgress(20, 'Downloading media with yt-dlp...');

  const outTemplate = path.join(channelDir, `${outputBase}.%(ext)s`);
  const ytArgs = buildBrowserVideoArgs(outTemplate);

  if (hasCookies()) {
    ytArgs.push('--cookies', COOKIES_PATH);
  }
  ytArgs.push(url);

  await spawnTool({
    command: 'yt-dlp',
    args: ytArgs,
    label: 'yt-dlp',
    postId,
    options,
    onStdout: (text) => {
      const match = text.match(/(\d+(?:\.\d+)?)%/);
      if (match) {
        const percent = parseFloat(match[1]);
        const jobProgress = Math.round(20 + percent * 0.6);
        onProgress(jobProgress, `Downloading media: ${percent}%`);
      }
    },
  });

  onProgress(80, 'Preserving file dates...');
  const files = collectMediaFiles(channelDir).filter((file) =>
    path.basename(file).startsWith(outputBase),
  );
  const primaryFile =
    files.find(isVideoFile) ||
    files.find(isImageFile) ||
    files.find(isAudioFile);

  if (!primaryFile) {
    throw new Error(
      `yt-dlp completed but no supported output media was found under: ${outputBase}`,
    );
  }

  setMediaDates(files, uploadDate);
  const type = inferTypeFromFiles([primaryFile]);
  const firstImage = files.find(isImageFile);
  let generatedThumbnail = '';
  if (!firstImage && isVideoFile(primaryFile)) {
    try {
      generatedThumbnail = await createVideoThumbnail(
        primaryFile,
        DOWNLOADS_DIR,
      );
    } catch (error) {
      logger.warn('video thumbnail generation failed during download', {
        post_id: postId,
        error,
      });
    }
  }
  const postData = buildPostData({
    id: postId,
    channelId,
    type,
    title,
    description,
    url,
    uploadDate,
    filePath: toWebPath(DOWNLOADS_DIR, primaryFile),
    thumbnailPath:
      firstImage && firstImage !== primaryFile
        ? toWebPath(DOWNLOADS_DIR, firstImage)
        : isImageFile(primaryFile)
          ? toWebPath(DOWNLOADS_DIR, primaryFile)
          : generatedThumbnail,
    metadata: {
      ...metadata,
      downloader: 'yt-dlp',
      media_files: files.map((f) => toWebPath(DOWNLOADS_DIR, f)),
    },
  });

  onProgress(90, 'Saving media metadata to database...');
  await savePost(postData);

  logger.info('yt-dlp downloader completed', {
    post_id: postId,
    channel_id: channelId,
  });
  onProgress(100, 'Success');
  return postData;
};

// Main download handler for a specific URL
export const downloadPost = async (
  url,
  onProgress = () => {},
  options = {},
) => {
  logger.info('downloader started', { url });

  const duplicateByUrl = await dbGet('SELECT * FROM posts WHERE url = ?', [
    url,
  ]);
  if (duplicateByUrl) {
    logger.info('downloader skipped duplicate URL', {
      post_id: duplicateByUrl.id,
    });
    onProgress(100, 'Duplicate skipped.');
    return duplicateByUrl;
  }

  if (isVscoUrl(url)) {
    return downloadWithGalleryDl(url, onProgress, options);
  }

  onProgress(5, 'Fetching media metadata with yt-dlp...');
  let metadata;
  try {
    metadata = await getMetadata(url, options);
  } catch (error) {
    logger.warn('yt-dlp metadata failed; falling back to gallery-dl', {
      url,
      error,
    });
    onProgress(15, 'yt-dlp could not extract this URL. Trying gallery-dl...');
    return downloadWithGalleryDl(url, onProgress, options, {
      ytDlpError: error.message,
    });
  }

  const postId = createPostId(url, metadata);
  const duplicate = await dbGet('SELECT * FROM posts WHERE id = ?', [postId]);
  if (duplicate) {
    logger.info('downloader skipped duplicate media item', { post_id: postId });
    onProgress(100, 'Duplicate skipped.');
    return duplicate;
  }

  const isSlideshow =
    (metadata.webpage_url && metadata.webpage_url.includes('/photo/')) ||
    (metadata.vcodec === 'none' &&
      (!metadata.formats || metadata.formats.length <= 1));

  if (isSlideshow) {
    return downloadWithGalleryDl(url, onProgress, options, {
      metadata,
      postId,
      channelId: sourceIdFromUrl(url, metadata),
      preferredType: 'slideshow',
      filenameFormat: 'image_{num}.{extension}',
      uploadDate: uploadDateFromMetadata(metadata),
      title: metadata.title || '',
      description: metadata.description || metadata.title || '',
    });
  }

  try {
    return await downloadWithYtDlp(url, metadata, onProgress, options);
  } catch (error) {
    if (isTikTokUrl(url)) throw error;
    logger.warn('yt-dlp download failed; falling back to gallery-dl', {
      url,
      error,
    });
    onProgress(20, 'yt-dlp download failed. Trying gallery-dl...');
    return downloadWithGalleryDl(url, onProgress, options, {
      metadata,
      postId,
      channelId: sourceIdFromUrl(url, metadata),
      uploadDate: uploadDateFromMetadata(metadata),
      title: metadata.title || '',
      description: metadata.description || metadata.title || '',
      ytDlpError: error.message,
    });
  }
};
