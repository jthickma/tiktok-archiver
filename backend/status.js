import fs from 'fs';
import { spawn } from 'child_process';

const TOOL_VERSION_ARGS = {
  ffmpeg: ['-version'],
};

export const commandAvailable = (command, spawnCommand = spawn) =>
  new Promise((resolve) => {
    const proc = spawnCommand(
      command,
      TOOL_VERSION_ARGS[command] || ['--version'],
    );
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

export const getSystemStatus = async ({
  startedAt,
  dataDir,
  downloadsDir,
  queueState,
  queueSummary,
  monitorState,
}) => {
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
      ...queueSummary,
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
