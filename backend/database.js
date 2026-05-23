import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure the data directory exists
// We will store database, channels.txt, and cookies.txt in a persistent 'data' folder
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'tiktok.db');
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

export const initDb = async () => {
  console.log(`[DB] Initializing SQLite database at: ${DB_PATH}`);

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
      status TEXT NOT NULL, -- 'pending', 'downloading', 'completed', 'failed'
      progress INTEGER DEFAULT 0,
      log_output TEXT DEFAULT '',
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    )
  `);

  console.log('[DB] SQLite database initialized successfully.');
  
  // Run database healing to fix any existing corrupt/numeric channel mappings
  await healDatabase();
};

const extractUsernameFromUrl = (url) => {
  if (!url) return null;
  const match = url.match(/@([a-zA-Z0-9_.-]+)/);
  if (match) {
    const handle = match[1].replace(/^@/, '');
    return `@${handle}`;
  }
  return null;
};

export const healDatabase = async () => {
  console.log('[DB-Healing] Checking for database inconsistencies...');
  try {
    // 1. Fetch all posts
    const posts = await dbAll('SELECT id, channel_id, url FROM posts');
    console.log(`[DB-Healing] Scanning ${posts.length} posts for incorrect channel links...`);

    for (const post of posts) {
      const correctChannelId = extractUsernameFromUrl(post.url);
      if (correctChannelId && correctChannelId !== post.channel_id) {
        console.log(`[DB-Healing] Found post ${post.id} linked to incorrect channel_id "${post.channel_id}". Correct is "${correctChannelId}".`);
        
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
          console.log(`[DB-Healing] Created correct channel: ${correctChannelId}`);
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
        console.log(`[DB-Healing] Re-linked post ${post.id} to ${correctChannelId}.`);
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
          console.log(`[DB-Healing] Deleted orphaned numeric channel: ${chan.id}`);
        }
      }
    }

    console.log('[DB-Healing] Database healing check completed.');
  } catch (err) {
    console.error('[DB-Healing] Error during database healing:', err);
  }
};
