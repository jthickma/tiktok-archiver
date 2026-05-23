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
};
