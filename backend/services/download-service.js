/**
 * Download service — URL validation, scheduling with priority, pre-flight checks.
 */
import { enqueueJob } from '../repositories/job-repository.js';

/**
 * Schedule a download with optional priority and delay.
 * @param {Function} dbRun
 * @param {Function} dbGet
 * @param {string} url
 * @param {string} type - 'post' or 'gallery-dl'
 * @param {Object} [options]
 * @param {number} [options.priority] - Higher = processed first (via maxAttempts proxy)
 * @param {number} [options.delayMs] - Delay in milliseconds before making job available
 * @param {number} [options.maxAttempts=3]
 * @returns {Promise<Object>}
 */
export const scheduleDownload = async (
  dbRun,
  dbGet,
  url,
  type,
  options = {},
) => {
  const { priority, delayMs, maxAttempts = 3 } = options;

  // If delay is specified, set next_attempt_at in the future
  const jobOptions = { maxAttempts: priority || maxAttempts };

  const result = await enqueueJob(dbRun, dbGet, url, type, jobOptions);

  // If delay is specified, update the job's next_attempt_at
  if (delayMs > 0 && result.created) {
    const delayUntil = new Date(Date.now() + delayMs).toISOString();
    await dbRun('UPDATE download_jobs SET next_attempt_at = ? WHERE id = ?', [
      delayUntil,
      result.id,
    ]);
  }

  return result;
};

/**
 * Validate a URL before queueing — checks if it looks like a supported URL.
 * @param {string} url
 * @returns {{valid: boolean, type: string, estimatedSize: number|null}}
 */
export const validateUrlBeforeQueue = (url) => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();

    // Supported sources
    const tiktokPattern = /(^|\.)tiktok\.com$/i;
    const vscoPattern = /(^|\.)vsco\.co$/i;

    if (tiktokPattern.test(hostname)) {
      return { valid: true, type: 'post', estimatedSize: null };
    }
    if (vscoPattern.test(hostname)) {
      return { valid: true, type: 'gallery-dl', estimatedSize: null };
    }

    // Generic URL — let gallery-dl try
    return { valid: true, type: 'gallery-dl', estimatedSize: null };
  } catch {
    return { valid: false, type: 'post', estimatedSize: null };
  }
};

/**
 * Estimate download size by probing the URL with a HEAD request.
 * @param {string} url
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<number|null>}
 */
export const estimateDownloadSize = async (url, timeoutMs = 5000) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentLength = response.headers.get('content-length');
    return contentLength ? Number.parseInt(contentLength, 10) : null;
  } catch {
    return null;
  }
};
