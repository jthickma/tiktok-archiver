import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb, dbAll, dbRun, dbGet } from './database.js';
import { enqueue, processQueue } from './queue.js';
import { extractUsername } from './downloader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(__dirname, '../downloads');
const FRONTEND_DIST_DIR = path.join(__dirname, '../frontend/dist');

const CHANNELS_FILE = path.join(DATA_DIR, 'channels.txt');
const COOKIES_FILE = path.join(DATA_DIR, 'cookies.txt');

const app = express();
app.set('trust proxy', 1); // trust first proxy for secure headers/cookies behind GoDoxy
app.use(cors());
app.use(express.json());

// Ensure crucial folders exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Serve downloaded media files statically at /media
app.use('/media', express.static(DOWNLOADS_DIR));

// -------------------------------------------------------------
// CHANNELS.TXT SYNCHRONIZATION HELPERS
// -------------------------------------------------------------

// Sync channels.txt -> Database (Read from file on startup/scan)
const syncChannelsTxtToDb = async () => {
  console.log('[Sync] Synchronizing channels.txt to Database...');
  
  if (!fs.existsSync(CHANNELS_FILE)) {
    fs.writeFileSync(CHANNELS_FILE, '', 'utf8');
    console.log('[Sync] Created empty channels.txt');
    return;
  }

  const content = fs.readFileSync(CHANNELS_FILE, 'utf8');
  const lines = content.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'));

  const fileChannels = [];

  for (const line of lines) {
    let url = line;
    // Prepend domain if only @username is provided
    if (url.startsWith('@')) {
      url = `https://www.tiktok.com/${url}`;
    } else if (!url.startsWith('http')) {
      url = `https://www.tiktok.com/@${url}`;
    }

    try {
      const username = extractUsername(url);
      fileChannels.push({ id: username, url });

      // Check if channel already exists
      const existing = await dbGet('SELECT * FROM channels WHERE id = ?', [username]);
      if (existing) {
        // If it exists but is not monitored, mark it as monitored
        if (existing.is_monitored !== 1) {
          await dbRun('UPDATE channels SET is_monitored = 1 WHERE id = ?', [username]);
        }
      } else {
        // Insert new monitored channel
        await dbRun(
          'INSERT INTO channels (id, username, url, created_at, is_monitored) VALUES (?, ?, ?, ?, 1)',
          [username, username.replace(/^@/, ''), url, new Date().toISOString()]
        );
        console.log(`[Sync] Added new channel from channels.txt: ${username}`);
      }
    } catch (err) {
      console.error(`[Sync] Error parsing line "${line}":`, err.message);
    }
  }

  // Find channels in DB that are marked monitored but are NOT in channels.txt anymore
  const dbMonitored = await dbAll('SELECT id FROM channels WHERE is_monitored = 1');
  const fileChannelIds = fileChannels.map(c => c.id);

  for (const dbChan of dbMonitored) {
    if (!fileChannelIds.includes(dbChan.id)) {
      await dbRun('UPDATE channels SET is_monitored = 0 WHERE id = ?', [dbChan.id]);
      console.log(`[Sync] Stopped monitoring channel (removed from channels.txt): ${dbChan.id}`);
    }
  }
};

// Sync Database -> channels.txt (Rewrite file when changed via Web UI)
const syncDbToChannelsTxt = async () => {
  console.log('[Sync] Updating channels.txt from Database...');
  const monitored = await dbAll('SELECT url FROM channels WHERE is_monitored = 1');
  const content = monitored.map(c => c.url).join('\n') + '\n';
  fs.writeFileSync(CHANNELS_FILE, content, 'utf8');
};

