import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { dbAll, dbGet } from './database.js';
import { ApiError } from './validation.js';
import { logger } from './logger.js';

const safeResolve = (root, relativePath) => {
  const resolved = path.resolve(root, relativePath || '');
  const rootResolved = path.resolve(root);
  if (!resolved.startsWith(rootResolved)) {
    throw new ApiError(400, 'INVALID_PATH', 'Media path is outside downloads directory');
  }
  return resolved;
};

const addPostToArchive = (archive, downloadsDir, post) => {
  if (!post.file_path) return;
  const fullPath = safeResolve(downloadsDir, post.file_path);
  if (!fs.existsSync(fullPath)) {
    logger.warn('archive skipped missing media', { post_id: post.id, path: post.file_path });
    return;
  }

  const cleanChannelId = post.channel_id.replace(/^@/, '');
  const entryName = `${cleanChannelId}/${path.basename(post.file_path)}`;
  const stats = fs.statSync(fullPath);
  if (stats.isDirectory()) {
    archive.directory(fullPath, entryName);
  } else {
    archive.file(fullPath, { name: entryName });
  }
};

export const streamPostsZip = async ({ res, downloadsDir, channelId = '', ids = [] }) => {
  let posts;
  let zipName = 'tiktok_archive_all.zip';

  if (ids.length) {
    posts = await dbAll(
      `SELECT * FROM posts WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    zipName = 'tiktok_archive_selection.zip';
  } else if (channelId) {
    const channel = await dbGet('SELECT * FROM channels WHERE id = ?', [channelId]);
    const name = channel ? channel.username : channelId.replace(/^@/, '');
    posts = await dbAll('SELECT * FROM posts WHERE channel_id = ?', [channelId]);
    zipName = `tiktok_archive_${name}.zip`;
  } else {
    posts = await dbAll('SELECT * FROM posts');
  }

  if (!posts?.length) {
    throw new ApiError(404, 'NOT_FOUND', 'No posts found to archive');
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (error) => logger.warn('zip warning', { error }));
  archive.on('error', (error) => {
    logger.error('zip stream error', { error });
    throw error;
  });
  archive.pipe(res);

  for (const post of posts) {
    addPostToArchive(archive, downloadsDir, post);
  }

  await archive.finalize();
};

export const sendPostMedia = async ({ res, downloadsDir, post }) => {
  if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
  if (!post.file_path) throw new ApiError(400, 'NO_MEDIA', 'No media file associated with this post');

  const fullPath = safeResolve(downloadsDir, post.file_path);
  if (!fs.existsSync(fullPath)) throw new ApiError(404, 'NOT_FOUND', 'File not found on server');

  const stats = fs.statSync(fullPath);
  if (stats.isDirectory()) {
    const folderName = path.basename(post.file_path);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    archive.directory(fullPath, false);
    await archive.finalize();
    return;
  }

  res.download(fullPath, path.basename(post.file_path));
};
