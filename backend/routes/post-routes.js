import { asyncRoute } from '../middleware/async-handler.js';
import { ApiError, parsePostsQuery } from '../validation.js';

/**
 * Archive Item route adapters.
 * @param {import('express').Router} router
 * @param {ReturnType<import('../archive-catalog.js').createArchiveCatalog>} archiveCatalog
 */
export const createPostRoutes = (router, archiveCatalog) => {

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      res.json(await archiveCatalog.search(parsePostsQuery(req.query)));
    }),
  );

  router.get(
    '/:id/download',
    asyncRoute(async (req, res) => {
      const file = await archiveCatalog.resolveDownload(req.params.id);
      res.download(file.path, file.name);
    }),
  );

  router.get(
    '/:id/files/:index/download',
    asyncRoute(async (req, res) => {
      const index = Number.parseInt(req.params.index, 10);
      if (!Number.isInteger(index) || index < 0) {
        throw new ApiError(
          400,
          'INVALID_INDEX',
          'File index must be zero or greater',
        );
      }
      const file = await archiveCatalog.resolveDownload(
        req.params.id,
        index,
      );
      res.download(file.path, file.name);
    }),
  );

  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
      res.json(await archiveCatalog.detail(req.params.id));
    }),
  );

  return router;
};
