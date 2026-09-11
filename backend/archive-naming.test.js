import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileArchiveDirectory, createVideoArchiveBase } from './archive-naming.js';

test('video archive names include creator, upload date, and post ID', () => {
  assert.equal(
    createVideoArchiveBase({
      creator: '@alice',
      uploadDate: '2026-06-18',
      postId: '7512345678901234567'
    }),
    'alice2026-06-187512345678901234567'
  );
});

test('video archive names reject missing or malformed identity fields', () => {
  assert.throws(
    () => createVideoArchiveBase({ creator: '@alice', uploadDate: '20260618', postId: '123' }),
    /YYYY-MM-DD upload date/
  );
});

test('profile directories omit the handle marker and stay inside downloads', () => {
  assert.equal(createProfileArchiveDirectory('@alice'), 'alice');
  assert.equal(createProfileArchiveDirectory('alice.name_2'), 'alice.name_2');
  assert.throws(() => createProfileArchiveDirectory('@..'), /Invalid profile/);
});
