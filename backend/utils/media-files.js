import fs from 'fs';
import path from 'path';

/**
 * Media file extension sets — shared across downloader, posts, archives
 */
export const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
]);
export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.mkv',
]);
export const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.wav',
  '.flac',
  '.ogg',
  '.opus',
]);
export const MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
]);

/**
 * Regex-based checks for when Set lookup isn't convenient (e.g. in filter chains).
 */
const IMAGE_REGEX = /\.(jpg|jpeg|png|webp|gif|avif|image)$/i;
const VIDEO_REGEX = /\.(mp4|m4v|mov|webm|mkv)$/i;
const AUDIO_REGEX = /\.(mp3|m4a|wav|flac|ogg|opus)$/i;
const MEDIA_REGEX =
  /\.(jpg|jpeg|png|webp|gif|avif|mp4|m4v|mov|webm|mkv|mp3|m4a|wav|flac|ogg|opus|image)$/i;

/**
 * Check if a file path has a media extension using Set lookup.
 * @param {string} filePath
 * @returns {boolean}
 */
export const isMediaFile = (filePath) =>
  MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase());

/**
 * Check if a file path has an image extension.
 * @param {string} filePath
 * @returns {boolean}
 */
export const isImageFile = (filePath) =>
  IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());

/**
 * Check if a file path has a video extension.
 * @param {string} filePath
 * @returns {boolean}
 */
export const isVideoFile = (filePath) =>
  VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());

/**
 * Check if a file path has an audio extension.
 * @param {string} filePath
 * @returns {boolean}
 */
export const isAudioFile = (filePath) =>
  AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());

/**
 * Check if a file path matches a media extension via regex.
 * @param {string} filePath
 * @returns {boolean}
 */
export const isMediaFileRegex = (filePath) => MEDIA_REGEX.test(filePath);

/**
 * Check if a file path matches an image extension via regex.
 * @param {string} filePath
 * @returns {boolean}
 */
export const isImageFileRegex = (filePath) => IMAGE_REGEX.test(filePath);

/**
 * Check if a file path matches a video extension via regex.
 * @param {string} filePath
 * @returns {boolean}
 */
export const isVideoFileRegex = (filePath) => VIDEO_REGEX.test(filePath);

/**
 * Check if a file path matches an audio extension via regex.
 * @param {string} filePath
 * @returns {boolean}
 */
export const isAudioFileRegex = (filePath) => AUDIO_REGEX.test(filePath);

/**
 * Determine the media kind string from a file path.
 * @param {string} filePath
 * @returns {'image'|'video'|'audio'|'file'}
 */
export const mediaKind = (filePath) => {
  if (isImageFile(filePath)) return 'image';
  if (isVideoFile(filePath)) return 'video';
  if (isAudioFile(filePath)) return 'audio';
  return 'file';
};

/**
 * Recursively list all files under a directory, skipping .thumbnails dirs.
 * @param {string} rootDir
 * @param {object} [fsModule] - Optional fs module override (for testing)
 * @returns {string[]}
 */
export const listFiles = (rootDir, fsModule = fs) => {
  if (!fsModule.existsSync(rootDir)) return [];
  const entries = fsModule.readdirSync(rootDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory() && entry.name === '.thumbnails') return [];
    if (entry.isDirectory()) return listFiles(fullPath, fsModule);
    return [fullPath];
  });
};

/**
 * Collect media files from a directory, filtered to known extensions,
 * excluding .part files, sorted naturally.
 * @param {string} rootDir
 * @param {object} [fsModule] - Optional fs module override
 * @returns {string[]}
 */
export const collectMediaFiles = (rootDir, fsModule = fs) =>
  listFiles(rootDir, fsModule)
    .filter((filePath) => isMediaFile(filePath) && !filePath.endsWith('.part'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/**
 * Infer the post type from an array of media file paths.
 * @param {string[]} files
 * @param {string} [preferredType='']
 * @returns {string}
 */
export const inferTypeFromFiles = (files, preferredType = '') => {
  if (preferredType === 'slideshow') return 'slideshow';
  if (files.length > 1) return 'gallery';
  const file = files[0] || '';
  if (isVideoFile(file)) return 'video';
  if (isImageFile(file)) return 'image';
  if (isAudioFile(file)) return 'audio';
  return preferredType || 'media';
};

/**
 * Set file modification/access timestamps to match the upload date.
 * @param {string[]} files
 * @param {string} uploadDate - YYYY-MM-DD format date string
 */
export const setMediaDates = (files, uploadDate) => {
  const mTime = new Date(uploadDate);
  if (Number.isNaN(mTime.getTime())) return;
  for (const file of files) {
    try {
      fs.utimesSync(file, mTime, mTime);
    } catch {
      // Skip files we can't modify timestamps on
    }
  }
};

/**
 * Get a file extension from a URL, falling back to a default.
 * @param {string} url
 * @param {string} [fallback='.jpg']
 * @returns {string}
 */
export const getExtensionFromUrl = (url, fallback = '.jpg') => {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (MEDIA_EXTENSIONS.has(ext)) return ext;
  } catch {}
  return fallback;
};

/**
 * Walk a directory recursively, returning all file paths (deep).
 * @param {string} dir
 * @param {object} fsModule
 * @param {object} pathModule
 * @returns {string[]}
 */
export const walkFiles = (dir, fsModule = fs, pathModule = path) => {
  const entries = fsModule.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = pathModule.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === '.thumbnails') return [];
    if (entry.isDirectory()) return walkFiles(fullPath, fsModule, pathModule);
    return [fullPath];
  });
};
