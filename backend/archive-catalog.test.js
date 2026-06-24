import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createArchiveCatalog } from './archive-catalog.js';
import {
  createCatalogSchema,
  createTestDatabase,
} from './tests/helpers/database.js';

test('archive catalog keeps row and media-file behavior behind one interface', async (t) => {
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-'));
  t.after(() => fs.rmSync(downloadsDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(downloadsDir, '@alice'), { recursive: true });
  fs.writeFileSync(path.join(downloadsDir, '@alice', 'post.jpg'), 'image');
  fs.writeFileSync(path.join(downloadsDir, '@alice', 'orphan.jpg'), 'orphan');

  const database = createTestDatabase();
  await createCatalogSchema(database);
  t.after(() => database.close());
  await database.run(
    'INSERT INTO channels (id, username, url, created_at, is_monitored) VALUES (?, ?, ?, ?, ?)',
    ['@alice', 'alice', 'https://www.tiktok.com/@alice', new Date().toISOString(), 1],
  );
  await database.run(
    `INSERT INTO posts
     (id, channel_id, type, title, description, url, upload_date, file_path, thumbnail_path, downloaded_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['1', '@alice', 'image', 'Post', '', 'https://example.com/1', '2026-01-01', '@alice/post.jpg', '@alice/post.jpg', new Date().toISOString(), '{}'],
  );
  const catalog = createArchiveCatalog({ database, downloadsDir });

  const detail = await catalog.detail('1');
  assert.equal(detail.media[0].path, '@alice/post.jpg');
  const download = await catalog.resolveDownload('1');
  assert.equal(download.name, 'post.jpg');
  assert.deepEqual((await catalog.orphans()).map((item) => item.path), [
    '@alice/orphan.jpg',
  ]);
  assert.equal((await catalog.stats()).storage.byType.image, 2);
});
