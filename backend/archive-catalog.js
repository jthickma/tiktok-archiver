import fs from 'fs';
import path from 'path';
import { ApiError } from './validation.js';
import { ensurePostThumbnails } from './thumbnails.js';
import {
  collectMediaFiles,
  isMediaFile,
  mediaKind,
  walkFiles,
} from './utils/media-files.js';
import { safeResolve, toWebPathRelative } from './utils/path-utils.js';
import * as posts from './repositories/post-repository.js';

/**
 * Deep archive catalog module.
 *
 * Owns the invariant between catalog rows and media on disk: search results,
 * post detail, safe downloads, thumbnails, statistics, orphan detection, and
 * maintenance all cross one interface.
 */
export const createArchiveCatalog = ({ database, downloadsDir }) => {
  const { all, get, run } = database;

  const findById = (id) => posts.getPostById(get, id);
  const findByUrl = (url) =>
    get('SELECT * FROM posts WHERE url = ?', [url]).then((row) => row || null);

  const save = async (postData, { sourceUrl = postData.url } = {}) => {
    await run(
      `INSERT OR IGNORE INTO channels
       (id, username, url, created_at, is_monitored)
       VALUES (?, ?, ?, ?, 0)`,
      [
        postData.channel_id,
        postData.channel_id.replace(/^@/, ''),
        sourceUrl,
        new Date().toISOString(),
      ],
    );
    await posts.insertPost(run, postData);
    return postData;
  };

  const mediaFiles = (post) => {
    if (!post?.file_path) return [];
    const fullPath = safeResolve(downloadsDir, post.file_path);
    if (!fullPath || !fs.existsSync(fullPath)) return [];
    const root = path.resolve(downloadsDir);
    const files = fs.statSync(fullPath).isDirectory()
      ? walkFiles(fullPath, fs, path)
      : [fullPath];
    return files
      .filter(isMediaFile)
      .sort((a, b) =>
        path
          .relative(fullPath, a)
          .localeCompare(path.relative(fullPath, b), undefined, {
            numeric: true,
          }),
      )
      .map((file, index) => ({
        index,
        name: path.basename(file),
        path: toWebPathRelative(path.relative(root, file)),
        kind: mediaKind(file),
        size: fs.statSync(file).size,
      }));
  };

  const search = async (query) => {
    const result = await posts.searchPosts(all, get, query);
    return {
      ...result,
      posts: await ensurePostThumbnails(result.posts, downloadsDir),
    };
  };

  const detail = async (id) => {
    const post = await posts.getPostById(get, id);
    if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
    const media = mediaFiles(post);
    return {
      post,
      media,
      images: media
        .filter((item) => item.kind === 'image')
        .map((item) => item.name),
    };
  };

  const resolveDownload = async (id, index = null) => {
    const post = await posts.getPostById(get, id);
    if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
    if (!post.file_path) {
      throw new ApiError(400, 'NO_MEDIA', 'Post has no archived media');
    }
    const fullPath = safeResolve(downloadsDir, post.file_path);
    if (!fullPath) {
      throw new ApiError(
        400,
        'INVALID_PATH',
        'Media path is outside downloads directory',
      );
    }
    if (!fs.existsSync(fullPath)) {
      throw new ApiError(404, 'NOT_FOUND', 'File not found on server');
    }
    if (index === null) {
      if (fs.statSync(fullPath).isDirectory()) {
        throw new ApiError(
          400,
          'DIRECTORY_DOWNLOAD_DISABLED',
          'Directory downloads are disabled',
        );
      }
      return { path: fullPath, name: path.basename(post.file_path) };
    }
    const file = collectMediaFiles(fullPath)[index];
    if (!file) {
      throw new ApiError(404, 'NOT_FOUND', 'Media file not found');
    }
    return { path: file, name: path.basename(file) };
  };

  const stats = async () => {
    const catalog = await posts.getStorageStats(all, get);
    if (!fs.existsSync(downloadsDir)) {
      return {
        ...catalog,
        storage: { totalBytes: 0, byChannel: [], byType: {} },
      };
    }
    const byChannel = [];
    const byType = { image: 0, video: 0, audio: 0, file: 0 };
    let totalBytes = 0;
    for (const entry of fs.readdirSync(downloadsDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const files = collectMediaFiles(path.join(downloadsDir, entry.name));
      let bytes = 0;
      for (const file of files) {
        try {
          const size = fs.statSync(file).size;
          bytes += size;
          totalBytes += size;
          byType[mediaKind(file)] += 1;
        } catch {
          // A concurrent cleanup may remove a file during the scan.
        }
      }
      byChannel.push({ name: entry.name, bytes, fileCount: files.length });
    }
    return { ...catalog, storage: { totalBytes, byChannel, byType } };
  };

  const orphans = async () => {
    if (!fs.existsSync(downloadsDir)) return [];
    const rows = await all(
      "SELECT file_path FROM posts WHERE file_path IS NOT NULL AND file_path != ''",
    );
    const knownPaths = rows.map((row) => row.file_path);
    return collectMediaFiles(downloadsDir).flatMap((file) => {
      const relative = toWebPathRelative(path.relative(downloadsDir, file));
      if (knownPaths.some((known) => relative === known || relative.startsWith(`${known}/`))) {
        return [];
      }
      try {
        return [{ path: relative, bytes: fs.statSync(file).size }];
      } catch {
        return [{ path: relative, bytes: 0 }];
      }
    });
  };

  const cleanupOrphans = async () => {
    const found = await orphans();
    let removed = 0;
    let freedBytes = 0;
    for (const orphan of found) {
      const fullPath = safeResolve(downloadsDir, orphan.path);
      if (!fullPath) continue;
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          removed += 1;
          freedBytes += orphan.bytes;
        }
      } catch {
        // Report only files that were actually removed.
      }
    }
    return { removed, freedBytes };
  };

  const deduplicate = async () => {
    const duplicates = await posts.findDuplicates(all);
    let merged = 0;
    for (const duplicate of duplicates) {
      const [, ...removeIds] = duplicate.ids.split(',');
      for (const id of removeIds) {
        await run('DELETE FROM posts WHERE id = ?', [id]);
        merged += 1;
      }
    }
    return { found: duplicates.length, merged };
  };

  return Object.freeze({
    findById,
    findByUrl,
    save,
    search,
    detail,
    resolveDownload,
    stats,
    orphans,
    cleanupOrphans,
    deduplicate,
  });
};
