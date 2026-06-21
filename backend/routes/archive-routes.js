import { asyncRoute } from '../middleware/async-handler.js';
import { ApiError } from '../validation.js';

/**
 * Archive routes — stats, orphan cleanup, export.
 * @param {import('express').Router} router
 * @param {Object} deps - { dbAll, dbGet, dbRun, archiveService, downloadsDir, getPost }
 */
export const createArchiveRoutes = (router, deps) => {
  const { dbAll, dbGet, dbRun, archiveService, downloadsDir, getPost } = deps;

  router.get(
    '/stats',
    asyncRoute(async (req, res) => {
      const stats = await archiveService.getArchiveStats(dbAll, dbGet);
      const storage = await archiveService.getStorageBreakdown(downloadsDir);
      res.json({ ...stats, storage });
    }),
  );

  router.get(
    '/orphans',
    asyncRoute(async (req, res) => {
      const orphans = await archiveService.findOrphanFiles(downloadsDir, dbAll);
      res.json({ orphans, count: orphans.length });
    }),
  );

  router.post(
    '/orphans/cleanup',
    asyncRoute(async (req, res) => {
      const orphans = await archiveService.findOrphanFiles(downloadsDir, dbAll);
      const result = await archiveService.cleanupOrphans(orphans, downloadsDir);
      res.json(result);
    }),
  );

  router.post(
    '/deduplicate',
    asyncRoute(async (req, res) => {
      const result = await archiveService.deduplicatePosts(dbAll, dbGet, dbRun);
      res.json(result);
    }),
  );

  return router;
};
