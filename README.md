# TikTok Archiver

TikTok Archiver is a self-hosted media archive for TikTok profiles, individual videos, and photo slideshows. It provides a React web interface, an Express API, a SQLite catalog, and a background queue that calls `yt-dlp` and `gallery-dl` to collect media into a local `downloads/` directory.

## What It Does

- Monitor TikTok profiles listed in the web UI or `data/channels.txt`.
- Scan monitored profiles every six hours and queue newly discovered posts.
- Download individual TikTok video or photo slideshow URLs on demand.
- Store archive metadata in SQLite at `data/tiktok.db`.
- Store media files on disk under `downloads/@handle/`.
- Browse, filter, preview, and download archived media from the web UI.
- Save TikTok cookies in Netscape `cookies.txt` format for authenticated downloads.

## Repository Layout

```text
.
|-- backend/
|   |-- index.js        # Express server and thin REST route adapters
|   |-- database.js     # SQLite connection, migrations, schema creation, database healing
|   |-- channels.js     # channels.txt and channel registry operations
|   |-- posts.js        # archive search, filtering, post detail helpers
|   |-- archives.js     # safe media file downloads
|   |-- monitor.js      # background scan scheduling
|   |-- validation.js   # API query/body parsing and standardized errors
|   |-- status.js       # health, queue, tool, and storage checks
|   |-- downloader.js   # yt-dlp/gallery-dl integration and post persistence
|   `-- queue.js        # Persistent download queue runner
|-- frontend/
|   |-- src/App.jsx
|   |-- src/components/
|   |   |-- MediaBrowser.jsx
|   |   |-- ChannelManager.jsx
|   |   |-- DownloaderForm.jsx
|   |   |-- CookieEditor.jsx
|   |   `-- LogQueue.jsx
|   `-- vite.config.js
|-- data/               # Runtime state, ignored by git
|-- downloads/          # Archived media, ignored by git
|-- Dockerfile
|-- docker-compose.yml
|-- ARCHITECTURE.md
`-- improvements.md
```

## Runtime Requirements

For local non-Docker use:

- Node.js 20 or newer is recommended.
- `ffmpeg` must be available on `PATH`.
- `yt-dlp` must be available on `PATH`.
- `gallery-dl` must be available on `PATH`.

The Docker image installs `python3`, `pip`, `ffmpeg`, `yt-dlp`, and `gallery-dl` for you.

## Quick Start With Docker

```bash
docker compose up --build
```

The app is exposed on:

```text
http://localhost:18080
```

Persistent runtime files are mounted from the host:

```text
./data      -> /app/data
./downloads -> /app/downloads
```

## Local Development

Install backend and frontend dependencies:

```bash
npm run install:all
```

Start the backend API:

```bash
npm run dev:backend
```

Start the frontend dev server in another terminal:

```bash
npm run dev:frontend
```

Development URLs:

```text
Frontend: http://localhost:3000
Backend:  http://localhost:8080
```

The Vite dev server proxies `/api` and `/media` to the backend.

## Configuration

The backend uses these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Express listen port |
| `DATA_DIR` | `./data` relative to repo root in local mode | Stores SQLite DB, `channels.txt`, and `cookies.txt` |
| `DOWNLOADS_DIR` | `./downloads` relative to repo root in local mode | Stores downloaded media |
| `NODE_ENV` | unset locally, `production` in Docker | Runtime mode |

Copy `.env.example` when you want a documented starting point for container or reverse-proxy deployments.

## Persistent Files

### `data/channels.txt`

One monitored profile per line. Accepted formats:

```text
@username
username
https://www.tiktok.com/@username
```

Blank lines and lines beginning with `#` are ignored. On startup and every background scan, the backend syncs this file into the `channels` table. Changes made through the web UI rewrite this file from database state.

### `data/cookies.txt`

Optional TikTok cookies in Netscape/Mozilla cookie file format. When present and non-empty, the backend passes it to `yt-dlp` and `gallery-dl`.

### `data/tiktok.db`

