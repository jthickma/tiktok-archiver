# TikTok Archiver — API Reference

Base URL: `http://localhost:8080`

## Channels

### GET /api/channels

List all channels with download counts.

### POST /api/channels

Add a profile URL for monitoring.

- Body: `{ "url": "https://www.tiktok.com/@username" }`

### DELETE /api/channels/:id

Stop monitoring a channel.

## Posts

### GET /api/posts

List posts with pagination, filtering, and sorting.

- Query params: `page`, `limit`, `sort`, `direction`, `channel_id`, `type`, `search`, `date_from`, `date_to`, `missing_thumbnail`

### GET /api/posts/:id

Get post details with media file listing.

### GET /api/posts/:id/download

Download the primary media file.

### GET /api/posts/:id/files/:index/download

Download a specific media file by index.

## Queue

### GET /api/queue

List active and historical jobs.

- Query params: `status`, `type`

### GET /api/queue/:id/logs

Get job logs.

### POST /api/queue/:id/cancel

Cancel an active job.

### POST /api/queue/:id/retry

Retry a failed job.

### DELETE /api/queue/:id

Delete a completed/failed job.

### DELETE /api/queue/history/completed

Clear all completed and cancelled jobs.

### POST /api/queue/pause

Pause the queue processor.

### POST /api/queue/resume

Resume the queue processor.

## Download

### POST /api/download-url

Submit a URL for downloading.

- Body: `{ "url": "...", "downloader": "auto"|"gallery-dl" }`

## System

### GET /api/status

System status including server, queue, monitor, tools, and storage.

### GET /api/cookies

Get current cookies file content.

### POST /api/cookies

Save cookies file content.

- Body: `{ "cookies": "..." }`

## Archive

### GET /api/archive/stats

Archive statistics (total posts, by type, by channel, storage breakdown).

### GET /api/archive/orphans

List files in downloads directory not linked to any post.

### POST /api/archive/orphans/cleanup

Remove orphan files from disk.

### POST /api/archive/deduplicate

Find and merge duplicate posts by URL.
