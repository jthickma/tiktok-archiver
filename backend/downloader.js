import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbRun, dbGet } from './database.js';
import { extractUsername as extractNormalizedUsername, isTikTokUrl } from './identity.js';
import { logger } from './logger.js';
import { createVideoThumbnail } from './thumbnails.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(__dirname, '../downloads');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const COOKIES_PATH = path.join(DATA_DIR, 'cookies.txt');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus']);
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

export const extractUsername = extractNormalizedUsername;

const registerProcess = (proc, options = {}) => {
  if (typeof options.onProcess === 'function') {
    options.onProcess(proc);
  }
};

const hasCookies = () => fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 0;

const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

const safeSegment = (value, fallback = 'download') => {
  const clean = String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9@._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return clean || fallback;
};

const toWebPath = (fullPath) => path.relative(DOWNLOADS_DIR, fullPath).split(path.sep).join('/');

const getHostname = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return 'unknown-source';
  }
};

const isVscoUrl = (url) => /(^|\.)vsco\.co$/i.test(getHostname(url));

const sourceIdFromUrl = (url, metadata = {}) => {
  if (isTikTokUrl(url) || isTikTokUrl(metadata.webpage_url || '')) {
    return extractUsername(url, metadata);
  }
  return safeSegment(metadata.uploader || metadata.channel || metadata.extractor_key || getHostname(url), 'source');
};

const sourceUrlFromId = (channelId, url) => {
  if (channelId.startsWith('@')) return `https://www.tiktok.com/${channelId}`;
  const hostname = getHostname(url);
  return hostname === 'unknown-source' ? url : `https://${hostname}`;
};

const createPostId = (url, metadata = {}) => {
  if ((isTikTokUrl(url) || isTikTokUrl(metadata.webpage_url || '')) && metadata.id) {
    return String(metadata.id);
  }
  const extractor = safeSegment(metadata.extractor_key || getHostname(url), 'media');
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

const listFiles = (rootDir) => {
  if (!fs.existsSync(rootDir)) return [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory() && entry.name === '.thumbnails') return [];
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
};

const isMediaFile = (filePath) => MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase());
const isImageFile = (filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
const isVideoFile = (filePath) => VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
const isAudioFile = (filePath) => AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const collectMediaFiles = (rootDir) => listFiles(rootDir)
  .filter((filePath) => isMediaFile(filePath) && !filePath.endsWith('.part'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const inferTypeFromFiles = (files, preferredType = '') => {
  if (preferredType === 'slideshow') return 'slideshow';
  if (files.length > 1) return 'gallery';
  const file = files[0] || '';
  if (isVideoFile(file)) return 'video';
  if (isImageFile(file)) return 'image';
  if (isAudioFile(file)) return 'audio';
  return preferredType || 'media';
};

const setMediaDates = (files, uploadDate) => {
  const mTime = new Date(uploadDate);
  if (Number.isNaN(mTime.getTime())) return;
  for (const file of files) {
    fs.utimesSync(file, mTime, mTime);
  }
};

const ensureSourceChannel = async ({ channelId, url }) => {
  const channelExists = await dbGet('SELECT id FROM channels WHERE id = ?', [channelId]);
  if (channelExists) return;

  await dbRun(
    'INSERT INTO channels (id, username, url, created_at, is_monitored) VALUES (?, ?, ?, ?, 0)',
    [channelId, channelId.replace(/^@/, ''), sourceUrlFromId(channelId, url), new Date().toISOString()]
  );
};

const savePost = async (postData) => {
  await ensureSourceChannel({ channelId: postData.channel_id, url: postData.url });

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
      postData.metadata_json
    ]
  );
};

const spawnTool = ({ command, args, label, postId, options, onStdout }) => new Promise((resolve, reject) => {
  const proc = spawn(command, args);
  registerProcess(proc, options);
  let stderr = '';

  proc.stdout.on('data', (data) => {
    const text = data.toString();
    logger.info(`${label} stdout`, { post_id: postId, output: text.trim() });
    onStdout?.(text);
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    logger.warn(`${label} stderr`, { post_id: postId, output: text.trim() });
  });

  proc.on('close', (code, signal) => {
    if (code !== 0) {
      reject(new Error(stderr.trim() || `${label} failed${signal ? ` (${signal})` : ` (code ${code})`}`));
    } else {
      resolve();
    }
  });
});

// Fetch post metadata from yt-dlp without downloading
export const getMetadata = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--skip-download', '--no-warnings'];
    if (hasCookies()) args.push('--cookies', COOKIES_PATH);
    args.push(url);

    const proc = spawn('yt-dlp', args);
    registerProcess(proc, options);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp failed to get metadata (code ${code})`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse metadata JSON: ${e.message}`));
        }
      }
    });
  });
};

