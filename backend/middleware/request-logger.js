import { logger } from '../logger.js';

/**
 * Request/response logging middleware.
 * Logs each incoming request with method, path, and timing.
 */
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
    });
  });
  next();
};
