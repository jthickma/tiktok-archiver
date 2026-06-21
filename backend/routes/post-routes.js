import { asyncRoute } from '../middleware/async-handler.js';
import { ApiError, parsePostsQuery, parseId } from '../validation.js';

/**
 * Post routes.
 * @param {import('express').Router} router
 * @param {Object} deps - { searchPosts, getPost, getPostMediaFiles, sendPostMedia, sendPostMediaFile, ensurePostThumbnails, downloadsDir, fs, path }
 */
export const createPostRoutes = (router, deps) => {
  const {
    searchPosts,
    getPost,
    getPostMediaFiles,
    sendPostMedia,
    sendPostMediaFile,
    ensurePostThumbnails,
    downloadsDir,
    fs,
    path,
  } = deps;

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const result = await searchPosts(parsePostsQuery(req.query));
      res.json({
        ...result,
        posts: await ensurePostThumbnails(result.posts, downloadsDir),
      });
    }),
  );

  router.get(
    '/:id/download',
    asyncRoute(async (req, res) => {
      await sendPostMedia({
        res,
        downloadsDir,
        post: await getPost(req.params.id),
      });
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
      await sendPostMediaFile({
        res,
        downloadsDir,
        post: await getPost(req.params.id),
        index,
      });
    }),
  );

  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
      const post = await getPost(req.params.id);
      if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
      const media = await getPostMediaFiles(post, downloadsDir, fs, path);
      res.json({
        post,
        media,
        images: media
          .filter((item) => item.kind === 'image')
          .map((item) => item.name),
      });
    }),
  );

  return router;
};
