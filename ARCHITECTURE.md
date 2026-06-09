# Architecture

This document describes the current architecture as implemented in the repository. It is intended to be a maintenance guide and a baseline for future refactors.

## System Summary

TikTok Archiver is a two-part web application:

- A Node/Express backend owns persistence, queue processing, file downloads, file serving, and the periodic monitor.
- A React/Vite frontend owns navigation, archive browsing, profile management, cookie editing, and queue visibility.

The backend is the only process that talks to SQLite, `yt-dlp`, `gallery-dl`, and the filesystem. The frontend calls the backend with relative `/api/*` and `/media/*` URLs.

## High-Level Flow

```text
Browser
  |
  | HTTP /api, /media
  v
Express backend
  |
  |-- SQLite catalog and queue: data/tiktok.db
  |-- profile list: data/channels.txt
  |-- TikTok cookies: data/cookies.txt
  |-- archived media: downloads/
  |
  | child processes
  v
yt-dlp / gallery-dl / ffmpeg
```

## Runtime Modules

### Backend Server Module

File: `backend/index.js`

Responsibilities:

- Create the Express application.
- Configure CORS, JSON parsing, and static media serving.
- Ensure `DATA_DIR` and `DOWNLOADS_DIR` exist.
- Synchronize `channels.txt` with the SQLite `channels` table.
- Define all REST API routes.
- Serve `frontend/dist` in production builds.
- Initialize the database and start the background monitor.

Important module interfaces:

- `GET /api/channels`
- `POST /api/channels`
- `DELETE /api/channels/:id`
- `GET /api/posts`
- `GET /api/posts/:id`
- `GET /api/posts/:id/download`
- `POST /api/download-url`
- `GET /api/queue`
- `GET /api/queue/:id/logs`
- `GET /api/cookies`
- `POST /api/cookies`

The server module currently mixes routing, validation, archive streaming, file synchronization, and monitor scheduling in one file. This keeps the deployment simple, but it makes route behavior and background behavior tightly coupled.

### Database Module

File: `backend/database.js`

Responsibilities:

- Open the SQLite database.
- Create the `channels`, `posts`, and `download_jobs` tables.
- Provide promise wrappers around `sqlite3` methods.
- Run a startup healing pass that fixes known incorrect numeric channel mappings.

Tables:

#### `channels`

| Column | Meaning |
| --- | --- |
| `id` | Primary key, normalized as `@username` |
| `username` | Username without leading `@` |
| `url` | TikTok profile URL |
| `created_at` | ISO timestamp |
| `last_checked_at` | ISO timestamp of last monitor scan |
| `is_monitored` | `1` for active monitor, `0` for inactive |

#### `posts`

| Column | Meaning |
| --- | --- |
| `id` | TikTok post ID |
| `channel_id` | Channel key such as `@username` |
| `type` | `video`, `slideshow`, `image`, `gallery`, `audio`, or `media` |
| `title` | Metadata title |
| `description` | Metadata description |
| `url` | Original or resolved post URL |
| `upload_date` | `YYYY-MM-DD` |
| `file_path` | Path relative to `DOWNLOADS_DIR` |
| `thumbnail_path` | Path relative to `DOWNLOADS_DIR` |
| `downloaded_at` | ISO timestamp |
| `metadata_json` | Raw JSON metadata from `yt-dlp` |

#### `download_jobs`

| Column | Meaning |
| --- | --- |
| `id` | Autoincrement job ID |
| `url` | Queued URL, unique |
| `type` | `channel`, `post`, or `gallery-dl` |
| `status` | `pending`, `downloading`, `completed`, `failed`, or `cancelled` |
| `progress` | Integer percentage |
| `log_output` | Accumulated job log |
| `error_message` | Failure reason |
| `created_at` | ISO timestamp |
| `started_at` | ISO timestamp |
| `completed_at` | ISO timestamp |
| `attempt_count` | Number of worker attempts |
| `max_attempts` | Maximum attempts before terminal failure |
| `next_attempt_at` | ISO timestamp for retry backoff |
| `last_error_class` | Last classified failure group |
| `cancelled_at` | ISO timestamp for user cancellation |

### Downloader Module

File: `backend/downloader.js`

Responsibilities:

- Normalize TikTok usernames from input URLs and metadata.
- Fetch post metadata through `yt-dlp --dump-json`.
- Scan profile entries through `yt-dlp --flat-playlist --dump-json`.
- Download videos through `yt-dlp`.
- Download slideshow and explicit gallery jobs through `gallery-dl`.
- Preserve media file modification dates from upload dates when possible.
- Insert downloaded post metadata into SQLite.

Important behaviors:

