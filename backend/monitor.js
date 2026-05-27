import { dbAll, dbRun } from './database.js';
import { logger } from './logger.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export const createMonitor = ({ channelRegistry, enqueue, intervalMs = SIX_HOURS_MS }) => {
  let lastRunAt = null;
  let nextRunAt = null;
  let timer = null;

  const runOnce = async () => {
    lastRunAt = new Date().toISOString();
    nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    logger.info('monitor scan started');

    await channelRegistry.syncFromFile();
    const monitored = await dbAll('SELECT * FROM channels WHERE is_monitored = 1 ORDER BY id ASC');

    for (const channel of monitored) {
      await enqueue(channel.url, 'channel');
      await dbRun(
        'UPDATE channels SET last_checked_at = ? WHERE id = ?',
        [new Date().toISOString(), channel.id]
      );
    }

    logger.info('monitor scan finished', { channel_count: monitored.length });
  };

  const start = () => {
    nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    timer = setInterval(runOnce, intervalMs);
  };

  const state = () => ({
    lastRunAt,
    nextRunAt,
    intervalMs,
    running: Boolean(timer)
  });

  return {
    runOnce,
    start,
    state
  };
};
