import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateNumericProfilePaths, migrateSlideshowPostPaths, rewriteProfilePath } from './profile-path-migration.js';

test('rewriteProfilePath rewrites the directory and numeric filename prefix', () => {
  assert.equal(
    rewriteProfilePath('@123/@123_456.mp4', '@123', '@alice'),
    '@alice/@alice_456.mp4'
  );
  assert.equal(rewriteProfilePath('@other/file.mp4', '@123', '@alice'), '@other/file.mp4');
});

test('migration merges numeric downloads into an existing username directory', async (t) => {
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-migration-'));
  t.after(() => fs.rmSync(downloadsDir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(downloadsDir, '@123', '.thumbnails'), { recursive: true });
  fs.mkdirSync(path.join(downloadsDir, '@alice'), { recursive: true });
  fs.writeFileSync(path.join(downloadsDir, '@123', '@123_456.mp4'), 'video');
  fs.writeFileSync(path.join(downloadsDir, '@123', '.thumbnails', '@123_456.jpg'), 'thumb');
  fs.writeFileSync(path.join(downloadsDir, '@alice', '@alice_789.mp4'), 'newer video');

  const updates = [];
  const result = await migrateNumericProfilePaths({
    downloadsDir,
    posts: [{
      id: '456',
      channel_id: '@alice',
      file_path: '@123/@123_456.mp4',
      thumbnail_path: '@123/.thumbnails/@123_456.jpg',
      metadata_json: JSON.stringify({ media_files: ['@123/@123_456.mp4'] })
    }],
    updatePost: async (post) => updates.push(post)
  });

  assert.deepEqual(result, { mappings: 1, migratedDirectories: 1, updatedPosts: 1 });
  assert.equal(fs.existsSync(path.join(downloadsDir, '@123')), false);
  assert.equal(fs.readFileSync(path.join(downloadsDir, '@alice', '@alice_456.mp4'), 'utf8'), 'video');
  assert.equal(fs.readFileSync(path.join(downloadsDir, '@alice', '@alice_789.mp4'), 'utf8'), 'newer video');
  assert.equal(updates[0].filePath, '@alice/@alice_456.mp4');
  assert.equal(updates[0].thumbnailPath, '@alice/.thumbnails/@alice_456.jpg');
  assert.deepEqual(JSON.parse(updates[0].metadataJson).media_files, ['@alice/@alice_456.mp4']);
});

test('migration is idempotent after files moved but before database update', async (t) => {
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-migration-'));
  t.after(() => fs.rmSync(downloadsDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(downloadsDir, '@alice'), { recursive: true });
  fs.writeFileSync(path.join(downloadsDir, '@alice', '@123_456.mp4'), 'video');

  const updates = [];
  await migrateNumericProfilePaths({
    downloadsDir,
    posts: [{ id: '456', channel_id: '@alice', file_path: '@123/@123_456.mp4' }],
    updatePost: async (post) => updates.push(post)
  });

  assert.equal(fs.existsSync(path.join(downloadsDir, '@alice', '@123_456.mp4')), false);
  assert.equal(fs.existsSync(path.join(downloadsDir, '@alice', '@alice_456.mp4')), true);
  assert.equal(updates[0].filePath, '@alice/@alice_456.mp4');
});

test('slideshow migration makes the folder and each media filename readable', async (t) => {
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slideshow-migration-'));
  t.after(() => fs.rmSync(downloadsDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(downloadsDir, '@alice', '456'), { recursive: true });
  fs.writeFileSync(path.join(downloadsDir, '@alice', '456', 'image_1.jpg'), 'image');
  fs.writeFileSync(path.join(downloadsDir, '@alice', '456', 'image_0.mp3'), 'audio');

  const updates = [];
  const result = await migrateSlideshowPostPaths({
    downloadsDir,
    posts: [{
      id: '456',
      channel_id: '@alice',
      type: 'slideshow',
      file_path: '@alice/456',
      thumbnail_path: '@alice/456/image_1.jpg',
      metadata_json: JSON.stringify({ media_files: ['@alice/456/image_1.jpg', '@alice/456/image_0.mp3'] })
    }],
    updatePost: async (post) => updates.push(post)
  });

  const readableDirectory = path.join(downloadsDir, '@alice', '@alice_456');
  assert.deepEqual(result, { migratedPosts: 1, removedEmptyDirectories: 0 });
  assert.equal(fs.existsSync(path.join(downloadsDir, '@alice', '456')), false);
  assert.equal(fs.existsSync(path.join(readableDirectory, '@alice_456_image_1.jpg')), true);
  assert.equal(fs.existsSync(path.join(readableDirectory, '@alice_456_image_0.mp3')), true);
  assert.equal(updates[0].filePath, '@alice/@alice_456');
  assert.equal(updates[0].thumbnailPath, '@alice/@alice_456/@alice_456_image_1.jpg');
  assert.deepEqual(JSON.parse(updates[0].metadataJson).media_files, [
    '@alice/@alice_456/@alice_456_image_1.jpg',
    '@alice/@alice_456/@alice_456_image_0.mp3'
  ]);
});

test('slideshow migration removes empty legacy numeric post directories', async (t) => {
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slideshow-migration-'));
  t.after(() => fs.rmSync(downloadsDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(downloadsDir, '@alice', '123'), { recursive: true });

  const result = await migrateSlideshowPostPaths({
    downloadsDir,
    posts: [],
    updatePost: async () => {}
  });

  assert.deepEqual(result, { migratedPosts: 0, removedEmptyDirectories: 1 });
  assert.equal(fs.existsSync(path.join(downloadsDir, '@alice', '123')), false);
});
