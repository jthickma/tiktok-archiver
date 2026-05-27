import fs from 'fs';
import { spawn } from 'child_process';
import { dbAll } from './database.js';

const commandAvailable = (command) => new Promise((resolve) => {
  const proc = spawn(command, ['--version']);
  proc.on('error', () => resolve(false));
  proc.on('close', (code) => resolve(code === 0));
});

const checkWritable = (dir) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const diskFree = async (dir) => {
  if (typeof fs.statfsSync !== 'function') return null;
  try {
    const stats = fs.statfsSync(dir);
    return {
      bytesFree: stats.bavail * stats.bsize,
      bytesTotal: stats.blocks * stats.bsize
    };
  } catch {
    return null;
  }
};

export const getSystemStatus = async ({ startedAt, dataDir, downloadsDir, queueState, monitorState }) => {
  const rows = await dbAll('SELECT status, COUNT(*) as count FROM download_jobs GROUP BY status');
  const queueCounts = rows.reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const [ytDlp, galleryDl, ffmpeg, disk] = await Promise.all([
    commandAvailable('yt-dlp'),
    commandAvailable('gallery-dl'),
    commandAvailable('ffmpeg'),
    diskFree(downloadsDir)
  ]);

  return {
    server: {
      startedAt,
      uptimeSeconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    },
    queue: {
      ...queueState,
      counts: queueCounts
    },
    monitor: monitorState,
    tools: {
      ytDlp,
      galleryDl,
      ffmpeg
    },
    storage: {
      dataDirWritable: checkWritable(dataDir),
      downloadsDirWritable: checkWritable(downloadsDir),
      disk
    }
  };
};
