import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbRun, dbGet } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(__dirname, '../downloads');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const COOKIES_PATH = path.join(DATA_DIR, 'cookies.txt');

// Helper to parse username from URL or metadata
export const extractUsername = (url, metadata = {}) => {
  let handle = metadata.uploader_id || metadata.uploader;
  if (!handle) {
    const match = url.match(/@([a-zA-Z0-9_.-]+)/);
    handle = match ? match[1] : 'unknown';
  }
  // Strip starting '@' if present, then prepend to make it consistent '@username'
  handle = handle.replace(/^@/, '');
  return `@${handle}`;
};

// Fetch post metadata from yt-dlp without downloading
export const getMetadata = (url) => {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--skip-download', '--no-warnings', url];
    if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 0) {
      args.push('--cookies', COOKIES_PATH);
    }
    const proc = spawn('yt-dlp', args);
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
export const scanProfile = (profileUrl) => {
  return new Promise((resolve, reject) => {
    // --flat-playlist outputs basic info for each entry without scraping detailed pages or downloading
    const args = ['--flat-playlist', '--dump-json', '--no-warnings', profileUrl];
    if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 0) {
      args.push('--cookies', COOKIES_PATH);
    }

    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp profile scan failed (code ${code})`));
      } else {
        try {
          const lines = stdout.trim().split('\n').filter(l => l.trim() !== '');
          const entries = lines.map(line => JSON.parse(line));
          resolve(entries);
        } catch (e) {
          reject(new Error(`Failed to parse profile scan output: ${e.message}`));
        }
      }
    });
  });
};

// Main download handler for a specific post URL
export const downloadPost = async (url, onProgress = () => {}) => {
  console.log(`[Downloader] Starting processing for: ${url}`);
  onProgress(5, 'Fetching post metadata...');

  // 1. Get detailed metadata
  const metadata = await getMetadata(url);
  const postId = metadata.id;
  const username = extractUsername(url, metadata);
  const title = metadata.title || '';
  const description = metadata.description || title || '';
  const rawDate = metadata.upload_date; // YYYYMMDD
  
  let uploadDate = null;
  if (rawDate && rawDate.length === 8) {
    uploadDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
  } else {
    uploadDate = new Date().toISOString().split('T')[0];
  }

  // Check if we already have this post in the database
  const duplicate = await dbGet('SELECT * FROM posts WHERE id = ?', [postId]);
  if (duplicate) {
    console.log(`[Downloader] Skipping duplicate post: ${postId}`);
    onProgress(100, 'Duplicate skipped.');
    return duplicate;
  }

  // 2. Identify if it is a photo slideshow
  // TikTok photo posts resolved by yt-dlp have webpage_url containing '/photo/' 
  // or they may have vcodec 'none' combined with missing video formats.
  const isSlideshow = (metadata.webpage_url && metadata.webpage_url.includes('/photo/')) || 
                      (metadata.vcodec === 'none' && (!metadata.formats || metadata.formats.length <= 1));

  const type = isSlideshow ? 'slideshow' : 'video';
  console.log(`[Downloader] Identified post ${postId} as type: ${type}`);

  // Create channel folder in downloads
  const channelDir = path.join(DOWNLOADS_DIR, username);
  if (!fs.existsSync(channelDir)) {
    fs.mkdirSync(channelDir, { recursive: true });
  }

  let finalFilePath = '';
  let finalThumbnailPath = '';

  if (isSlideshow) {
    // DOWNLOAD SLIDESHOW IMAGES
    onProgress(20, 'Downloading slideshow images with gallery-dl...');
    const postDirName = postId;
    const slideshowDir = path.join(channelDir, postDirName);
    if (!fs.existsSync(slideshowDir)) {
      fs.mkdirSync(slideshowDir, { recursive: true });
    }

    // gallery-dl command
    // -d specifies target directory, -f names the files
    const galleryArgs = [
      '--directory', slideshowDir,
      '--filename', 'image_{num}.{extension}',
      '--no-warnings'
    ];

    if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 0) {
      galleryArgs.push('--cookies', COOKIES_PATH);
    }
    galleryArgs.push(url);

    await new Promise((resolve, reject) => {
      const proc = spawn('gallery-dl', galleryArgs);
      let stderr = '';

      proc.stdout.on('data', (data) => {
        // Log line-by-line debug output
        console.log(`[gallery-dl stdout] ${data.toString().trim()}`);
      });
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`[gallery-dl stderr] ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        // gallery-dl sometimes returns 0 even if nothing is downloaded, or non-zero on minor warnings. 
        // We will verify if files were actually written.
        const files = fs.existsSync(slideshowDir) ? fs.readdirSync(slideshowDir) : [];
        if (files.length === 0) {
          reject(new Error(`gallery-dl failed to download any images. Error: ${stderr.trim() || 'No images found'}`));
        } else {
          resolve();
        }
      });
    });

    onProgress(80, 'Preserving file dates...');

    // Walk the slideshow images and set their modification time to uploadDate
    const images = fs.readdirSync(slideshowDir);
    const mTime = new Date(uploadDate);
    if (!isNaN(mTime.getTime())) {
      for (const img of images) {
        const imgPath = path.join(slideshowDir, img);
        fs.utimesSync(imgPath, mTime, mTime);
      }
    }

    // Use the first image as the thumbnail
    const firstImg = images.find(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    finalFilePath = path.join(username, postDirName); // relative path for DB/web serving
    finalThumbnailPath = firstImg ? path.join(username, postDirName, firstImg) : '';

  } else {
    // DOWNLOAD VIDEO WITH YT-DLP
    onProgress(20, 'Downloading video with yt-dlp...');

    // yt-dlp format selection and options
    const outTemplate = path.join(channelDir, `${username}_${postId}.%(ext)s`);
    const ytArgs = [
      '--format', 'bestvideo+bestaudio/best',
      '--merge-output-format', 'mp4',
      '--write-thumbnail',
      '--no-playlist',
      '--no-warnings',
      '-o', outTemplate,
      url
    ];

    if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 0) {
      ytArgs.push('--cookies', COOKIES_PATH);
    }

    await new Promise((resolve, reject) => {
      const proc = spawn('yt-dlp', ytArgs);
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        console.log(`[yt-dlp stdout] ${text.trim()}`);
        
        // Parse download percentage from yt-dlp output
        const match = text.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
          const percent = parseFloat(match[1]);
          // Map 0-100% download progress to 20-80% job progress
          const jobProgress = Math.round(20 + (percent * 0.6));
          onProgress(jobProgress, `Downloading video: ${percent}%`);
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`[yt-dlp stderr] ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `yt-dlp video download failed (code ${code})`));
        } else {
          resolve();
        }
      });
    });

    onProgress(80, 'Preserving file dates...');

    // Find the files downloaded for this post (video and thumbnail)
    const prefix = `${username}_${postId}`;
    const files = fs.readdirSync(channelDir).filter(f => f.startsWith(prefix));

    const videoFile = files.find(f => f.endsWith('.mp4'));
    let thumbnailFile = files.find(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && !f.endsWith('.mp4'));

    if (videoFile) {
      finalFilePath = path.join(username, videoFile);
      const mTime = new Date(uploadDate);
      if (!isNaN(mTime.getTime())) {
        for (const file of files) {
          fs.utimesSync(path.join(channelDir, file), mTime, mTime);
        }
      }
    } else {
      throw new Error(`Video download completed but output file was not found under: ${prefix}`);
    }

    finalThumbnailPath = thumbnailFile ? path.join(username, thumbnailFile) : '';
  }

  // 3. Save details to database
  onProgress(90, 'Saving post metadata to database...');
  
  const postData = {
    id: postId,
    channel_id: username,
    type,
    title,
    description,
    url,
    upload_date: uploadDate,
    file_path: finalFilePath,
    thumbnail_path: finalThumbnailPath,
    downloaded_at: new Date().toISOString(),
    metadata_json: JSON.stringify(metadata)
  };

  // Ensure channel exists in database (in case of on-demand downloads for non-monitored channels)
  const channelExists = await dbGet('SELECT id FROM channels WHERE id = ?', [username]);
  if (!channelExists) {
    await dbRun(
      'INSERT INTO channels (id, username, url, created_at) VALUES (?, ?, ?, ?)',
      [username, username.replace(/^@/, ''), `https://www.tiktok.com/${username}`, new Date().toISOString()]
    );
  }

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

  console.log(`[Downloader] Download completed successfully for: ${postId}`);
  onProgress(100, 'Success');

  return postData;
};