- Cookies are passed to download tools only when `data/cookies.txt` exists and is non-empty.
- Video output is named `@username_postId.ext`.
- Slideshow output is stored in a folder named after the post ID.
- Duplicate posts are skipped based on `posts.id`.
- Missing usernames fall back to `@unknown`.

### Queue Module

File: `backend/queue.js`

Responsibilities:

- Insert jobs into `download_jobs`.
- Reset failed or completed jobs when the same URL is enqueued again.
- Process one pending job at a time.
- Convert channel scan jobs into individual post download jobs.
- Persist progress, logs, errors, and completion timestamps.

Job lifecycle:

```text
pending -> downloading -> completed
                      |-> failed
                      \-> cancelled
```

Channel job flow:

```text
profile URL
  -> scanProfile()
  -> collect entries
  -> skip existing posts
  -> insert pending post jobs
  -> complete channel job
```

Post job flow:

```text
post URL
  -> getMetadata()
  -> detect video vs slideshow
  -> download media
  -> write post row
  -> complete post job
```

Explicit gallery-dl job flow:

```text
HTTP URL
  -> gallery-dl
  -> collect downloaded media files
  -> write post row
  -> complete gallery-dl job
```

The queue is persistent in SQLite but the worker state is in process memory. Startup recovers interrupted `downloading` jobs back to `pending` with a recovery log entry.

## Frontend Modules

### App Shell

File: `frontend/src/App.jsx`

Responsibilities:

- Own the active navigation tab.
- Poll summary stats every ten seconds.
- Render sidebar navigation and dashboard stat cards.
- Route tab state to feature components without a client router.

### Archive Browser

File: `frontend/src/components/MediaBrowser.jsx`

Responsibilities:

- Fetch paginated posts and channels.
- Apply search, profile, and media-type filters.
- Render media cards.
- Open video and slideshow modals.
- Provide keyboard navigation inside the active media viewer.
- Trigger individual video downloads.

The video player is implemented inside this file, including controls, keyboard shortcuts, fullscreen support, volume, timeline, and speed selection.

### Profile Manager

File: `frontend/src/components/ChannelManager.jsx`

Responsibilities:

- List all known channels and monitoring status.
- Add or reactivate monitored profiles.
- Stop monitoring profiles without deleting archived media.

### On-Demand Downloader

File: `frontend/src/components/DownloaderForm.jsx`

Responsibilities:

- Accept any TikTok profile, video, slideshow, gallery, or generic supported media URL.
- Submit it to `/api/download-url` with `downloader: "auto"` or `downloader: "gallery-dl"`.
- Navigate users to the queue after successful submission.

### Cookie Editor

File: `frontend/src/components/CookieEditor.jsx`

Responsibilities:

- Read and write `data/cookies.txt` through the backend.
- Explain the expected Netscape cookie file format.

### Queue Viewer

File: `frontend/src/components/LogQueue.jsx`

Responsibilities:

- Poll active and historical jobs.
- Let users select a job.
- Poll selected job logs while it is active.
- Render progress and failure details.

## Data Synchronization

`channels.txt` and the `channels` table are intentionally both sources of operational state:

- Startup and monitor scans read `channels.txt` and update the database.
- Web UI profile changes update the database and rewrite `channels.txt`.
- Removing a channel from `channels.txt` marks it inactive in SQLite during the next sync.

This design gives users a plain-text control file while keeping the UI queryable through SQLite. The tradeoff is that concurrent edits can race because the sync uses whole-file reads and writes.

## Background Monitor

The monitor runs immediately on startup and then every six hours.

Monitor steps:

1. Sync `data/channels.txt` into SQLite.
2. Read all channels where `is_monitored = 1`.
3. Enqueue one `channel` job per monitored profile.
4. Update `last_checked_at`.

The monitor does not currently implement rate limits, jitter, per-profile schedules, or backoff after repeated failures.

## Media Serving and Downloads

The backend serves the entire `DOWNLOADS_DIR` under `/media`. Database paths are stored relative to `DOWNLOADS_DIR`, then converted into URLs by the frontend.

Download routes:

- A video post downloads its media file directly.
- Slideshow posts are previewed through `/api/posts/:id` and `/media`; directory downloads are disabled.

## Deployment Model

The Dockerfile uses two stages:

1. Build React assets in a Node image.
2. Run the Node backend with system media tools installed.

`docker-compose.yml` maps host port `18080` to container port `8080`, mounts persistent data and downloads, and restarts the container unless stopped.

## Current Architectural Constraints

- Single process owns API, worker, scheduler, and static serving.
- Single queue worker means predictable IO but no parallel downloads.
- SQLite keeps deployment simple but limits horizontal scaling.
- Download tool output is parsed from child-process streams and persisted as text logs.
- No authentication, authorization, or multi-user model exists.
- No test suite currently protects queue behavior, downloader command construction, or API contracts.
