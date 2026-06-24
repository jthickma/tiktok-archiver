import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { downloadQueue } from './queue.js';
import { createMonitoredProfiles } from './channels.js';
import { detectUrlType } from './identity.js';
import { getSystemStatus } from './status.js';
import {
  ApiError,
  parseDownloaderChoice,
  requireBodyString,
} from './validation.js';
import { logger } from './logger.js';
import { asyncRoute } from './middleware/async-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { createChannelRoutes } from './routes/channel-routes.js';
import { createPostRoutes } from './routes/post-routes.js';
import { createQueueRoutes } from './routes/queue-routes.js';
import { createSystemRoutes } from './routes/system-routes.js';
import { createArchiveRoutes } from './routes/archive-routes.js';
import { initDb } from './database.js';
import { archiveCatalog } from './archive-runtime.js';

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

const monitoredProfiles = createMonitoredProfiles({
  channelsFile: CHANNELS_FILE,
  queue: downloadQueue,
});
// Mount route modules
app.use(
  '/api/channels',
  createChannelRoutes(express.Router(), monitoredProfiles, downloadQueue),
);
app.use(
  '/api/posts',
  createPostRoutes(express.Router(), archiveCatalog),
);
app.use(
  '/api/queue',
  createQueueRoutes(express.Router(), downloadQueue),
);
app.use(
  '/api',
  createSystemRoutes(express.Router(), {
    getSystemStatus,
    queue: downloadQueue,
    monitorState: monitoredProfiles.monitorState,
    startedAt,
    dataDir: DATA_DIR,
    downloadsDir: DOWNLOADS_DIR,
    cookiesFile: COOKIES_FILE,
    fs,
  }),
);
app.use(
  '/api/archive',
  createArchiveRoutes(express.Router(), archiveCatalog),
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
    const job = await downloadQueue.enqueue(target.url, target.type);
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
  await monitoredProfiles.syncFromFile();
  await downloadQueue.recoverInterrupted();

  app.listen(PORT, '0.0.0.0', () => {
    logger.info('server started', {
      port: PORT,
      downloads_dir: DOWNLOADS_DIR,
      data_dir: DATA_DIR,
    });
  });

  monitoredProfiles
    .runMonitor()
    .catch((error) => logger.error('initial monitor failed', { error }));
  downloadQueue.process();
  monitoredProfiles.startMonitor();
};

startApp().catch((error) => {
  logger.error('fatal startup error', { error });
  process.exit(1);
});
