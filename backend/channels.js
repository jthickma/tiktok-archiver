import fs from 'fs';
import path from 'path';
import { database as defaultDatabase } from './database.js';
import { normalizeProfileUrl, requireTikTokUsername } from './identity.js';
import { logger } from './logger.js';
import {
  getChannelById,
  getMonitoredChannels,
  upsertChannel,
  setMonitored,
  updateLastChecked,
  updateChannelUrl,
  getMonitoredUrls,
  listChannels as repoListChannels,
} from './repositories/channel-repository.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Deep monitored-profiles module.
 *
 * Owns reconciliation between channels.txt and SQLite, profile mutations,
 * scheduled scan requests, and monitor timing. The text file and SQLite remain
 * two intentional adapters to the same operational state.
 */
export const createMonitoredProfiles = ({
  channelsFile,
  database = defaultDatabase,
  queue,
  intervalMs = SIX_HOURS_MS,
}) => {
  const { all, get, run } = database;
  let lastRunAt = null;
  let nextRunAt = null;
  let timer = null;

  const ensureFile = () => {
    const dir = path.dirname(channelsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(channelsFile))
      fs.writeFileSync(channelsFile, '', 'utf8');
  };

  const syncFromFile = async () => {
    ensureFile();
    const content = fs.readFileSync(channelsFile, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    const fileChannelIds = [];

    for (const line of lines) {
      try {
        const url = normalizeProfileUrl(line);
        const id = requireTikTokUsername(url);
        fileChannelIds.push(id);

        const existing = await getChannelById(get, id);
        if (existing) {
          await updateChannelUrl(run, id, url);
        } else {
          await upsertChannel(run, {
            id,
            username: id.replace(/^@/, ''),
            url,
            created_at: new Date().toISOString(),
            is_monitored: 1,
          });
          logger.info('channel synced from file', { channel_id: id });
        }
      } catch (error) {
        logger.warn('ignored invalid channels file entry', {
          entry: line,
          error,
        });
      }
    }

    const dbMonitored = await all(
      'SELECT id FROM channels WHERE is_monitored = 1',
    );
    for (const channel of dbMonitored) {
      if (!fileChannelIds.includes(channel.id)) {
        await setMonitored(run, channel.id, 0);
        logger.info('channel unmonitored from file sync', {
          channel_id: channel.id,
        });
      }
    }
  };

  const syncToFile = async () => {
    ensureFile();
    const monitored = await getMonitoredUrls(all);
    const nextContent = `${monitored.map((channel) => channel.url).join('\n')}\n`;
    const temporaryFile = `${channelsFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, nextContent, 'utf8');
    fs.renameSync(temporaryFile, channelsFile);
  };

  const listChannels = async () => repoListChannels(all);

  const monitorProfile = async (input) => {
    const url = normalizeProfileUrl(input);
    const id = requireTikTokUsername(url);
    const existing = await getChannelById(get, id);
    if (existing) {
      await updateChannelUrl(run, id, url);
    } else {
      await upsertChannel(run, {
        id,
        username: id.replace(/^@/, ''),
        url,
        created_at: new Date().toISOString(),
        is_monitored: 1,
      });
    }
    await syncToFile();
    return { id, url };
  };

  const stopMonitoring = async (id) => {
    await setMonitored(run, id, 0);
    await syncToFile();
  };

  const runMonitor = async () => {
    if (!queue) throw new Error('Monitored profiles require a queue');
    lastRunAt = new Date().toISOString();
    nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    logger.info('monitor scan started');
    await syncFromFile();
    const monitored = await getMonitoredChannels(all);
    for (const channel of monitored) {
      await queue.enqueue(channel.url, 'channel');
      await updateLastChecked(run, channel.id);
    }
    logger.info('monitor scan finished', { channel_count: monitored.length });
  };

  const startMonitor = () => {
    if (timer) return;
    nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    timer = setInterval(() => {
      runMonitor().catch((error) =>
        logger.error('scheduled monitor failed', { error }),
      );
    }, intervalMs);
    timer.unref?.();
  };

  const stopMonitor = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    nextRunAt = null;
  };

  const monitorState = () => ({
    lastRunAt,
    nextRunAt,
    intervalMs,
    running: Boolean(timer),
  });

  return Object.freeze({
    syncFromFile,
    syncToFile,
    listChannels,
    monitorProfile,
    stopMonitoring,
    runMonitor,
    startMonitor,
    stopMonitor,
    monitorState,
  });
};

/**
 * Compatibility constructor for older callers that only need registry work.
 */
export const createChannelRegistry = ({ channelsFile }) =>
  createMonitoredProfiles({ channelsFile });
