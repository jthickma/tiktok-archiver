import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { isVideoFile } from './utils/media-files.js';
import { safeResolve, toWebPath } from './utils/path-utils.js';

const runFfmpegThumbnail = (videoPath, thumbnailPath) => new Promise((resolve, reject) => {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', '00:00:01',
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', 'scale=480:-2',
    '-q:v', '4',
    thumbnailPath
  ];
  const proc = spawn('ffmpeg', args);
  let stderr = '';

  proc.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  proc.on('error', reject);
  proc.on('close', (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(stderr.trim() || `ffmpeg thumbnail failed (code ${code})`));
    }
  });
});

export const createVideoThumbnail = async (videoPath, downloadsDir) => {
  if (!isVideoFile(videoPath) || !fs.existsSync(videoPath)) return '';

  const thumbnailDir = path.join(path.dirname(videoPath), '.thumbnails');
  const thumbnailPath = path.join(thumbnailDir, `${path.parse(videoPath).name}.jpg`);
  if (fs.existsSync(thumbnailPath)) return toWebPath(downloadsDir, thumbnailPath);

  fs.mkdirSync(thumbnailDir, { recursive: true });
  await runFfmpegThumbnail(videoPath, thumbnailPath);
  return toWebPath(downloadsDir, thumbnailPath);
};

const ensurePostThumbnail = async (post, downloadsDir, updateThumbnail) => {
  if (!post || post.type !== 'video') return post;

  if (post.thumbnail_path) {
    const existingThumbnail = safeResolve(downloadsDir, post.thumbnail_path);
    if (existingThumbnail && fs.existsSync(existingThumbnail)) return post;
  }

  const videoPath = safeResolve(downloadsDir, post.file_path);
  if (!videoPath || !isVideoFile(videoPath) || !fs.existsSync(videoPath)) return post;

  try {
    const thumbnailPath = await createVideoThumbnail(videoPath, downloadsDir);
    if (!thumbnailPath) return post;

    await updateThumbnail(post.id, thumbnailPath);
    return { ...post, thumbnail_path: thumbnailPath };
  } catch (error) {
    logger.warn('video thumbnail generation failed', { post_id: post.id, file_path: post.file_path, error });
    return post;
  }
};

export const ensurePostThumbnails = async (
  posts,
  downloadsDir,
  updateThumbnail,
) => {
  const updatedPosts = [];
  for (const post of posts) {
    updatedPosts.push(
      await ensurePostThumbnail(post, downloadsDir, updateThumbnail),
    );
  }
  return updatedPosts;
};
