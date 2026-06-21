/**
 * Post repository — all SQL queries for the posts table.
 * Each function accepts database helpers (dbRun, dbGet, dbAll) for dependency injection.
 */

const SORT_COLUMNS = {
  upload_date: 'upload_date',
  downloaded_at: 'downloaded_at',
  profile: 'channel_id',
  type: 'type',
  title: 'title',
};

/**
 * Build WHERE clause and params from a PostsQuery-like filter object.
 * @param {Object} filters
 * @returns {{where: string, params: Array}}
 */
const buildWhere = (filters) => {
  let where = 'WHERE 1=1';
  const params = [];

  if (filters.channelIds?.length) {
    where += ` AND channel_id IN (${filters.channelIds.map(() => '?').join(',')})`;
    params.push(...filters.channelIds);
  }
  if (filters.type) {
    where += ' AND type = ?';
    params.push(filters.type);
  }
  if (filters.search) {
    where += ' AND (title LIKE ? OR description LIKE ? OR channel_id LIKE ?)';
    params.push(
      `%${filters.search}%`,
      `%${filters.search}%`,
      `%${filters.search}%`,
    );
  }
  if (filters.dateFrom) {
    where += ' AND upload_date >= ?';
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    where += ' AND upload_date <= ?';
    params.push(filters.dateTo);
  }
  if (filters.missingThumbnail) {
    where += " AND (thumbnail_path IS NULL OR thumbnail_path = '')";
  }

  return { where, params };
};

/**
 * Search posts with pagination, sorting, and filtering.
 * @param {Function} dbAll
 * @param {Function} dbGet
 * @param {Object} query - PostsQuery-like object
 * @returns {Promise<{posts: Array, total: number, page: number, limit: number}>}
 */
export const searchPosts = (dbAll, dbGet, query) => {
  const { where, params } = buildWhere(query);
  const sortColumn = SORT_COLUMNS[query.sort] || SORT_COLUMNS.upload_date;
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC';

  const postsPromise = dbAll(
    `SELECT * FROM posts ${where}
     ORDER BY ${sortColumn} ${direction}, downloaded_at DESC
     LIMIT ? OFFSET ?`,
    [...params, query.limit, query.offset],
  );

  const countPromise = dbGet(
    `SELECT COUNT(*) as total FROM posts ${where}`,
    params,
  );

  return Promise.all([postsPromise, countPromise]).then(([posts, count]) => ({
    posts,
    total: count?.total || 0,
    page: query.page,
    limit: query.limit,
  }));
};

/**
 * Get a single post by its ID.
 * @param {Function} dbGet
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getPostById = (dbGet, id) =>
  dbGet('SELECT * FROM posts WHERE id = ?', [id]).then((row) => row || null);

/**
 * Insert a new post.
 * @param {Function} dbRun
 * @param {Object} postData
 * @returns {Promise<void>}
 */
export const insertPost = (dbRun, postData) =>
  dbRun(
    `INSERT OR REPLACE INTO posts
     (id, channel_id, type, title, description, url, upload_date, file_path, thumbnail_path, downloaded_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      postData.id,
      postData.channel_id,
      postData.type,
      postData.title,
      postData.description,
      postData.url,
      postData.upload_date,
      postData.file_path,
      postData.thumbnail_path,
      postData.downloaded_at,
      postData.metadata_json,
    ],
  );

/**
 * Update the thumbnail path for a post.
 * @param {Function} dbRun
 * @param {string} id
 * @param {string} thumbnailPath
 * @returns {Promise<void>}
 */
export const updatePostThumbnail = (dbRun, id, thumbnailPath) =>
  dbRun('UPDATE posts SET thumbnail_path = ? WHERE id = ?', [
    thumbnailPath,
    id,
  ]);

/**
 * Get total post count.
 * @param {Function} dbGet
 * @returns {Promise<number>}
 */
export const getPostCount = (dbGet) =>
  dbGet('SELECT COUNT(*) as total FROM posts').then((row) => row?.total || 0);

/**
 * Get all posts for a given channel.
 * @param {Function} dbAll
 * @param {string} channelId
 * @returns {Promise<Array>}
 */
export const getPostsByChannel = (dbAll, channelId) =>
  dbAll('SELECT * FROM posts WHERE channel_id = ? ORDER BY upload_date DESC', [
    channelId,
  ]);

/**
 * Get archive statistics: total posts, breakdown by type, breakdown by channel.
 * @param {Function} dbAll
 * @param {Function} dbGet
 * @returns {Promise<{totalPosts: number, byType: Object, byChannel: Array}>}
 */
export const getStorageStats = (dbAll, dbGet) =>
  Promise.all([
    dbAll('SELECT type, COUNT(*) as count FROM posts GROUP BY type'),
    dbAll(
      'SELECT channel_id, COUNT(*) as count FROM posts GROUP BY channel_id ORDER BY count DESC',
    ),
    dbGet('SELECT COUNT(*) as total FROM posts'),
  ]).then(([byTypeRows, byChannelRows, totalRow]) => {
    const byType = {};
    for (const row of byTypeRows) {
      byType[row.type] = row.count;
    }
    return {
      totalPosts: totalRow?.total || 0,
      byType,
      byChannel: byChannelRows,
    };
  });

/**
 * Find potential duplicate posts by URL.
 * @param {Function} dbAll
 * @returns {Promise<Array>}
 */
export const findDuplicates = (dbAll) =>
  dbAll(
    `SELECT url, COUNT(*) as count, GROUP_CONCAT(id) as ids
     FROM posts GROUP BY url HAVING count > 1`,
  );

/**
 * Batch delete posts by ID array.
 * @param {Function} dbRun
 * @param {string[]} ids
 * @returns {Promise<number>} Number of deleted rows
 */
export const deletePosts = (dbRun, ids) => {
  if (ids.length === 0) return Promise.resolve(0);
  const placeholders = ids.map(() => '?').join(',');
  return dbRun(`DELETE FROM posts WHERE id IN (${placeholders})`, ids).then(
    (result) => result.changes || 0,
  );
};

/**
 * Update a post's file_path and channel_id (used by profile path migration).
 * @param {Function} dbRun
 * @param {string} id
 * @param {string} filePath
 * @param {string} thumbnailPath
 * @param {string} metadataJson
 * @returns {Promise<void>}
 */
export const updatePostPaths = (
  dbRun,
  id,
  filePath,
  thumbnailPath,
  metadataJson,
) =>
  dbRun(
    'UPDATE posts SET file_path = ?, thumbnail_path = ?, metadata_json = ? WHERE id = ?',
    [filePath, thumbnailPath, metadataJson, id],
  );

/**
 * Get all posts (used by database healing).
 * @param {Function} dbAll
 * @returns {Promise<Array>}
 */
export const getAllPosts = (dbAll) =>
  dbAll(
    'SELECT id, channel_id, url, file_path, thumbnail_path, metadata_json FROM posts',
  );

/**
 * Update a post's channel_id (used by database healing).
 * @param {Function} dbRun
 * @param {string} postId
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export const updatePostChannel = (dbRun, postId, channelId) =>
  dbRun('UPDATE posts SET channel_id = ? WHERE id = ?', [channelId, postId]);
