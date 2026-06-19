import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoArchiveBase } from './archive-naming.js';

test('video archive names include creator, upload date, and post ID', () => {
  assert.equal(
    createVideoArchiveBase({
      creator: '@alice',
      uploadDate: '2026-06-18',
      postId: '7512345678901234567'
    }),
    '@alice_2026-06-18_7512345678901234567'
  );
});

test('video archive names reject missing or malformed identity fields', () => {
  assert.throws(
    () => createVideoArchiveBase({ creator: '@alice', uploadDate: '20260618', postId: '123' }),
    /YYYY-MM-DD upload date/
  );
});
