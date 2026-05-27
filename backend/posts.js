import { dbAll, dbGet } from './database.js';

const SORT_COLUMNS = {
  upload_date: 'upload_date',
  downloaded_at: 'downloaded_at',
  profile: 'channel_id',
  type: 'type',
  title: 'title'
};

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
    params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
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

export const searchPosts = async (filters) => {
  const { where, params } = buildWhere(filters);
  const sortColumn = SORT_COLUMNS[filters.sort] || SORT_COLUMNS.upload_date;
  const direction = filters.direction === 'asc' ? 'ASC' : 'DESC';

  const posts = await dbAll(
    `SELECT * FROM posts ${where}
     ORDER BY ${sortColumn} ${direction}, downloaded_at DESC
     LIMIT ? OFFSET ?`,
    [...params, filters.limit, filters.offset]
  );

  const count = await dbGet(`SELECT COUNT(*) as total FROM posts ${where}`, params);
  return {
    posts,
    total: count?.total || 0,
    page: filters.page,
    limit: filters.limit
  };
};

export const getPost = async (id) => dbGet('SELECT * FROM posts WHERE id = ?', [id]);

export const getPostSlideshowImages = async (post, downloadsDir, fs, path) => {
  if (!post || post.type !== 'slideshow' || !post.file_path) return [];
  const slideshowDir = path.resolve(downloadsDir, post.file_path);
  if (!slideshowDir.startsWith(path.resolve(downloadsDir)) || !fs.existsSync(slideshowDir)) {
    return [];
  }
  return fs.readdirSync(slideshowDir)
    .filter((file) => /\.(jpg|jpeg|png|webp|image)$/i.test(file))
    .sort((a, b) => {
      const numA = Number.parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const numB = Number.parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });
};
