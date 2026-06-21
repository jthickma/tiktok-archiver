import assert from 'node:assert/strict';
import test from 'node:test';
import { extractUsername, normalizeHandle, normalizeProfileUrl, requireTikTokUsername } from './identity.js';

test('extractUsername ignores numeric profile IDs and uses the metadata username', () => {
  assert.equal(extractUsername(
    'https://www.tiktok.com/@6669028751340666885/video/123',
    {
      webpage_url: 'https://www.tiktok.com/@6669028751340666885/video/123',
      uploader: 'sophiexspinello',
      uploader_id: '6669028751340666885'
    }
  ), '@sophiexspinello');
});

test('extractUsername prefers a readable URL username over numeric metadata', () => {
  assert.equal(extractUsername(
    'https://www.tiktok.com/@sophiexspinello/video/123',
    { uploader: '6669028751340666885', uploader_id: '6669028751340666885' }
  ), '@sophiexspinello');
});

test('numeric IDs cannot be normalized as profile usernames', () => {
  assert.throws(() => normalizeHandle('6669028751340666885'), /numeric profile IDs/);
  assert.throws(
    () => normalizeProfileUrl('https://www.tiktok.com/@6669028751340666885'),
    /numeric profile IDs/
  );
});

test('profile URLs are canonicalized to their readable username', () => {
  assert.equal(
    normalizeProfileUrl('https://m.tiktok.com/@sophiexspinello?lang=en'),
    'https://www.tiktok.com/@sophiexspinello'
  );
});

test('downloads fail before path creation when no readable username is available', () => {
  assert.throws(
    () => requireTikTokUsername('https://www.tiktok.com/@6669028751340666885/video/123'),
    /refusing to create a numeric or unknown profile folder/
  );
});
