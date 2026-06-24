import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { extractUsername } from './identity.js';
import { migrateNumericProfilePaths, migrateSlideshowPostPaths } from './profile-path-migration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure the data directory exists
// We will store database, channels.txt, and cookies.txt in a persistent 'data' folder
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'tiktok.db');
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(__dirname, '../downloads');
const db = new sqlite3.Database(DB_PATH);

// Wrap sqlite3 methods in Promises for async/await usage
export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

/**
 * Stable database adapter used by deep modules.
 *
 * Passing one adapter keeps SQL mechanics behind a single seam instead of
 * threading three unrelated helper functions through every call.
 */
export const database = Object.freeze({
  run: dbRun,
  get: dbGet,
  all: dbAll,
});

const tableColumns = async (tableName) => {
  const columns = await dbAll(`PRAGMA table_info(${tableName})`);
  return new Set(columns.map((column) => column.name));
};

const addColumnIfMissing = async (tableName, columnName, definition) => {
  const columns = await tableColumns(tableName);
  if (!columns.has(columnName)) {
    await dbRun(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    logger.info('database column added', { table: tableName, column: columnName });
  }
};

export const initDb = async () => {
  logger.info('initializing sqlite database', { path: DB_PATH });

  await dbRun(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // Create Channels table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_checked_at TEXT,
      is_monitored INTEGER DEFAULT 1
    )
  `);

  // Create Posts table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      type TEXT NOT NULL, -- 'video' or 'slideshow'
      title TEXT,
      description TEXT,
      url TEXT NOT NULL,
      upload_date TEXT, -- YYYY-MM-DD
      file_path TEXT, -- relative to download dir or absolute
      thumbnail_path TEXT,
      downloaded_at TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE CASCADE
    )
  `);

  // Create active download queue table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS download_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL, -- 'channel' or 'post'
      status TEXT NOT NULL, -- 'pending', 'downloading', 'completed', 'failed', 'cancelled'
      progress INTEGER DEFAULT 0,
      log_output TEXT DEFAULT '',
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      next_attempt_at TEXT,
      last_error_class TEXT,
      cancelled_at TEXT
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS download_job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES download_jobs (id) ON DELETE CASCADE
    )
  `);

  // Apply column migrations to pre-existing tables BEFORE creating indexes,
  // since the indexes below reference columns added here (e.g. next_attempt_at).
  await addColumnIfMissing('download_jobs', 'attempt_count', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('download_jobs', 'max_attempts', 'INTEGER DEFAULT 3');
  await addColumnIfMissing('download_jobs', 'next_attempt_at', 'TEXT');
  await addColumnIfMissing('download_jobs', 'last_error_class', 'TEXT');
  await addColumnIfMissing('download_jobs', 'cancelled_at', 'TEXT');

  await dbRun('CREATE INDEX IF NOT EXISTS idx_download_jobs_status_next ON download_jobs (status, next_attempt_at, id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_download_job_logs_job_id ON download_job_logs (job_id, id)');

  await dbRun(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
    ['001_initial_and_queue_controls', new Date().toISOString()]
  );

  logger.info('sqlite database initialized');
  
  // Run database healing to fix any existing corrupt/numeric channel mappings
  await healDatabase();
};

const parseMetadata = (metadataJson) => {
  if (!metadataJson) return {};
  try {
    const metadata = JSON.parse(metadataJson);
    return metadata && typeof metadata === 'object' ? metadata : {};
  } catch {
    return {};
  }
};

export const healDatabase = async () => {
  logger.info('database healing check started');
  try {
    // 1. Fetch all posts
    const posts = await dbAll('SELECT id, channel_id, url, file_path, thumbnail_path, metadata_json FROM posts');
    logger.info('database healing posts scanned', { count: posts.length });

    for (const post of posts) {
      const extractedUsername = extractUsername(post.url, parseMetadata(post.metadata_json));
      const correctChannelId = extractedUsername === '@unknown' ? null : extractedUsername;
      if (correctChannelId && correctChannelId !== post.channel_id) {
        logger.warn('post linked to incorrect channel', { post_id: post.id, channel_id: post.channel_id, correct_channel_id: correctChannelId });
        
        // Retrieve details from incorrect channel if it exists
        const oldChannel = await dbGet('SELECT * FROM channels WHERE id = ?', [post.channel_id]);
        
        // Ensure correct channel exists
        const correctChannelExists = await dbGet('SELECT * FROM channels WHERE id = ?', [correctChannelId]);
        if (!correctChannelExists) {
          const isMonitored = oldChannel ? oldChannel.is_monitored : 0;
          const lastChecked = oldChannel ? oldChannel.last_checked_at : null;
          await dbRun(
            'INSERT INTO channels (id, username, url, created_at, last_checked_at, is_monitored) VALUES (?, ?, ?, ?, ?, ?)',
            [
              correctChannelId, 
              correctChannelId.replace(/^@/, ''), 
              `https://www.tiktok.com/${correctChannelId}`, 
              oldChannel ? oldChannel.created_at : new Date().toISOString(),
              lastChecked,
              isMonitored
            ]
          );
          logger.info('database healing created channel', { channel_id: correctChannelId });
        } else if (oldChannel) {
          // If old channel was monitored, make sure correct channel is monitored too
          if (oldChannel.is_monitored === 1) {
            await dbRun('UPDATE channels SET is_monitored = 1 WHERE id = ?', [correctChannelId]);
          }
          // If old channel has scan history and correct channel doesn't, copy last_checked_at
          if (oldChannel.last_checked_at && !correctChannelExists.last_checked_at) {
            await dbRun('UPDATE channels SET last_checked_at = ? WHERE id = ?', [oldChannel.last_checked_at, correctChannelId]);
          }
        }

        // Update the post to link to the correct channel
        await dbRun('UPDATE posts SET channel_id = ? WHERE id = ?', [correctChannelId, post.id]);
        logger.info('database healing relinked post', { post_id: post.id, channel_id: correctChannelId });
      }
    }

    // 2. Clean up duplicate/incorrect channels
    // Any channel whose ID starts with '@' followed only by digits (numeric ID) and has 0 posts
    // can be safely removed.
    const allChannels = await dbAll('SELECT id FROM channels');
    for (const chan of allChannels) {
      const isNumeric = /^@\d+$/.test(chan.id);
      if (isNumeric) {
        // Count posts remaining
        const postCountRes = await dbGet('SELECT COUNT(*) as count FROM posts WHERE channel_id = ?', [chan.id]);
        const postCount = postCountRes ? postCountRes.count : 0;
        
        if (postCount === 0) {
          await dbRun('DELETE FROM channels WHERE id = ?', [chan.id]);
          logger.info('database healing deleted orphaned numeric channel', { channel_id: chan.id });
        }
      }
    }

    const healedPosts = await dbAll(
      'SELECT id, channel_id, type, file_path, thumbnail_path, metadata_json FROM posts'
    );
    const migration = await migrateNumericProfilePaths({
      downloadsDir: DOWNLOADS_DIR,
      posts: healedPosts,
      updatePost: ({ id, filePath, thumbnailPath, metadataJson }) => dbRun(
        'UPDATE posts SET file_path = ?, thumbnail_path = ?, metadata_json = ? WHERE id = ?',
        [filePath, thumbnailPath, metadataJson, id]
      ),
      logger
    });
    if (migration.mappings > 0) {
      logger.info('numeric profile path migration completed', migration);
    }
    const postsAfterProfileMigration = await dbAll(
      'SELECT id, channel_id, type, file_path, thumbnail_path, metadata_json FROM posts'
    );
    const slideshowMigration = await migrateSlideshowPostPaths({
      downloadsDir: DOWNLOADS_DIR,
      posts: postsAfterProfileMigration,
      updatePost: ({ id, filePath, thumbnailPath, metadataJson }) => dbRun(
        'UPDATE posts SET file_path = ?, thumbnail_path = ?, metadata_json = ? WHERE id = ?',
        [filePath, thumbnailPath, metadataJson, id]
      ),
      logger
    });
    if (slideshowMigration.migratedPosts > 0 || slideshowMigration.removedEmptyDirectories > 0) {
      logger.info('slideshow path migration completed', slideshowMigration);
    }

    logger.info('database healing check completed');
  } catch (err) {
    logger.error('database healing failed', { error: err });
  }
};
