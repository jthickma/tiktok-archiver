import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';

import { commandAvailable } from './status.js';

const successfulSpawn = (expectedArgs) => (command, args) => {
  assert.deepEqual(args, expectedArgs);
  const proc = new EventEmitter();
  queueMicrotask(() => proc.emit('close', 0));
  return proc;
};

test('commandAvailable uses ffmpeg-compatible version arguments', async () => {
  assert.equal(
    await commandAvailable('ffmpeg', successfulSpawn(['-version'])),
    true,
  );
});

test('commandAvailable uses conventional arguments for other tools', async () => {
  assert.equal(
    await commandAvailable('yt-dlp', successfulSpawn(['--version'])),
    true,
  );
});
