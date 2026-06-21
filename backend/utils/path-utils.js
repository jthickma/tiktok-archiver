import path from 'path';

/**
 * Resolve a relative path within a root directory, guarding against path traversal.
 * Returns the resolved absolute path, or null if the path escapes the root.
 *
 * @param {string} root - The root/base directory (must be resolved beforehand)
 * @param {string} relativePath - The user-provided relative path
 * @returns {string|null} Resolved absolute path, or null if traversal detected
 */
export const safeResolve = (root, relativePath) => {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, relativePath || '');
  if (
    resolved !== rootResolved &&
    !resolved.startsWith(`${rootResolved}${path.sep}`)
  ) {
    return null;
  }
  return resolved;
};

/**
 * Convert a filesystem path to a web-relative path by stripping the downloads
 * directory prefix and normalizing separators to forward slashes.
 *
 * @param {string} downloadsDir - Root downloads directory
 * @param {string} fullPath - Absolute filesystem path
 * @returns {string} Web-relative path (forward slashes)
 */
export const toWebPath = (downloadsDir, fullPath) =>
  path.relative(downloadsDir, fullPath).split(path.sep).join('/');

/**
 * Convert a relative filesystem path (with OS separators) to a web path.
 * Useful when you already have a relative path and just need separator normalization.
 *
 * @param {string} relativePath - Filesystem-relative path (may have backslashes)
 * @returns {string} Web-relative path (forward slashes)
 */
export const toWebPathRelative = (relativePath) =>
  relativePath.replaceAll('\\', '/');

/**
 * Sanitize a string for use as a safe filesystem segment.
 *
 * @param {string} value - Raw value to sanitize
 * @param {string} [fallback='download'] - Fallback if result is empty
 * @returns {string} Safe filesystem segment
 */
export const safeSegment = (value, fallback = 'download') => {
  const clean = String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9@._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return clean || fallback;
};

/**
 * Sanitize a string for use in an archive naming part.
 *
 * @param {string} value
 * @returns {string}
 */
export const safePart = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9@._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
