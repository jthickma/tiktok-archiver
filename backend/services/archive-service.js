/**
 * Archive service — provides archive statistics, storage breakdown,
 * orphan file detection, and deduplication functionality.
 */
import fs from 'fs';
import path from 'path';
import {
  getStorageStats,
  findDuplicates,
  getPostById,
} from '../repositories/post-repository.js';
import { collectMediaFiles } from '../utils/media-files.js';
import { safeResolve } from '../utils/path-utils.js';

/**
 * Get archive statistics: total posts, breakdown by type, breakdown by channel.
 * @param {Function} dbAll
 * @param {Function} dbGet
 * @returns {Promise<Object>}
 */
export const getArchiveStats = async (dbAll, dbGet) =>
  getStorageStats(dbAll, dbGet);

/**
 * Get storage breakdown — disk usage per channel and per type.
 * @param {string} downloadsDir
 * @returns {Promise<Object>}
 */
export const getStorageBreakdown = async (downloadsDir) => {
  if (!fs.existsSync(downloadsDir)) {
    return { totalBytes: 0, byChannel: [], byType: {} };
  }

  const channelDirs = fs
    .readdirSync(downloadsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);

  const byChannel = [];
  let totalBytes = 0;
  const typeCounts = { image: 0, video: 0, audio: 0, file: 0 };

  for (const channelName of channelDirs) {
    const channelPath = path.join(downloadsDir, channelName);
    const files = collectMediaFiles(channelPath);
    let channelBytes = 0;

    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        channelBytes += stat.size;
        totalBytes += stat.size;
      } catch {
        // Skip files we can't stat
      }
    }

    byChannel.push({
      name: channelName,
      bytes: channelBytes,
      fileCount: files.length,
    });
  }

  return { totalBytes, byChannel, byType: typeCounts };
};

/**
 * Find orphan files — files in the downloads directory not linked to any post.
 * @param {string} downloadsDir
 * @param {Function} dbAll
 * @returns {Promise<Array<{path: string, bytes: number}>>}
 */
export const findOrphanFiles = async (downloadsDir, dbAll) => {
  if (!fs.existsSync(downloadsDir)) return [];

  // Get all known file_paths from the database
  const posts = await dbAll(
    "SELECT file_path FROM posts WHERE file_path IS NOT NULL AND file_path != ''",
  );
  const knownPaths = new Set(posts.map((p) => p.file_path));

  // Walk all files in downloads dir
  const allFiles = collectMediaFiles(downloadsDir);
  const orphans = [];

  for (const file of allFiles) {
    const relPath = path.relative(downloadsDir, file);
    // Check if this file or any parent directory matches a known path
    const isKnown = Array.from(knownPaths).some((known) =>
      relPath.startsWith(known),
    );
    if (!isKnown) {
      try {
        const stat = fs.statSync(file);
        orphans.push({ path: relPath, bytes: stat.size });
      } catch {
        orphans.push({ path: relPath, bytes: 0 });
      }
    }
  }

  return orphans;
};

/**
 * Remove orphan files from disk.
 * @param {Array<{path: string, bytes: number}>} orphanFiles
 * @param {string} downloadsDir
 * @returns {Promise<{removed: number, freedBytes: number}>}
 */
export const cleanupOrphans = async (orphanFiles, downloadsDir) => {
  let removed = 0;
  let freedBytes = 0;

  for (const orphan of orphanFiles) {
    const fullPath = safeResolve(downloadsDir, orphan.path);
    if (!fullPath) continue;
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        removed++;
        freedBytes += orphan.bytes;
      }
    } catch {
      // Skip files we can't remove
    }
  }

  return { removed, freedBytes };
};

/**
 * Find and merge duplicate posts (by URL).
 * @param {Function} dbAll
 * @param {Function} dbGet
 * @param {Function} dbRun
 * @returns {Promise<{found: number, merged: number}>}
 */
export const deduplicatePosts = async (dbAll, dbGet, dbRun) => {
  const duplicates = await findDuplicates(dbAll);
  let merged = 0;

  for (const dup of duplicates) {
    const ids = dup.ids.split(',');
    // Keep the first one (oldest), remove the rest
    for (let i = 1; i < ids.length; i++) {
      await dbRun('DELETE FROM posts WHERE id = ?', [ids[i]]);
      merged++;
    }
  }

  return { found: duplicates.length, merged };
};
