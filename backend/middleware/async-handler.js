import { logger } from '../logger.js';
import { sendError } from '../validation.js';

/**
 * Wrap an async route handler to catch errors and forward to error handler.
 * @param {Function} handler - async (req, res) => void
 * @returns {Function} Express middleware
 */
export const asyncRoute = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    logger.error('api route failed', {
      path: req.path,
      method: req.method,
      error,
    });
    if (!res.headersSent) sendError(res, error);
  }
};
