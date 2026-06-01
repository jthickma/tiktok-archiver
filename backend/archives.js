import fs from 'fs';
import path from 'path';
import { ApiError } from './validation.js';

const safeResolve = (root, relativePath) => {
  const resolved = path.resolve(root, relativePath || '');
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new ApiError(400, 'INVALID_PATH', 'Media path is outside downloads directory');
  }
  return resolved;
};

const mediaFiles = (rootPath) => {
  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) return [rootPath];

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });

  return walk(rootPath)
    .filter((file) => /\.(jpg|jpeg|png|webp|gif|avif|mp4|m4v|mov|webm|mkv|mp3|m4a|wav|flac|ogg|opus|image)$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

export const sendPostMedia = async ({ res, downloadsDir, post }) => {
  if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
  if (!post.file_path) throw new ApiError(400, 'NO_MEDIA', 'No media file associated with this post');

  const fullPath = safeResolve(downloadsDir, post.file_path);
  if (!fs.existsSync(fullPath)) throw new ApiError(404, 'NOT_FOUND', 'File not found on server');

  const stats = fs.statSync(fullPath);
  if (stats.isDirectory()) {
    throw new ApiError(400, 'DIRECTORY_DOWNLOAD_DISABLED', 'Directory downloads are disabled because ZIP export has been removed');
  }

  res.download(fullPath, path.basename(post.file_path));
};

export const sendPostMediaFile = async ({ res, downloadsDir, post, index }) => {
  if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
  if (!post.file_path) throw new ApiError(400, 'NO_MEDIA', 'No media file associated with this post');

  const fullPath = safeResolve(downloadsDir, post.file_path);
  if (!fs.existsSync(fullPath)) throw new ApiError(404, 'NOT_FOUND', 'File not found on server');

  const files = mediaFiles(fullPath);
  const file = files[index];
  if (!file) throw new ApiError(404, 'NOT_FOUND', 'Media file not found');
  safeResolve(downloadsDir, path.relative(downloadsDir, file));

  res.download(file, path.basename(file));
};
