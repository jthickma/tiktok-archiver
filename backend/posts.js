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

const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|mp4|m4v|mov|webm|mkv|mp3|m4a|wav|flac|ogg|opus|image)$/i;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|image)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|flac|ogg|opus)$/i;

const toWebPath = (relativePath) => relativePath.replaceAll('\\', '/');

const safeResolve = (downloadsDir, relativePath, path) => {
  const root = path.resolve(downloadsDir);
  const resolved = path.resolve(root, relativePath || '');
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
};

const walkFiles = (dir, fs, path) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === '.thumbnails') return [];
    if (entry.isDirectory()) return walkFiles(fullPath, fs, path);
    return [fullPath];
  });
};

const mediaKind = (filePath) => {
  if (IMAGE_EXTENSIONS.test(filePath)) return 'image';
  if (VIDEO_EXTENSIONS.test(filePath)) return 'video';
  if (AUDIO_EXTENSIONS.test(filePath)) return 'audio';
  return 'file';
};

export const getPostMediaFiles = async (post, downloadsDir, fs, path) => {
  if (!post || !post.file_path) return [];
  const fullPath = safeResolve(downloadsDir, post.file_path, path);
  if (!fullPath || !fs.existsSync(fullPath)) {
    return [];
  }

  const root = path.resolve(downloadsDir);
  const files = fs.statSync(fullPath).isDirectory() ? walkFiles(fullPath, fs, path) : [fullPath];

  return files
    .filter((file) => MEDIA_EXTENSIONS.test(file))
    .sort((a, b) => {
      const relA = path.relative(fullPath, a);
      const relB = path.relative(fullPath, b);
      return relA.localeCompare(relB, undefined, { numeric: true });
    })
    .map((file, index) => {
      const relativePath = toWebPath(path.relative(root, file));
      return {
        index,
        name: path.basename(file),
        path: relativePath,
        kind: mediaKind(file),
        size: fs.statSync(file).size
      };
    });
};

export const getPostSlideshowImages = async (post, downloadsDir, fs, path) => {
  const media = await getPostMediaFiles(post, downloadsDir, fs, path);
  return media.filter((item) => item.kind === 'image').map((item) => item.name);
};
