import { asyncRoute } from '../middleware/async-handler.js';
import { parseQueueQuery, parseId } from '../validation.js';

/**
 * Download Queue route adapters.
 * @param {import('express').Router} router
 * @param {ReturnType<import('../download-queue.js').createDownloadQueue>} queue
 */
export const createQueueRoutes = (router, queue) => {

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      res.json(await queue.list(parseQueueQuery(req.query)));
    }),
  );

  router.get(
    '/:id/logs',
    asyncRoute(async (req, res) => {
      res.json(await queue.logs(parseId(req.params.id)));
    }),
  );

  router.post(
    '/:id/cancel',
    asyncRoute(async (req, res) => {
      await queue.cancel(parseId(req.params.id));
      res.json({ message: 'Job cancelled' });
    }),
  );

  router.post(
    '/:id/retry',
    asyncRoute(async (req, res) => {
      await queue.retry(parseId(req.params.id));
      res.json({ message: 'Job requeued' });
    }),
  );

  router.delete(
    '/history/completed',
    asyncRoute(async (req, res) => {
      const result = await queue.clearCompleted();
      res.json({
        message: 'Completed queue entries cleared',
        count: result.changes,
      });
    }),
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      await queue.remove(parseId(req.params.id));
      res.json({ message: 'Job deleted' });
    }),
  );

  router.post(
    '/pause',
    asyncRoute(async (req, res) => {
      queue.pause();
      res.json({ message: 'Queue paused' });
    }),
  );

  router.post(
    '/resume',
    asyncRoute(async (req, res) => {
      queue.resume();
      res.json({ message: 'Queue resumed' });
    }),
  );

  return router;
};
