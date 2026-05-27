import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb, dbAll, dbGet } from './database.js';
import {
  cancelJob,
  clearCompletedJobs,
  deleteJob,
  enqueue,
  getQueueState,
  pauseQueue,
  processQueue,
  recoverInterruptedJobs,
  resumeQueue,
  retryJob
} from './queue.js';
import { createChannelRegistry } from './channels.js';
import { detectUrlType } from './identity.js';
import { createMonitor } from './monitor.js';
import { getPost, getPostSlideshowImages, searchPosts } from './posts.js';
import { sendPostMedia } from './archives.js';
import { getSystemStatus } from './status.js';
import { ApiError, parseId, parsePostsQuery, requireBodyString, sendError } from './validation.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(__dirname, '../downloads');
const FRONTEND_DIST_DIR = path.join(__dirname, '../frontend/dist');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.txt');
const COOKIES_FILE = path.join(DATA_DIR, 'cookies.txt');
const startedAt = new Date().toISOString();

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use('/media', express.static(DOWNLOADS_DIR));

const channelRegistry = createChannelRegistry({ channelsFile: CHANNELS_FILE });
const monitor = createMonitor({ channelRegistry, enqueue });

const asyncRoute = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    logger.error('api route failed', { path: req.path, method: req.method, error });
    if (!res.headersSent) sendError(res, error);
  }
};

app.get('/api/status', asyncRoute(async (req, res) => {
  res.json(await getSystemStatus({
    startedAt,
    dataDir: DATA_DIR,
    downloadsDir: DOWNLOADS_DIR,
    queueState: getQueueState(),
    monitorState: monitor.state()
  }));
}));

app.get('/api/channels', asyncRoute(async (req, res) => {
  res.json(await channelRegistry.listChannels());
}));

app.post('/api/channels', asyncRoute(async (req, res) => {
  const url = requireBodyString(req.body, 'url');
  const channel = await channelRegistry.monitorProfile(url);
  await enqueue(channel.url, 'channel');
  res.json({ message: 'Channel added and monitoring queued', channelId: channel.id });
}));

app.delete('/api/channels/:id', asyncRoute(async (req, res) => {
  await channelRegistry.stopMonitoring(req.params.id);
  res.json({ message: `Stopped monitoring channel: ${req.params.id}` });
}));

app.get('/api/posts', asyncRoute(async (req, res) => {
  res.json(await searchPosts(parsePostsQuery(req.query)));
}));

app.get('/api/posts/:id/download', asyncRoute(async (req, res) => {
  await sendPostMedia({ res, downloadsDir: DOWNLOADS_DIR, post: await getPost(req.params.id) });
}));

app.get('/api/posts/:id', asyncRoute(async (req, res) => {
  const post = await getPost(req.params.id);
  if (!post) throw new ApiError(404, 'NOT_FOUND', 'Post not found');
  res.json({
    post,
    images: await getPostSlideshowImages(post, DOWNLOADS_DIR, fs, path)
  });
}));

app.post('/api/download-url', asyncRoute(async (req, res) => {
  const input = requireBodyString(req.body, 'url');
  const target = detectUrlType(input);
  await enqueue(target.url, target.type);
  res.json({ message: 'URL added to download queue', type: target.type });
}));

app.get('/api/queue', asyncRoute(async (req, res) => {
  const status = String(req.query.status || '');
  const type = String(req.query.type || '');
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  const suffix = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const active = await dbAll(
    `SELECT id, url, type, status, progress, error_message, created_at, started_at, completed_at,
            attempt_count, max_attempts, next_attempt_at, last_error_class
     FROM download_jobs
     WHERE status IN ('pending', 'downloading')
     ORDER BY status DESC, id ASC`
  );
  const history = await dbAll(
    `SELECT id, url, type, status, progress, error_message, created_at, started_at, completed_at,
            attempt_count, max_attempts, next_attempt_at, last_error_class
     FROM download_jobs ${suffix}
     ${suffix ? 'AND' : 'WHERE'} status IN ('completed', 'failed', 'cancelled')
     ORDER BY completed_at DESC, id DESC LIMIT 100`,
    params
  );
  res.json({ active, history, state: getQueueState() });
}));

app.get('/api/queue/:id/logs', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  const job = await dbGet('SELECT log_output, error_message, status FROM download_jobs WHERE id = ?', [id]);
  if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
  const rows = await dbAll(
    'SELECT created_at, level, message FROM download_job_logs WHERE job_id = ? ORDER BY id DESC LIMIT 250',
    [id]
  );
  res.json({
    logs: rows.reverse().map((row) => `[${row.created_at}] ${row.message}`).join('\n') || job.log_output || '',
    error: job.error_message,
    status: job.status
  });
}));

app.post('/api/queue/:id/cancel', asyncRoute(async (req, res) => {
  await cancelJob(parseId(req.params.id));
  res.json({ message: 'Job cancelled' });
}));

app.post('/api/queue/:id/retry', asyncRoute(async (req, res) => {
  await retryJob(parseId(req.params.id));
  res.json({ message: 'Job requeued' });
}));

app.delete('/api/queue/history/completed', asyncRoute(async (req, res) => {
  const result = await clearCompletedJobs();
  res.json({ message: 'Completed queue entries cleared', count: result.changes });
}));

app.delete('/api/queue/:id', asyncRoute(async (req, res) => {
  await deleteJob(parseId(req.params.id));
  res.json({ message: 'Job deleted' });
}));

app.post('/api/queue/pause', asyncRoute(async (req, res) => {
  pauseQueue();
  res.json({ message: 'Queue paused' });
}));

app.post('/api/queue/resume', asyncRoute(async (req, res) => {
  resumeQueue();
  res.json({ message: 'Queue resumed' });
}));

app.get('/api/cookies', (req, res) => {
  try {
    res.json({ cookies: fs.existsSync(COOKIES_FILE) ? fs.readFileSync(COOKIES_FILE, 'utf8') : '' });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/cookies', (req, res) => {
  try {
    if (req.body.cookies === undefined) throw new ApiError(400, 'INVALID_BODY', 'Cookies content is required');
    fs.writeFileSync(COOKIES_FILE, req.body.cookies, 'utf8');
    res.json({ message: 'Cookies saved successfully' });
  } catch (error) {
    sendError(res, error);
  }
});

if (fs.existsSync(FRONTEND_DIST_DIR)) {
  logger.info('serving frontend production assets', { path: FRONTEND_DIST_DIR });
  app.use(express.static(FRONTEND_DIST_DIR));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'));
  });
} else {
  logger.info('frontend dist missing; api-only mode');
}

const startApp = async () => {
  await initDb();
  await channelRegistry.syncFromFile();
  await recoverInterruptedJobs();

  app.listen(PORT, '0.0.0.0', () => {
    logger.info('server started', {
      port: PORT,
      downloads_dir: DOWNLOADS_DIR,
      data_dir: DATA_DIR
    });
  });

  monitor.runOnce().catch((error) => logger.error('initial monitor failed', { error }));
  processQueue();
  monitor.start();
};

startApp().catch((error) => {
  logger.error('fatal startup error', { error });
  process.exit(1);
});