SQLite database containing channels, posts, and download jobs.

### `downloads/`

Downloaded media is stored by channel:

```text
downloads/
`-- @username/
    |-- @username_1234567890.mp4
    |-- @username_1234567890.image
    `-- 1234567891/
        |-- image_1.jpg
        `-- image_2.jpg
```

Video posts are stored as files. Slideshow posts are stored as folders named after the TikTok post ID.

## Web UI Usage

### Archive

The Archive tab shows downloaded posts. You can:

- Search titles, descriptions, and profiles.
- Filter by one or more profiles.
- Filter by all media, videos, or slideshows.
- Sort by upload date, download date, profile, type, or title.
- Filter by upload date range or missing thumbnails.
- Change grid density for desktop or mobile scanning.
- Open videos in the player.
- Open slideshows in the lightbox.
- Download individual video files.

### Profiles

The Profiles tab manages monitored TikTok profiles. Adding a profile:

1. Normalizes the input into a TikTok profile URL.
2. Creates or reactivates the channel in SQLite.
3. Rewrites `data/channels.txt`.
4. Queues an immediate profile scan.

Stopping monitoring keeps existing archived media and only sets the profile inactive.

### Download

The Download tab queues a single media URL. TikTok profile URLs become `channel` jobs. Direct videos and supported video pages are handled with `yt-dlp`; gallery-style URLs, including VSCO galleries, are handled with `gallery-dl` and appear in the archive for viewing and per-file downloads.

### Cookies

The Cookies tab reads and writes `data/cookies.txt`. Use Netscape cookie format exported from a logged-in browser session.

### Tasks

The Tasks tab polls queue state and job logs. It supports pause/resume, active job cancellation, retrying failed or cancelled jobs, deleting history entries, and clearing completed entries.

On startup, any interrupted `downloading` jobs are recovered back to `pending` with a recovery log entry. Failed jobs retry with bounded exponential backoff unless the failure is classified as a validation/cancellation error.

## API Overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/channels` | List channels with archive counts |
| `GET` | `/api/status` | Server, queue, monitor, tool, and storage status |
| `POST` | `/api/channels` | Add or reactivate a monitored profile |
| `DELETE` | `/api/channels/:id` | Stop monitoring a profile |
| `GET` | `/api/posts` | List archived posts with pagination and filters |
| `GET` | `/api/posts/:id` | Get post details and downloaded media file list |
| `GET` | `/api/posts/:id/download` | Download one post media file |
| `GET` | `/api/posts/:id/files/:index/download` | Download one file from a gallery-style archive item |
| `POST` | `/api/download-url` | Queue an arbitrary TikTok profile or media URL |
| `GET` | `/api/queue` | List active and recent jobs |
| `GET` | `/api/queue/:id/logs` | Read a job log |
| `POST` | `/api/queue/:id/cancel` | Cancel a pending or active job |
| `POST` | `/api/queue/:id/retry` | Requeue a failed or cancelled job |
| `DELETE` | `/api/queue/:id` | Delete a non-active queue entry |
| `POST` | `/api/queue/pause` | Pause queue processing |
| `POST` | `/api/queue/resume` | Resume queue processing |
| `DELETE` | `/api/queue/history/completed` | Clear completed and cancelled history |
| `GET` | `/api/cookies` | Read stored cookies |
| `POST` | `/api/cookies` | Save stored cookies |

## Operational Notes

- The queue currently runs in-process and processes one job at a time.
- Job logs are kept in `download_job_logs` and the legacy `log_output` field is capped to avoid unbounded row growth.
- A background monitor starts immediately on boot and repeats every six hours.
- The server serves `/media/*` directly from `DOWNLOADS_DIR`.
- Production frontend files are served by the backend when `frontend/dist` exists.
- This app currently has no authentication or authorization layer. Do not expose it directly to the public internet without putting it behind trusted access control.

## Build Frontend

```bash
npm run build:frontend
```

The backend will serve `frontend/dist` automatically when it exists.
