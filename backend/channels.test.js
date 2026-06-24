import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMonitoredProfiles } from './channels.js';
import {
  createCatalogSchema,
  createTestDatabase,
} from './tests/helpers/database.js';

test('monitored profiles reconcile file state and schedule scans through one interface', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const channelsFile = path.join(directory, 'channels.txt');
  fs.writeFileSync(channelsFile, '@alice\n', 'utf8');
  const database = createTestDatabase();
  await createCatalogSchema(database);
  t.after(() => database.close());
  const queued = [];
  const profiles = createMonitoredProfiles({
    channelsFile,
    database,
    queue: {
      enqueue: async (url, type) => {
        queued.push({ url, type });
        return { created: true };
      },
    },
  });

  await profiles.syncFromFile();
  await profiles.runMonitor();
  const alice = await database.get(
    "SELECT * FROM channels WHERE id = '@alice'",
  );
  assert.equal(alice.is_monitored, 1);
  assert.ok(alice.last_checked_at);
  assert.deepEqual(queued, [
    { url: 'https://www.tiktok.com/@alice', type: 'channel' },
  ]);

  await profiles.monitorProfile('@bob');
  assert.match(fs.readFileSync(channelsFile, 'utf8'), /@bob/);
  await profiles.stopMonitoring('@alice');
  assert.doesNotMatch(fs.readFileSync(channelsFile, 'utf8'), /@alice/);
});
