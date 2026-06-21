import { asyncRoute } from '../middleware/async-handler.js';
import { requireBodyString } from '../validation.js';

/**
 * Channel routes.
 * @param {import('express').Router} router
 * @param {Object} channelRegistry
 */
export const createChannelRoutes = (router, channelRegistry, enqueue) => {
  router.get(
    '/',
    asyncRoute(async (req, res) => {
      res.json(await channelRegistry.listChannels());
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const url = requireBodyString(req.body, 'url');
      const channel = await channelRegistry.monitorProfile(url);
      const job = await enqueue(channel.url, 'channel');
      res.status(job.created ? 201 : 200).json({
        message: job.requeued
          ? 'Profile monitoring requeued'
          : job.created
            ? 'Profile monitoring queued'
            : 'Profile is already queued',
        channelId: channel.id,
        job,
      });
    }),
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      await channelRegistry.stopMonitoring(req.params.id);
      res.json({ message: `Stopped monitoring channel: ${req.params.id}` });
    }),
  );

  return router;
};