// Fetch all video entries in a profile (flat-playlist scan)
export const scanProfile = (profileUrl, options = {}) => {
  return new Promise((resolve, reject) => {
    const args = ['--flat-playlist', '--dump-json', '--no-warnings'];
    if (hasCookies()) args.push('--cookies', COOKIES_PATH);
    args.push(profileUrl);

    const proc = spawn('yt-dlp', args);
    registerProcess(proc, options);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp profile scan failed (code ${code})`));
      } else {
        try {
          const lines = stdout.trim().split('\n').filter((line) => line.trim() !== '');
          const entries = lines.map((line) => JSON.parse(line));
          resolve(entries);
        } catch (e) {
          reject(new Error(`Failed to parse profile scan output: ${e.message}`));
        }
      }
    });
  });
};

const buildPostData = ({ id, channelId, type, title, description, url, uploadDate, filePath, thumbnailPath, metadata }) => ({
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
  metadata_json: JSON.stringify(metadata)
});

const downloadWithGalleryDl = async (url, onProgress, options, context = {}) => {
  const postId = context.postId || createPostId(url, context.metadata);
  const channelId = context.channelId || sourceIdFromUrl(url, context.metadata);
  const uploadDate = context.uploadDate || uploadDateFromMetadata(context.metadata);
  const title = context.title || context.metadata?.title || `${getHostname(url)} media`;
  const description = context.description || context.metadata?.description || title;
  const sourceDir = safeSegment(channelId);
  const itemDir = path.join(DOWNLOADS_DIR, sourceDir, safeSegment(postId));

  fs.mkdirSync(itemDir, { recursive: true });
  onProgress(20, `Downloading media with gallery-dl${isVscoUrl(url) ? ' (VSCO TLS 1.2 disabled)' : ''}...`);

  const galleryArgs = [
    '--directory', itemDir,
    '--filename', context.filenameFormat || '/O',
    '--no-input'
  ];

  if (isVscoUrl(url)) {
    galleryArgs.push('-o', 'extractor.vsco.tls12=false');
  }
  if (hasCookies()) {
    galleryArgs.push('--cookies', COOKIES_PATH);
  }
  galleryArgs.push(url);

  let toolError = null;
  try {
    await spawnTool({ command: 'gallery-dl', args: galleryArgs, label: 'gallery-dl', postId, options });
  } catch (error) {
    toolError = error;
  }

  const files = collectMediaFiles(itemDir);
  if (files.length === 0) {
    throw new Error(`gallery-dl failed to download any supported media. Error: ${toolError?.message || 'No media files found'}`);
  }

  onProgress(80, 'Preserving file dates...');
  setMediaDates(files, uploadDate);

  const type = inferTypeFromFiles(files, context.preferredType);
  const finalFilePath = files.length === 1 ? toWebPath(files[0]) : toWebPath(itemDir);
  const firstImage = files.find(isImageFile);
  const finalThumbnailPath = firstImage ? toWebPath(firstImage) : '';
  const metadata = {
    ...(context.metadata || {}),
    downloader: 'gallery-dl',
    gallery_dl_tls12: isVscoUrl(url) ? false : undefined,
    yt_dlp_error: context.ytDlpError,
    media_files: files.map(toWebPath)
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
    metadata
  });
  await savePost(postData);

  logger.info('gallery downloader completed', { post_id: postId, channel_id: channelId, files: files.length });
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
  const outputBase = safeSegment(`${channelId}_${postId}`, hashValue(url));

  fs.mkdirSync(channelDir, { recursive: true });
  onProgress(20, 'Downloading media with yt-dlp...');

  const outTemplate = path.join(channelDir, `${outputBase}.%(ext)s`);
  const ytArgs = [
    '--format', 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '--write-thumbnail',
    '--no-playlist',
    '--no-warnings',
    '-o', outTemplate
  ];

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
        const jobProgress = Math.round(20 + (percent * 0.6));
        onProgress(jobProgress, `Downloading media: ${percent}%`);
      }
    }
  });

  onProgress(80, 'Preserving file dates...');
  const files = collectMediaFiles(channelDir).filter((file) => path.basename(file).startsWith(outputBase));
  const primaryFile = files.find(isVideoFile) || files.find(isImageFile) || files.find(isAudioFile);

  if (!primaryFile) {
    throw new Error(`yt-dlp completed but no supported output media was found under: ${outputBase}`);
  }

  setMediaDates(files, uploadDate);
  const type = inferTypeFromFiles([primaryFile]);
  const firstImage = files.find(isImageFile);
  let generatedThumbnail = '';
  if (!firstImage && isVideoFile(primaryFile)) {
    try {
      generatedThumbnail = await createVideoThumbnail(primaryFile, DOWNLOADS_DIR);
    } catch (error) {
      logger.warn('video thumbnail generation failed during download', { post_id: postId, error });
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
    filePath: toWebPath(primaryFile),
    thumbnailPath: firstImage && firstImage !== primaryFile ? toWebPath(firstImage) : (isImageFile(primaryFile) ? toWebPath(primaryFile) : generatedThumbnail),
    metadata: {
      ...metadata,
      downloader: 'yt-dlp',
      media_files: files.map(toWebPath)
    }
  });

  onProgress(90, 'Saving media metadata to database...');
  await savePost(postData);

  logger.info('yt-dlp downloader completed', { post_id: postId, channel_id: channelId });
  onProgress(100, 'Success');
  return postData;
};

// Main download handler for a specific URL
export const downloadPost = async (url, onProgress = () => {}, options = {}) => {
  logger.info('downloader started', { url });

  const duplicateByUrl = await dbGet('SELECT * FROM posts WHERE url = ?', [url]);
  if (duplicateByUrl) {
    logger.info('downloader skipped duplicate URL', { post_id: duplicateByUrl.id });
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
    logger.warn('yt-dlp metadata failed; falling back to gallery-dl', { url, error });
    onProgress(15, 'yt-dlp could not extract this URL. Trying gallery-dl...');
    return downloadWithGalleryDl(url, onProgress, options, { ytDlpError: error.message });
  }

  const postId = createPostId(url, metadata);
  const duplicate = await dbGet('SELECT * FROM posts WHERE id = ?', [postId]);
  if (duplicate) {
    logger.info('downloader skipped duplicate media item', { post_id: postId });
    onProgress(100, 'Duplicate skipped.');
    return duplicate;
  }

  const isSlideshow = (metadata.webpage_url && metadata.webpage_url.includes('/photo/')) ||
                      (metadata.vcodec === 'none' && (!metadata.formats || metadata.formats.length <= 1));

  if (isSlideshow) {
    return downloadWithGalleryDl(url, onProgress, options, {
      metadata,
      postId,
      channelId: sourceIdFromUrl(url, metadata),
      preferredType: 'slideshow',
      filenameFormat: 'image_{num}.{extension}',
      uploadDate: uploadDateFromMetadata(metadata),
      title: metadata.title || '',
      description: metadata.description || metadata.title || ''
    });
  }

  try {
    return await downloadWithYtDlp(url, metadata, onProgress, options);
  } catch (error) {
    if (isTikTokUrl(url)) throw error;
    logger.warn('yt-dlp download failed; falling back to gallery-dl', { url, error });
    onProgress(20, 'yt-dlp download failed. Trying gallery-dl...');
    return downloadWithGalleryDl(url, onProgress, options, {
      metadata,
      postId,
      channelId: sourceIdFromUrl(url, metadata),
      uploadDate: uploadDateFromMetadata(metadata),
      title: metadata.title || '',
      description: metadata.description || metadata.title || '',
      ytDlpError: error.message
    });
  }
};
