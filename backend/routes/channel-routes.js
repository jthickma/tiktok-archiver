import { asyncRoute } from '../middleware/async-handler.js';
import { requireBodyString } from '../validation.js';

/**
 * Channel routes.
 * @param {import('express').Router} router
 * @param {ReturnType<import('../channels.js').createMonitoredProfiles>} monitoredProfiles
 * @param {Object} queue
 */
export const createChannelRoutes = (router, monitoredProfiles, queue) => {
  router.get(
    '/',
    asyncRoute(async (req, res) => {
      res.json(await monitoredProfiles.listChannels());
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const url = requireBodyString(req.body, 'url');
      const channel = await monitoredProfiles.monitorProfile(url);
      const job = await queue.enqueue(channel.url, 'channel');
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
      await monitoredProfiles.stopMonitoring(req.params.id);
      res.json({ message: `Stopped monitoring channel: ${req.params.id}` });
    }),
  );

  return router;
};
