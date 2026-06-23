import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb } from './database.js';
import {
  cancelJob,
  clearCompletedJobs,
  deleteJob,
  enqueue,
  getQueueState,
  listQueueJobs,
  pauseQueue,
  processQueue,
  readJobLogs,
  readQueueSummary,
  recoverInterruptedJobs,
  resumeQueue,
  retryJob,
} from './queue.js';
import { createChannelRegistry } from './channels.js';
import { detectUrlType } from './identity.js';
import { createMonitor } from './monitor.js';
import { getPost, getPostMediaFiles, searchPosts } from './posts.js';
import { sendPostMedia, sendPostMediaFile } from './archives.js';
import { getSystemStatus } from './status.js';
import {
  ApiError,
  parseDownloaderChoice,
  parsePostsQuery,
  parseQueueQuery,
  parseId,
  requireBodyString,
  sendError,
} from './validation.js';
import { logger } from './logger.js';
import { ensurePostThumbnails } from './thumbnails.js';
import { asyncRoute } from './middleware/async-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { createChannelRoutes } from './routes/channel-routes.js';
import { createPostRoutes } from './routes/post-routes.js';
import { createQueueRoutes } from './routes/queue-routes.js';
import { createSystemRoutes } from './routes/system-routes.js';
import { createArchiveRoutes } from './routes/archive-routes.js';
import { dbAll, dbGet, dbRun } from './database.js';
import * as archiveService from './services/archive-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DOWNLOADS_DIR =
  process.env.DOWNLOADS_DIR || path.join(__dirname, '../downloads');
const FRONTEND_DIST_DIR = path.join(__dirname, '../frontend/dist');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.txt');
const COOKIES_FILE = path.join(DATA_DIR, 'cookies.txt');
const startedAt = new Date().toISOString();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(requestLogger);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use('/media', express.static(DOWNLOADS_DIR));

const channelRegistry = createChannelRegistry({ channelsFile: CHANNELS_FILE });
const monitor = createMonitor({ channelRegistry, enqueue });

// Mount route modules
app.use(
  '/api/channels',
  createChannelRoutes(express.Router(), channelRegistry, enqueue),
);
app.use(
  '/api/posts',
  createPostRoutes(express.Router(), {
    searchPosts,
    getPost,
    getPostMediaFiles,
    sendPostMedia,
    sendPostMediaFile,
    ensurePostThumbnails,
    downloadsDir: DOWNLOADS_DIR,
    fs,
    path,
  }),
);
app.use(
  '/api/queue',
  createQueueRoutes(express.Router(), {
    listQueueJobs,
    readJobLogs,
    cancelJob,
    retryJob,
    deleteJob,
    clearCompletedJobs,
    pauseQueue,
    resumeQueue,
  }),
);
app.use(
  '/api',
  createSystemRoutes(express.Router(), {
    getSystemStatus,
    getQueueState,
    monitorState: monitor.state,
    startedAt,
    dataDir: DATA_DIR,
    downloadsDir: DOWNLOADS_DIR,
    cookiesFile: COOKIES_FILE,
    fs,
  }),
);
app.use(
  '/api/archive',
  createArchiveRoutes(express.Router(), {
    dbAll,
    dbGet,
    dbRun,
    archiveService,
    downloadsDir: DOWNLOADS_DIR,
    getPost,
  }),
);

// Download URL endpoint
app.post(
  '/api/download-url',
  asyncRoute(async (req, res) => {
    const input = requireBodyString(req.body, 'url');
    const downloader = parseDownloaderChoice(req.body?.downloader);
    const target = (() => {
      try {
        return detectUrlType(input, { downloader });
      } catch (error) {
        throw new ApiError(
          400,
          'INVALID_URL',
          error.message || 'URL is invalid',
        );
      }
    })();
    const job = await enqueue(target.url, target.type);
    res.status(job.created ? 201 : 200).json({
      message: job.requeued
        ? 'URL requeued for download'
        : job.created
          ? 'URL added to download queue'
          : 'URL is already in the queue',
      type: target.type,
      downloader,
      job,
    });
  }),
);

// Static frontend serving
if (fs.existsSync(FRONTEND_DIST_DIR)) {
  logger.info('serving frontend production assets', {
    path: FRONTEND_DIST_DIR,
  });
  app.use(express.static(FRONTEND_DIST_DIR));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'));
  });
} else {
  logger.info('frontend dist missing; api-only mode');
}

// Global error handler
app.use(globalErrorHandler);

const startApp = async () => {
  await initDb();
  await channelRegistry.syncFromFile();
  await recoverInterruptedJobs();

  app.listen(PORT, '0.0.0.0', () => {
    logger.info('server started', {
      port: PORT,
      downloads_dir: DOWNLOADS_DIR,
      data_dir: DATA_DIR,
    });
  });

  monitor
    .runOnce()
    .catch((error) => logger.error('initial monitor failed', { error }));
  processQueue();
  monitor.start();
};

startApp().catch((error) => {
  logger.error('fatal startup error', { error });
  process.exit(1);
});
