import { asyncRoute } from '../middleware/async-handler.js';
import { parseQueueQuery, parseId } from '../validation.js';

/**
 * Queue routes.
 * @param {import('express').Router} router
 * @param {Object} deps - { listQueueJobs, readJobLogs, cancelJob, retryJob, deleteJob, clearCompletedJobs, pauseQueue, resumeQueue }
 */
export const createQueueRoutes = (router, deps) => {
  const {
    listQueueJobs,
    readJobLogs,
    cancelJob,
    retryJob,
    deleteJob,
    clearCompletedJobs,
    pauseQueue,
    resumeQueue,
  } = deps;

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      res.json(await listQueueJobs(parseQueueQuery(req.query)));
    }),
  );

  router.get(
    '/:id/logs',
    asyncRoute(async (req, res) => {
      res.json(await readJobLogs(parseId(req.params.id)));
    }),
  );

  router.post(
    '/:id/cancel',
    asyncRoute(async (req, res) => {
      await cancelJob(parseId(req.params.id));
      res.json({ message: 'Job cancelled' });
    }),
  );

  router.post(
    '/:id/retry',
    asyncRoute(async (req, res) => {
      await retryJob(parseId(req.params.id));
      res.json({ message: 'Job requeued' });
    }),
  );

  router.delete(
    '/history/completed',
    asyncRoute(async (req, res) => {
      const result = await clearCompletedJobs();
      res.json({
        message: 'Completed queue entries cleared',
        count: result.changes,
      });
    }),
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      await deleteJob(parseId(req.params.id));
      res.json({ message: 'Job deleted' });
    }),
  );

  router.post(
    '/pause',
    asyncRoute(async (req, res) => {
      pauseQueue();
      res.json({ message: 'Queue paused' });
    }),
  );

  router.post(
    '/resume',
    asyncRoute(async (req, res) => {
      resumeQueue();
      res.json({ message: 'Queue resumed' });
    }),
  );

  return router;
};
