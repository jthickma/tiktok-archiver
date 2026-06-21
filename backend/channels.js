import fs from 'fs';
import path from 'path';
import { dbAll, dbGet, dbRun } from './database.js';
import { normalizeProfileUrl, requireTikTokUsername } from './identity.js';
import { logger } from './logger.js';
import {
  getChannelById,
  upsertChannel,
  setMonitored,
  updateChannelUrl,
  getMonitoredUrls,
  listChannels as repoListChannels,
} from './repositories/channel-repository.js';

export const createChannelRegistry = ({ channelsFile }) => {
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

        const existing = await getChannelById(dbGet, id);
        if (existing) {
          await updateChannelUrl(dbRun, id, url);
        } else {
          await upsertChannel(dbRun, {
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

    const dbMonitored = await dbAll(
      'SELECT id FROM channels WHERE is_monitored = 1',
    );
    for (const channel of dbMonitored) {
      if (!fileChannelIds.includes(channel.id)) {
        await setMonitored(dbRun, channel.id, 0);
        logger.info('channel unmonitored from file sync', {
          channel_id: channel.id,
        });
      }
    }
  };

  const syncToFile = async () => {
    ensureFile();
    const monitored = await getMonitoredUrls(dbAll);
    fs.writeFileSync(
      channelsFile,
      `${monitored.map((channel) => channel.url).join('\n')}\n`,
      'utf8',
    );
  };

  const listChannels = async () => repoListChannels(dbAll);

  const monitorProfile = async (input) => {
    const url = normalizeProfileUrl(input);
    const id = requireTikTokUsername(url);
    const existing = await getChannelById(dbGet, id);
    if (existing) {
      await updateChannelUrl(dbRun, id, url);
    } else {
      await upsertChannel(dbRun, {
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
    await setMonitored(dbRun, id, 0);
    await syncToFile();
  };

  return {
    syncFromFile,
    syncToFile,
    listChannels,
    monitorProfile,
    stopMonitoring,
  };
};
