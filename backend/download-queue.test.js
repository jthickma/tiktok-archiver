import assert from 'node:assert/strict';
import test from 'node:test';
import { createDownloadQueue } from './download-queue.js';
import {
  createCatalogSchema,
  createQueueSchema,
  createTestDatabase,
} from './tests/helpers/database.js';

const waitFor = async (predicate, timeoutMs = 1000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for queue state');
};

test('download queue owns a complete successful post lifecycle', async () => {
  const database = createTestDatabase();
  await createCatalogSchema(database);
  await createQueueSchema(database);
  const calls = [];
  const queue = createDownloadQueue({
    database,
    acquisition: {
      scanProfile: async () => [],
      downloadGallery: async () => {},
      downloadPost: async (url, onProgress) => {
        calls.push(url);
        await onProgress(65, 'Acquiring media');
      },
    },
  });

  const created = await queue.enqueue('https://example.com/media/1', 'post');
  const completed = await waitFor(async () => {
    const job = await database.get(
      'SELECT * FROM download_jobs WHERE id = ?',
      [created.id],
    );
    return job?.status === 'completed' ? job : null;
  });

  assert.deepEqual(calls, ['https://example.com/media/1']);
  assert.equal(completed.progress, 100);
  assert.equal((await queue.summary()).counts.completed, 1);
  assert.equal(queue.state().isProcessing, false);
  await database.close();
});

test('download queue converts a profile scan into post jobs', async () => {
  const database = createTestDatabase();
  await createCatalogSchema(database);
  await createQueueSchema(database);
  const queue = createDownloadQueue({
    database,
    acquisition: {
      scanProfile: async () => [
        { id: '11', url: 'https://www.tiktok.com/@alice/video/11' },
        { id: '12', url: 'https://www.tiktok.com/@alice/video/12' },
      ],
      downloadGallery: async () => {},
      downloadPost: async () => {},
    },
  });

  const created = await queue.enqueue(
    'https://www.tiktok.com/@alice',
    'channel',
  );
  await waitFor(async () => {
    const job = await database.get(
      'SELECT status FROM download_jobs WHERE id = ?',
      [created.id],
    );
    return job?.status === 'completed';
  });
  const childJobs = await database.all(
    "SELECT url FROM download_jobs WHERE type = 'post' ORDER BY url",
  );
  assert.deepEqual(childJobs.map((job) => job.url), [
    'https://www.tiktok.com/@alice/video/11',
    'https://www.tiktok.com/@alice/video/12',
  ]);
  await database.close();
});
