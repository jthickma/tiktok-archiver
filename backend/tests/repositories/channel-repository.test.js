import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import {
  listChannels,
  getChannelById,
  upsertChannel,
  setMonitored,
  updateChannelUrl,
  updateLastChecked,
  getMonitoredUrls,
  getMonitoredChannels,
  deleteChannel,
  countChannelPosts,
} from '../../repositories/channel-repository.js';

/**
 * Create in-memory SQLite wrappers that match dbAll/dbGet/dbRun signatures.
 */
const createDb = () => {
  const db = new sqlite3.Database(':memory:');

  const dbRun = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });

  const dbGet = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

  const dbAll = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

  return { db, dbRun, dbGet, dbAll };
};

describe('channel-repository', () => {
  let db, dbRun, dbGet, dbAll;

  before(async () => {
    const ctx = createDb();
    db = ctx.db;
    dbRun = ctx.dbRun;
    dbGet = ctx.dbGet;
    dbAll = ctx.dbAll;

    await dbRun(`
      CREATE TABLE channels (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_checked_at TEXT,
        is_monitored INTEGER DEFAULT 1
      )
    `);
    await dbRun(`
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
        metadata_json TEXT,
        FOREIGN KEY (channel_id) REFERENCES channels (id)
      )
    `);
  });

  after(() => {
    db.close();
  });

  it('upsertChannel inserts a new channel', async () => {
    await upsertChannel(dbRun, {
      id: '@testuser',
      username: 'testuser',
      url: 'https://www.tiktok.com/@testuser',
      created_at: '2024-01-01T00:00:00.000Z',
      is_monitored: 1,
    });
    const channel = await getChannelById(dbGet, '@testuser');
    assert.ok(channel);
    assert.equal(channel.id, '@testuser');
    assert.equal(channel.is_monitored, 1);
  });

  it('upsertChannel replaces existing channel on duplicate id', async () => {
    await upsertChannel(dbRun, {
      id: '@testuser',
      username: 'testuser',
      url: 'https://www.tiktok.com/@testuser/v2',
      created_at: '2024-01-01T00:00:00.000Z',
      is_monitored: 0,
    });
    const channel = await getChannelById(dbGet, '@testuser');
    assert.equal(channel.url, 'https://www.tiktok.com/@testuser/v2');
    assert.equal(channel.is_monitored, 0);
  });

  it('setMonitored updates the is_monitored flag', async () => {
    await setMonitored(dbRun, '@testuser', 1);
    const channel = await getChannelById(dbGet, '@testuser');
    assert.equal(channel.is_monitored, 1);
  });

  it('updateChannelUrl sets URL and marks as monitored', async () => {
    await setMonitored(dbRun, '@testuser', 0);
    await updateChannelUrl(
      dbRun,
      '@testuser',
      'https://www.tiktok.com/@testuser/v3',
    );
    const channel = await getChannelById(dbGet, '@testuser');
    assert.equal(channel.url, 'https://www.tiktok.com/@testuser/v3');
    assert.equal(channel.is_monitored, 1);
  });

  it('updateLastChecked sets a timestamp', async () => {
    await updateLastChecked(dbRun, '@testuser');
    const channel = await getChannelById(dbGet, '@testuser');
    assert.ok(channel.last_checked_at);
    assert.ok(channel.last_checked_at.length > 0);
  });

  it('getMonitoredUrls returns only monitored channels', async () => {
    await upsertChannel(dbRun, {
      id: '@unmonitored',
      username: 'unmonitored',
      url: 'https://www.tiktok.com/@unmonitored',
      created_at: '2024-01-01T00:00:00.000Z',
      is_monitored: 0,
    });
    const urls = await getMonitoredUrls(dbAll);
    assert.ok(urls.every((u) => u.url));
    assert.equal(urls.filter((u) => u.url.includes('@testuser')).length, 1);
    assert.equal(urls.filter((u) => u.url.includes('@unmonitored')).length, 0);
  });

  it('getChannelById returns null for missing channel', async () => {
    const channel = await getChannelById(dbGet, '@nonexistent');
    assert.equal(channel, null);
  });

  it('countChannelPosts returns 0 for channel with no posts', async () => {
    const count = await countChannelPosts(dbGet, '@testuser');
    assert.equal(count, 0);
  });

  it('countChannelPosts returns correct count when posts exist', async () => {
    await dbRun(
      `INSERT INTO posts (id, channel_id, type, url, downloaded_at) VALUES (?, ?, ?, ?, ?)`,
      [
        'post1',
        '@testuser',
        'video',
        'https://tiktok.com/@testuser/video/1',
        '2024-01-01T00:00:00.000Z',
      ],
    );
    await dbRun(
      `INSERT INTO posts (id, channel_id, type, url, downloaded_at) VALUES (?, ?, ?, ?, ?)`,
      [
        'post2',
        '@testuser',
        'image',
        'https://tiktok.com/@testuser/video/2',
        '2024-01-01T00:00:00.000Z',
      ],
    );
    const count = await countChannelPosts(dbGet, '@testuser');
    assert.equal(count, 2);
  });

  it('listChannels includes downloaded_count', async () => {
    const channels = await listChannels(dbAll);
    const testChannel = channels.find((c) => c.id === '@testuser');
    assert.ok(testChannel);
    assert.equal(testChannel.downloaded_count, 2);
    assert.equal(testChannel.is_monitored, 1);
  });

  it('deleteChannel removes the channel', async () => {
    await deleteChannel(dbRun, '@unmonitored');
    const channel = await getChannelById(dbGet, '@unmonitored');
    assert.equal(channel, null);
  });

  it('getMonitoredChannels returns only monitored', async () => {
    await setMonitored(dbRun, '@testuser', 1);
    const monitored = await getMonitoredChannels(dbAll);
    assert.ok(monitored.every((c) => c.is_monitored === 1));
  });
});
