import assert from 'node:assert/strict';
import test from 'node:test';
import { scanProfileWithFallback } from './downloader.js';

test('profile scan uses tiktokuser input when an archived user ID is available', async () => {
  const inputs = [];
  let fallbackCalled = false;
  const entries = [{ id: '123' }];

  const result = await scanProfileWithFallback({
    profileUrl: 'https://www.tiktok.com/@alice',
    fallbackUserId: 'MS4wLjABAAAA-profile-id',
    onFallback: () => {
      fallbackCalled = true;
    },
    scan: async (input) => {
      inputs.push(input);
      return entries;
    },
  });

  assert.deepEqual(inputs, ['tiktokuser:MS4wLjABAAAA-profile-id']);
  assert.equal(fallbackCalled, true);
  assert.equal(result, entries);
});

test('profile scan uses the profile URL when no archived user ID is available', async () => {
  const inputs = [];
  await scanProfileWithFallback({
    profileUrl: 'https://www.tiktok.com/@alice',
    scan: async (input) => {
      inputs.push(input);
      return [];
    },
  });

  assert.deepEqual(inputs, ['https://www.tiktok.com/@alice']);
});