// -------------------------------------------------------------
// BACKGROUND MONITOR SERVICE
// -------------------------------------------------------------
const runBackgroundMonitor = async () => {
  console.log('[Monitor] Running background channel scanner...');
  try {
    // 1. Sync channels.txt first in case of manual external edits
    await syncChannelsTxtToDb();

    // 2. Fetch all monitored profiles
    const monitored = await dbAll('SELECT * FROM channels WHERE is_monitored = 1');
    console.log(`[Monitor] Scanning ${monitored.length} profiles...`);

    for (const channel of monitored) {
      console.log(`[Monitor] Queueing scan for: ${channel.id}`);
      await enqueue(channel.url, 'channel');
      
      // Update check time
      await dbRun(
        'UPDATE channels SET last_checked_at = ? WHERE id = ?',
        [new Date().toISOString(), channel.id]
      );
    }
  } catch (err) {
    console.error('[Monitor] Error in background scanner:', err);
  }
};

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// Channels API
app.get('/api/channels', async (req, res) => {
  try {
    const channels = await dbAll(`
      SELECT c.*, COUNT(p.id) as downloaded_count 
      FROM channels c 
      LEFT JOIN posts p ON c.id = p.channel_id 
      GROUP BY c.id
      ORDER BY c.is_monitored DESC, c.id ASC
    `);
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/channels', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    let normalizedUrl = url.trim();
    if (normalizedUrl.startsWith('@')) {
      normalizedUrl = `https://www.tiktok.com/${normalizedUrl}`;
    } else if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = `https://www.tiktok.com/@${normalizedUrl}`;
    }

    const username = extractUsername(normalizedUrl);

    // Upsert channel
    const existing = await dbGet('SELECT * FROM channels WHERE id = ?', [username]);
    if (existing) {
      await dbRun('UPDATE channels SET is_monitored = 1, url = ? WHERE id = ?', [normalizedUrl, username]);
    } else {
      await dbRun(
        'INSERT INTO channels (id, username, url, created_at, is_monitored) VALUES (?, ?, ?, ?, 1)',
        [username, username.replace(/^@/, ''), normalizedUrl, new Date().toISOString()]
      );
    }

    // Sync to channels.txt file
    await syncDbToChannelsTxt();

    // Trigger immediate download/scan job
    await enqueue(normalizedUrl, 'channel');

    res.json({ message: 'Channel added and monitoring queued', channelId: username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/channels/:id', async (req, res) => {
  const { id } = req.params; // e.g. @username
  try {
    await dbRun('UPDATE channels SET is_monitored = 0 WHERE id = ?', [id]);
    await syncDbToChannelsTxt();
    res.json({ message: `Stopped monitoring channel: ${id}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Posts API
app.get('/api/posts', async (req, res) => {
  const { channel_id, type, search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  
  let query = 'SELECT * FROM posts WHERE 1=1';
  const params = [];

  if (channel_id) {
    query += ' AND channel_id = ?';
    params.push(channel_id);
  }
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (search) {
    query += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY upload_date DESC, downloaded_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  try {
    const posts = await dbAll(query, params);
    
    // Also get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM posts WHERE 1=1';
    const countParams = [];
    
    if (channel_id) {
      countQuery += ' AND channel_id = ?';
      countParams.push(channel_id);
    }
    if (type) {
      countQuery += ' AND type = ?';
      countParams.push(type);
    }
    if (search) {
      countQuery += ' AND (title LIKE ? OR description LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    
    const countResult = await dbGet(countQuery, countParams);
    
    res.json({
      posts,
      total: countResult ? countResult.total : 0,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post Detail & Slide Files Scraper API
app.get('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const post = await dbGet('SELECT * FROM posts WHERE id = ?', [id]);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    let images = [];
    if (post.type === 'slideshow') {
      const slideshowDir = path.join(DOWNLOADS_DIR, post.file_path);
      if (fs.existsSync(slideshowDir)) {
        images = fs.readdirSync(slideshowDir)
          .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
          .sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || 0);
            const numB = parseInt(b.match(/\d+/)?.[0] || 0);
            return numA - numB;
          });
      }
    }

    res.json({
      post,
      images
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// On-Demand URL Download API
app.post('/api/download-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    let type = 'post';
    // Deduce if URL is a profile or a post
    // TikTok profile URLs have /@username but do not contain /video/ or /photo/
    const isProfile = /tiktok\.com\/@[a-zA-Z0-9_.-]+\/?$/.test(url.split('?')[0]) || 
                      (!url.includes('/video/') && !url.includes('/photo/') && url.startsWith('@'));
    
    if (isProfile) {
      type = 'channel';
    }

    let targetUrl = url.trim();
    if (targetUrl.startsWith('@')) {
      targetUrl = `https://www.tiktok.com/${targetUrl}`;
    }

    await enqueue(targetUrl, type);
    res.json({ message: 'URL added to download queue', type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download Queue API
app.get('/api/queue', async (req, res) => {
  try {
    // Show active (downloading/pending) jobs, and recently completed/failed jobs (last 20)
    const activeJobs = await dbAll(
      `SELECT id, url, type, status, progress, error_message, created_at, started_at, completed_at 
       FROM download_jobs 
       WHERE status IN ('pending', 'downloading')
       ORDER BY status DESC, id ASC`
    );
    
    const historicalJobs = await dbAll(
      `SELECT id, url, type, status, progress, error_message, created_at, started_at, completed_at 
       FROM download_jobs 
       WHERE status IN ('completed', 'failed')
       ORDER BY completed_at DESC LIMIT 20`
    );

    res.json({
      active: activeJobs,
      history: historicalJobs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Job Logs API
app.get('/api/queue/:id/logs', async (req, res) => {
  const { id } = req.params;
  try {
    const job = await dbGet('SELECT log_output, error_message, status FROM download_jobs WHERE id = ?', [id]);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({
      logs: job.log_output,
      error: job.error_message,
      status: job.status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cookies API
app.get('/api/cookies', (req, res) => {
  try {
    let cookies = '';
    if (fs.existsSync(COOKIES_FILE)) {
      cookies = fs.readFileSync(COOKIES_FILE, 'utf8');
    }
    res.json({ cookies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cookies', (req, res) => {
  const { cookies } = req.body;
  if (cookies === undefined) return res.status(400).json({ error: 'Cookies content is required' });

  try {
    fs.writeFileSync(COOKIES_FILE, cookies, 'utf8');
    res.json({ message: 'Cookies saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// FRONTEND STATIC BUNDLE SERVING (Production)
// -------------------------------------------------------------
if (fs.existsSync(FRONTEND_DIST_DIR)) {
  console.log(`[Server] Serving frontend production assets from: ${FRONTEND_DIST_DIR}`);
  app.use(express.static(FRONTEND_DIST_DIR));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'));
  });
} else {
  console.log('[Server] Frontend dist directory not found. Server running in API-only mode.');
}

// -------------------------------------------------------------
// APP STARTUP & INITS
// -------------------------------------------------------------
const startApp = async () => {
  // 1. Init Database tables
  await initDb();

  // 2. Perform initial channels.txt -> DB sync
  await syncChannelsTxtToDb();

  // 3. Start Express Web server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 TikTok Archiver server running on: http://0.0.0.0:${PORT}`);
    console.log(`📂 Downloads location: ${DOWNLOADS_DIR}`);
    console.log(`📂 Persistent data: ${DATA_DIR}`);
    console.log(`======================================================\n`);
  });

  // 4. Run immediate background check on startup
  runBackgroundMonitor();

  // 5. Run active queue process trigger (restarts if pending jobs exist)
  processQueue();

  // 6. Schedule Background Monitor to run every 6 hours
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  setInterval(runBackgroundMonitor, SIX_HOURS_MS);
};

startApp().catch(err => {
  console.error('Fatal error during application startup:', err);
  process.exit(1);
});
