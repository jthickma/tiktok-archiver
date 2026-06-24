import { asyncRoute } from '../middleware/async-handler.js';

/**
 * Archive maintenance route adapters.
 * @param {import('express').Router} router
 * @param {ReturnType<import('../archive-catalog.js').createArchiveCatalog>} archiveCatalog
 */
export const createArchiveRoutes = (router, archiveCatalog) => {

  router.get(
    '/stats',
    asyncRoute(async (req, res) => {
      res.json(await archiveCatalog.stats());
    }),
  );

  router.get(
    '/orphans',
    asyncRoute(async (req, res) => {
      const orphans = await archiveCatalog.orphans();
      res.json({ orphans, count: orphans.length });
    }),
  );

  router.post(
    '/orphans/cleanup',
    asyncRoute(async (req, res) => {
      res.json(await archiveCatalog.cleanupOrphans());
    }),
  );

  router.post(
    '/deduplicate',
    asyncRoute(async (req, res) => {
      res.json(await archiveCatalog.deduplicate());
    }),
  );

  return router;
};
