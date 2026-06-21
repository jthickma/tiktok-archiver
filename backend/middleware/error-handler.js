import { logger } from '../logger.js';
import { sendError } from '../validation.js';

/**
 * Global Express error handler middleware.
 * Catches unhandled errors and formats a consistent API error response.
 */
export const globalErrorHandler = (err, req, res, _next) => {
  logger.error('unhandled error', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });
  if (!res.headersSent) {
    sendError(res, err);
  }
};
