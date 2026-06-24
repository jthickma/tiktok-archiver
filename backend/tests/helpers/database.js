import sqlite3 from 'sqlite3';

export const createTestDatabase = () => {
  const connection = new sqlite3.Database(':memory:');
  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      connection.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      connection.get(sql, params, (error, row) => {
        if (error) reject(error);
        else resolve(row);
      });
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      connection.all(sql, params, (error, rows) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });
  const close = () =>
    new Promise((resolve, reject) => {
      connection.close((error) => (error ? reject(error) : resolve()));
    });
  return { connection, run, get, all, close };
};

export const createCatalogSchema = async (database) => {
  await database.run(`
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_checked_at TEXT,
      is_monitored INTEGER DEFAULT 1
    )
  `);
  await database.run(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      url TEXT NOT NULL,
      upload_date TEXT,
      file_path TEXT,
      thumbnail_path TEXT,
      downloaded_at TEXT NOT NULL,
      metadata_json TEXT
    )
  `);
};

export const createQueueSchema = async (database) => {
  await database.run(`
    CREATE TABLE download_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
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
  await database.run(`
    CREATE TABLE download_job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL
    )
  `);
};
