# TikTok Archiver

TikTok Archiver is a self-hosted media archive for TikTok profiles, individual videos, and photo slideshows. It provides a React web interface, an Express API, a SQLite catalog, and a background queue that calls `yt-dlp` and `gallery-dl` to collect media into a local `downloads/` directory.

## What It Does

- Monitor TikTok profiles listed in the web UI or `data/channels.txt`.
- Scan monitored profiles every six hours and queue newly discovered posts.
- Download individual TikTok video or photo slideshow URLs on demand.
- Store archive metadata in SQLite at `data/tiktok.db`.
- Store media files on disk under `downloads/@handle/`.
- Browse, filter, preview, and download archived media from the web UI.
- Export a profile archive or the full archive as ZIP.
- Save TikTok cookies in Netscape `cookies.txt` format for authenticated downloads.

## Repository Layout

```text
.
|-- backend/
|   |-- index.js        # Express server, REST API, static frontend hosting, monitor scheduler
|   |-- database.js     # SQLite connection, schema creation, database healing
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

- Search titles and descriptions.
- Filter by profile.
- Filter by all media, videos, or slideshows.
- Open videos in the custom player.
- Open slideshows in the lightbox.
- Download one post, one profile ZIP, or the full archive ZIP.

### Profiles

The Profiles tab manages monitored TikTok profiles. Adding a profile:

1. Normalizes the input into a TikTok profile URL.
2. Creates or reactivates the channel in SQLite.
3. Rewrites `data/channels.txt`.
4. Queues an immediate profile scan.

Stopping monitoring keeps existing archived media and only sets the profile inactive.

### Download

The Download tab queues a single TikTok URL. Profile URLs become `channel` jobs. Video and slideshow URLs become `post` jobs.

### Cookies

The Cookies tab reads and writes `data/cookies.txt`. Use Netscape cookie format exported from a logged-in browser session.

### Tasks

The Tasks tab polls queue state and job logs. Active jobs are shown separately from recent completed or failed jobs.

## API Overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/channels` | List channels with archive counts |
| `POST` | `/api/channels` | Add or reactivate a monitored profile |
| `DELETE` | `/api/channels/:id` | Stop monitoring a profile |
| `GET` | `/api/posts` | List archived posts with pagination and filters |
| `GET` | `/api/posts/:id` | Get post details and slideshow image list |
| `GET` | `/api/posts/:id/download` | Download one post file or slideshow ZIP |
| `GET` | `/api/posts/zip` | Download full archive or profile ZIP |
| `POST` | `/api/download-url` | Queue an arbitrary TikTok profile/post URL |
| `GET` | `/api/queue` | List active and recent jobs |
| `GET` | `/api/queue/:id/logs` | Read a job log |
| `GET` | `/api/cookies` | Read stored cookies |
| `POST` | `/api/cookies` | Save stored cookies |

## Operational Notes

- The queue currently runs in-process and processes one job at a time.
- A background monitor starts immediately on boot and repeats every six hours.
- The server serves `/media/*` directly from `DOWNLOADS_DIR`.
- Production frontend files are served by the backend when `frontend/dist` exists.
- This app currently has no authentication or authorization layer. Do not expose it directly to the public internet without putting it behind trusted access control.

## Build Frontend

```bash
npm run build:frontend
```

The backend will serve `frontend/dist` automatically when it exists.

