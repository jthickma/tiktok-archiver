import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import {
  searchPosts,
  getPostById,
  insertPost,
  updatePostThumbnail,
  getPostCount,
  getPostsByChannel,
  getStorageStats,
  findDuplicates,
  deletePosts,
  updatePostPaths,
  getAllPosts,
  updatePostChannel,
} from '../../repositories/post-repository.js';

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

describe('post-repository', () => {
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

    await dbRun(
      `INSERT INTO channels (id, username, url, created_at) VALUES (?, ?, ?, ?)`,
      [
        '@user1',
        'user1',
        'https://tiktok.com/@user1',
        '2024-01-01T00:00:00.000Z',
      ],
    );
    await dbRun(
      `INSERT INTO channels (id, username, url, created_at) VALUES (?, ?, ?, ?)`,
      [
        '@user2',
        'user2',
        'https://tiktok.com/@user2',
        '2024-01-01T00:00:00.000Z',
      ],
    );
  });

  after(() => {
    db.close();
  });

  it('insertPost creates a new post', async () => {
    await insertPost(dbRun, {
      id: 'post1',
      channel_id: '@user1',
      type: 'video',
      title: 'Test Video',
      description: 'A test video post',
      url: 'https://tiktok.com/@user1/video/1',
      upload_date: '2024-01-15',
      file_path: '@user1/2024-01-15_post1.mp4',
      thumbnail_path: '@user1/2024-01-15_post1.jpg',
      downloaded_at: '2024-01-15T12:00:00.000Z',
      metadata_json: '{"source": "test"}',
    });
    const post = await getPostById(dbGet, 'post1');
    assert.ok(post);
    assert.equal(post.title, 'Test Video');
    assert.equal(post.type, 'video');
  });

  it('insertPost replaces existing post on duplicate id', async () => {
    await insertPost(dbRun, {
      id: 'post1',
      channel_id: '@user1',
      type: 'image',
      title: 'Updated Title',
      description: '',
      url: 'https://tiktok.com/@user1/video/1',
      upload_date: '2024-01-15',
      file_path: '@user1/2024-01-15_post1.jpg',
      thumbnail_path: '@user1/2024-01-15_post1_thumb.jpg',
      downloaded_at: '2024-01-15T13:00:00.000Z',
      metadata_json: '{}',
    });
    const post = await getPostById(dbGet, 'post1');
    assert.equal(post.title, 'Updated Title');
    assert.equal(post.type, 'image');
  });

  it('updatePostThumbnail sets thumbnail_path', async () => {
    await updatePostThumbnail(dbRun, 'post1', 'new-thumb.jpg');
    const post = await getPostById(dbGet, 'post1');
    assert.equal(post.thumbnail_path, 'new-thumb.jpg');
  });

  it('getPostCount returns total count', async () => {
    // Add a second post
    await insertPost(dbRun, {
      id: 'post2',
      channel_id: '@user1',
      type: 'slideshow',
      title: 'Slideshow',
      description: '',
      url: 'https://tiktok.com/@user1/video/2',
      upload_date: '2024-02-01',
      file_path: '@user1/2024-02-01_post2',
      thumbnail_path: '',
      downloaded_at: '2024-02-01T00:00:00.000Z',
      metadata_json: '{}',
    });
    const count = await getPostCount(dbGet);
    assert.equal(count, 2);
  });

  it('getPostsByChannel returns channel posts ordered by upload_date DESC', async () => {
    const posts = await getPostsByChannel(dbAll, '@user1');
    assert.equal(posts.length, 2);
    assert.ok(new Date(posts[0].upload_date) >= new Date(posts[1].upload_date));
  });

  it('getPostById returns null for missing post', async () => {
    const post = await getPostById(dbGet, 'nonexistent');
    assert.equal(post, null);
  });

  it('searchPosts returns paginated results', async () => {
    const result = await searchPosts(dbAll, dbGet, {
      page: 1,
      limit: 10,
      offset: 0,
      sort: 'upload_date',
      direction: 'asc',
      channelIds: [],
      type: '',
      search: '',
      dateFrom: '',
      dateTo: '',
      missingThumbnail: false,
    });
    assert.equal(result.total, 2);
    assert.equal(result.posts.length, 2);
    assert.equal(result.page, 1);
    assert.equal(result.limit, 10);
  });

  it('searchPosts filters by search term', async () => {
    const result = await searchPosts(dbAll, dbGet, {
      page: 1,
      limit: 10,
      offset: 0,
      sort: 'upload_date',
      direction: 'desc',
      channelIds: [],
      type: '',
      search: 'Slideshow',
      dateFrom: '',
      dateTo: '',
      missingThumbnail: false,
    });
    assert.equal(result.total, 1);
    assert.equal(result.posts[0].id, 'post2');
  });

  it('searchPosts filters by channelIds', async () => {
    const result = await searchPosts(dbAll, dbGet, {
      page: 1,
      limit: 10,
      offset: 0,
      sort: 'upload_date',
      direction: 'desc',
      channelIds: ['@user2'],
      type: '',
      search: '',
      dateFrom: '',
      dateTo: '',
      missingThumbnail: false,
    });
    assert.equal(result.total, 0);
  });

  it('getStorageStats returns aggregate stats', async () => {
    const stats = await getStorageStats(dbAll, dbGet);
    assert.equal(stats.totalPosts, 2);
    assert.ok(
      stats.byType.video || stats.byType.image || stats.byType.slideshow,
    );
    assert.ok(stats.byChannel.length > 0);
  });

  it('findDuplicates detects duplicate URLs', async () => {
    // Insert a duplicate URL
    await insertPost(dbRun, {
      id: 'post3',
      channel_id: '@user2',
      type: 'video',
      title: 'Duplicate URL',
      description: '',
      url: 'https://tiktok.com/@user1/video/1',
      upload_date: '2024-03-01',
      file_path: '@user2/2024-03-01_post3.mp4',
      thumbnail_path: '',
      downloaded_at: '2024-03-01T00:00:00.000Z',
      metadata_json: '{}',
    });
    const dupes = await findDuplicates(dbAll);
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].url, 'https://tiktok.com/@user1/video/1');
    assert.equal(dupes[0].count, 2);
  });

  it('deletePosts removes posts by IDs', async () => {
    const deleted = await deletePosts(dbRun, ['post3']);
    assert.equal(deleted, 1);
    const count = await getPostCount(dbGet);
    assert.equal(count, 2);
  });

  it('deletePosts returns 0 for empty array', async () => {
    const deleted = await deletePosts(dbRun, []);
    assert.equal(deleted, 0);
  });

  it('updatePostPaths updates file_path, thumbnail_path, metadata_json', async () => {
    await updatePostPaths(
      dbRun,
      'post1',
      '/new/path/file.mp4',
      '/new/path/thumb.jpg',
      '{"updated": true}',
    );
    const post = await getPostById(dbGet, 'post1');
    assert.equal(post.file_path, '/new/path/file.mp4');
    assert.equal(post.thumbnail_path, '/new/path/thumb.jpg');
    assert.equal(post.metadata_json, '{"updated": true}');
  });

  it('getAllPosts returns all posts with limited fields', async () => {
    const all = await getAllPosts(dbAll);
    assert.ok(all.length >= 2);
    assert.ok(all[0].id);
    assert.ok(all[0].channel_id);
    assert.ok(all[0].url);
    // Should not have full fields
    assert.equal(all[0].downloaded_at, undefined);
  });

  it('updatePostChannel changes a post channel_id', async () => {
    await updatePostChannel(dbRun, 'post2', '@user2');
    const post = await getPostById(dbGet, 'post2');
    assert.equal(post.channel_id, '@user2');
  });
});
