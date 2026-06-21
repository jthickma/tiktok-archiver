import fs from 'fs';
import path from 'path';
import { ApiError } from './validation.js';
import { safeResolve } from './utils/path-utils.js';
import { collectMediaFiles } from './utils/media-files.js';

export const sendPostMedia = async ({ res, downloadsDir, post }) => {
  if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
  if (!post.file_path)
    throw new ApiError(
      400,
      'NO_MEDIA',
      'No media file associated with this post',
    );

  const fullPath = safeResolve(downloadsDir, post.file_path);
  if (!fullPath)
    throw new ApiError(
      400,
      'INVALID_PATH',
      'Media path is outside downloads directory',
    );
  if (!fs.existsSync(fullPath))
    throw new ApiError(404, 'NOT_FOUND', 'File not found on server');

  const stats = fs.statSync(fullPath);
  if (stats.isDirectory()) {
    throw new ApiError(
      400,
      'DIRECTORY_DOWNLOAD_DISABLED',
      'Directory downloads are disabled because ZIP export has been removed',
    );
  }

  res.download(fullPath, path.basename(post.file_path));
};

export const sendPostMediaFile = async ({ res, downloadsDir, post, index }) => {
  if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
  if (!post.file_path)
    throw new ApiError(
      400,
      'NO_MEDIA',
      'No media file associated with this post',
    );

  const fullPath = safeResolve(downloadsDir, post.file_path);
  if (!fullPath)
    throw new ApiError(
      400,
      'INVALID_PATH',
      'Media path is outside downloads directory',
    );
  if (!fs.existsSync(fullPath))
    throw new ApiError(404, 'NOT_FOUND', 'File not found on server');

  const files = collectMediaFiles(fullPath);
  const file = files[index];
  if (!file) throw new ApiError(404, 'NOT_FOUND', 'Media file not found');
  safeResolve(downloadsDir, path.relative(downloadsDir, file));

  res.download(file, path.basename(file));
};
