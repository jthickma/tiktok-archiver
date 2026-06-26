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

  // Apply performance and concurrency tuning PRAGMAs
  await dbRun('PRAGMA journal_mode = WAL');
  await dbRun('PRAGMA synchronous = NORMAL');
  await dbRun('PRAGMA foreign_keys = ON');
  await dbRun('PRAGMA busy_timeout = 5000');

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
    // Start transaction for DB integrity and massive performance boost
    await dbRun('BEGIN TRANSACTION');

    // 1. Fetch all channels into memory to avoid per-post SELECTs
    const channelsList = await dbAll('SELECT * FROM channels');
    const channelMap = new Map(channelsList.map((c) => [c.id, c]));

    // Fetch all posts
    const posts = await dbAll('SELECT id, channel_id, url, file_path, thumbnail_path, metadata_json FROM posts');
    logger.info('database healing posts scanned', { count: posts.length });

    for (const post of posts) {
      const extractedUsername = extractUsername(post.url, parseMetadata(post.metadata_json));
      const correctChannelId = extractedUsername === '@unknown' ? null : extractedUsername;
      if (correctChannelId && correctChannelId !== post.channel_id) {
        logger.warn('post linked to incorrect channel', { post_id: post.id, channel_id: post.channel_id, correct_channel_id: correctChannelId });
        
        // Retrieve details from incorrect channel if it exists in memory map
        const oldChannel = channelMap.get(post.channel_id);
        const correctChannelExists = channelMap.has(correctChannelId);
        
        if (!correctChannelExists) {
          const isMonitored = oldChannel ? oldChannel.is_monitored : 0;
          const lastChecked = oldChannel ? oldChannel.last_checked_at : null;
          const createdAt = oldChannel ? oldChannel.created_at : new Date().toISOString();
          
          await dbRun(
            'INSERT INTO channels (id, username, url, created_at, last_checked_at, is_monitored) VALUES (?, ?, ?, ?, ?, ?)',
            [
              correctChannelId, 
              correctChannelId.replace(/^@/, ''), 
              `https://www.tiktok.com/${correctChannelId}`, 
              createdAt,
              lastChecked,
              isMonitored
            ]
          );
          
          const newChan = {
            id: correctChannelId,
            username: correctChannelId.replace(/^@/, ''),
            url: `https://www.tiktok.com/${correctChannelId}`,
            created_at: createdAt,
            last_checked_at: lastChecked,
            is_monitored: isMonitored
          };
          channelMap.set(correctChannelId, newChan);
          logger.info('database healing created channel', { channel_id: correctChannelId });
        } else if (oldChannel) {
          const correctChannel = channelMap.get(correctChannelId);
          // If old channel was monitored, make sure correct channel is monitored too
          if (oldChannel.is_monitored === 1 && correctChannel.is_monitored !== 1) {
            await dbRun('UPDATE channels SET is_monitored = 1 WHERE id = ?', [correctChannelId]);
            correctChannel.is_monitored = 1;
          }
          // If old channel has scan history and correct channel doesn't, copy last_checked_at
          if (oldChannel.last_checked_at && !correctChannel.last_checked_at) {
            await dbRun('UPDATE channels SET last_checked_at = ? WHERE id = ?', [oldChannel.last_checked_at, correctChannelId]);
            correctChannel.last_checked_at = oldChannel.last_checked_at;
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
    
    // Query post count grouped by channel in a single aggregate query to avoid loops
    const channelPostCounts = await dbAll('SELECT channel_id, COUNT(*) as count FROM posts GROUP BY channel_id');
    const postCountMap = new Map(channelPostCounts.map(r => [r.channel_id, r.count]));

    for (const chanId of channelMap.keys()) {
      const isNumeric = /^@\d+$/.test(chanId);
      if (isNumeric) {
        const postCount = postCountMap.get(chanId) || 0;
        
        if (postCount === 0) {
          await dbRun('DELETE FROM channels WHERE id = ?', [chanId]);
          logger.info('database healing deleted orphaned numeric channel', { channel_id: chanId });
        }
      }
    }

    // Commit healing changes before file migration
    await dbRun('COMMIT');

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
    try {
      await dbRun('ROLLBACK');
    } catch (_) {
      // Ignore if no transaction was active
    }
    logger.error('database healing failed', { error: err });
  }
};
