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

const normalizeCounts = (rows) => {
  const counts = {
    pending: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  };

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return counts;
};

export const getSystemStatus = async ({ startedAt, dataDir, downloadsDir, queueState, monitorState }) => {
  const rows = await dbAll('SELECT status, COUNT(*) as count FROM download_jobs GROUP BY status');
  const queueCounts = normalizeCounts(rows);
  const activeCount = queueCounts.pending + queueCounts.downloading;

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
      counts: queueCounts,
      activeCount,
      totalCount: Object.values(queueCounts).reduce((total, count) => total + count, 0),
      problemCount: queueCounts.failed
    },
    monitor: monitorState,
    tools: {
      ytDlp,
      galleryDl,
      ffmpeg
    },
    storage: {
      dataDir,
      downloadsDir,
      dataDirWritable: checkWritable(dataDir),
      downloadsDirWritable: checkWritable(downloadsDir),
      disk
    },
    checkedAt: new Date().toISOString()
  };
};
