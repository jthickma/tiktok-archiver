/**
 * Simple in-memory sliding window rate limiter factory.
 * Tracks request timestamps per IP and rejects when window is exceeded.
 */

/**
 * Create a rate limiter middleware.
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000)
 * @param {number} options.max - Max requests per window (default: 100)
 * @returns {Function} Express middleware
 */
export const createRateLimiter = ({ windowMs = 60000, max = 100 } = {}) => {
  const hits = new Map();

  // Periodically clean up stale entries
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, valid);
      }
    }
  }, windowMs * 2);

  // Allow cleanup to not prevent process exit
  cleanup.unref();

  return (req, res, next) => {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;

    const timestamps = (hits.get(key) || []).filter((t) => t > cutoff);
    timestamps.push(now);
    hits.set(key, timestamps);

    if (timestamps.length > max) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Limit: ${max} per ${windowMs / 1000}s`,
        },
      });
      return;
    }

    next();
  };
};
