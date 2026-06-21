import { dbAll, dbGet, dbRun } from './database.js';
import {
  isMediaFile,
  isImageFile,
  isVideoFile,
  isAudioFile,
  mediaKind,
  walkFiles,
} from './utils/media-files.js';
import {
  safeResolve,
  toWebPath,
  toWebPathRelative,
} from './utils/path-utils.js';
import {
  searchPosts as repoSearchPosts,
  getPostById,
  insertPost,
} from './repositories/post-repository.js';

export const searchPosts = async (filters) =>
  repoSearchPosts(dbAll, dbGet, filters);

export const getPost = async (id) => getPostById(dbGet, id);

export const savePost = async (postData) => insertPost(dbRun, postData);

export const getPostMediaFiles = async (post, downloadsDir, fs, path) => {
  if (!post || !post.file_path) return [];
  const fullPath = safeResolve(downloadsDir, post.file_path);
  if (!fullPath || !fs.existsSync(fullPath)) {
    return [];
  }

  const root = path.resolve(downloadsDir);
  const files = fs.statSync(fullPath).isDirectory()
    ? walkFiles(fullPath, fs, path)
    : [fullPath];

  return files
    .filter((file) => isMediaFile(file))
    .sort((a, b) => {
      const relA = path.relative(fullPath, a);
      const relB = path.relative(fullPath, b);
      return relA.localeCompare(relB, undefined, { numeric: true });
    })
    .map((file, index) => {
      const relativePath = toWebPathRelative(path.relative(root, file));
      return {
        index,
        name: path.basename(file),
        path: relativePath,
        kind: mediaKind(file),
        size: fs.statSync(file).size,
      };
    });
};

export const getPostSlideshowImages = async (post, downloadsDir, fs, path) => {
  const media = await getPostMediaFiles(post, downloadsDir, fs, path);
  return media.filter((item) => item.kind === 'image').map((item) => item.name);
};
