import fs from 'fs';
import path from 'path';
import { dbAll, dbGet, dbRun } from './database.js';
import { normalizeProfileUrl, extractUsername } from './identity.js';
import { logger } from './logger.js';

export const createChannelRegistry = ({ channelsFile }) => {
  const ensureFile = () => {
    const dir = path.dirname(channelsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(channelsFile)) fs.writeFileSync(channelsFile, '', 'utf8');
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
        const id = extractUsername(url);
        fileChannelIds.push(id);

        const existing = await dbGet('SELECT * FROM channels WHERE id = ?', [id]);
        if (existing) {
          await dbRun('UPDATE channels SET is_monitored = 1, url = ? WHERE id = ?', [url, id]);
        } else {
          await dbRun(
            'INSERT INTO channels (id, username, url, created_at, is_monitored) VALUES (?, ?, ?, ?, 1)',
            [id, id.replace(/^@/, ''), url, new Date().toISOString()]
          );
          logger.info('channel synced from file', { channel_id: id });
        }
      } catch (error) {
        logger.warn('ignored invalid channels file entry', { entry: line, error });
      }
    }

    const dbMonitored = await dbAll('SELECT id FROM channels WHERE is_monitored = 1');
    for (const channel of dbMonitored) {
      if (!fileChannelIds.includes(channel.id)) {
        await dbRun('UPDATE channels SET is_monitored = 0 WHERE id = ?', [channel.id]);
        logger.info('channel unmonitored from file sync', { channel_id: channel.id });
      }
    }
  };

  const syncToFile = async () => {
    ensureFile();
    const monitored = await dbAll('SELECT url FROM channels WHERE is_monitored = 1 ORDER BY username ASC');
    fs.writeFileSync(channelsFile, `${monitored.map((channel) => channel.url).join('\n')}\n`, 'utf8');
  };

  const listChannels = async () => dbAll(`
    SELECT c.*, COUNT(p.id) as downloaded_count
    FROM channels c
    LEFT JOIN posts p ON c.id = p.channel_id
    GROUP BY c.id
    ORDER BY c.is_monitored DESC, c.id ASC
  `);

  const monitorProfile = async (input) => {
    const url = normalizeProfileUrl(input);
    const id = extractUsername(url);
    const existing = await dbGet('SELECT * FROM channels WHERE id = ?', [id]);
    if (existing) {
      await dbRun('UPDATE channels SET is_monitored = 1, url = ? WHERE id = ?', [url, id]);
    } else {
      await dbRun(
        'INSERT INTO channels (id, username, url, created_at, is_monitored) VALUES (?, ?, ?, ?, 1)',
        [id, id.replace(/^@/, ''), url, new Date().toISOString()]
      );
    }
    await syncToFile();
    return { id, url };
  };

  const stopMonitoring = async (id) => {
    await dbRun('UPDATE channels SET is_monitored = 0 WHERE id = ?', [id]);
    await syncToFile();
  };

  return {
    syncFromFile,
    syncToFile,
    listChannels,
    monitorProfile,
    stopMonitoring
  };
};
