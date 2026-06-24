import { asyncRoute } from '../middleware/async-handler.js';
import { ApiError, sendError } from '../validation.js';

/**
 * System routes — status, cookies, health check.
 * @param {import('express').Router} router
 * @param {Object} deps
 */
export const createSystemRoutes = (router, deps) => {
  const {
    getSystemStatus,
    queue,
    monitorState,
    startedAt,
    dataDir,
    downloadsDir,
    cookiesFile,
    fs,
  } = deps;

  router.get(
    '/status',
    asyncRoute(async (req, res) => {
      res.json(
        await getSystemStatus({
          startedAt,
          dataDir,
          downloadsDir,
          queueState: queue.state(),
          queueSummary: await queue.summary(),
          monitorState: monitorState(),
        }),
      );
    }),
  );

  router.get('/cookies', (req, res) => {
    try {
      res.json({
        cookies: fs.existsSync(cookiesFile)
          ? fs.readFileSync(cookiesFile, 'utf8')
          : '',
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/cookies', (req, res) => {
    try {
      if (req.body.cookies === undefined) {
        throw new ApiError(400, 'INVALID_BODY', 'Cookies content is required');
      }
      fs.writeFileSync(cookiesFile, req.body.cookies, 'utf8');
      res.json({ message: 'Cookies saved successfully' });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
};
