# Improvements

This file lists recommended improvements from an extensive review of the current codebase. Items are grouped by priority and area. The highest-value work is queue reliability, backend module depth, observability, and a more task-focused archive UI.

## Executive Summary

The app already has a coherent core: profiles are monitored, jobs persist in SQLite, downloads land in predictable folders, and the UI exposes the main workflows. The biggest risks are operational rather than cosmetic:

- Queue recovery is incomplete after process crashes.
- Validation is thin around URLs, IDs, pagination, and file access.
- Backend modules are shallow in places: routing, synchronization, ZIP creation, monitor scheduling, and validation all live in `backend/index.js`.
- The frontend is useful but optimized like a showcase dashboard rather than a dense archive-management tool.



## Priority 1: Queue Reliability and Backend Logic

### 1. Recover interrupted jobs on startup

Files:

- `backend/database.js`
- `backend/queue.js`
- `backend/index.js`

Problem:

The queue stores jobs in SQLite, but `isProcessing` is memory-only. If the process exits during a job, that job can remain `downloading` forever and will not be selected by the pending-job loop.

Recommendation:

On startup, mark stale `downloading` jobs as `failed` or `pending` with a log entry explaining the recovery. Prefer a policy:

- `channel` scans can safely reset to `pending`.
- `post` downloads should reset to `pending` after cleaning or verifying partial files.

Benefits:

- Makes restarts predictable.
- Prevents hidden queue stalls.
- Creates a testable startup recovery interface.

### 2. Split backend modules around deeper interfaces

Files:

- `backend/index.js`
- `backend/downloader.js`
- `backend/queue.js`
- `backend/database.js`

Problem:

`backend/index.js` handles routing, profile-file synchronization, monitor scheduling, ZIP streaming, input normalization, and static serving. The interface is broad and the implementation changes for unrelated reasons.

Recommendation:

Introduce deeper modules:

- `channels.js`: normalize profile input, sync `channels.txt`, add/remove/reactivate channels.
- `posts.js`: search, count, detail lookup, relative media path helpers.
- `archives.js`: ZIP creation for one post, one channel, or all posts.
- `monitor.js`: background scan scheduling and enqueue policy.
- `validation.js`: request parsing, pagination limits, ID/URL validation.

Benefits:

- Improves locality: archive bugs live in archive code, channel sync bugs live in channel code.
- Improves leverage: route handlers become thin adapters over domain operations.
- Makes the interface the test surface instead of testing Express routes for every branch.

### 3. Add bounded retries, backoff, and rate controls

Files:

- `backend/queue.js`
- `backend/downloader.js`

Problem:

Jobs fail once and must be manually requeued. Profile scans can enqueue many post jobs quickly. The monitor queues every monitored channel at the same cadence.

Recommendation:

Add retry metadata to `download_jobs`:

- `attempt_count`
- `max_attempts`
- `next_attempt_at`
- `last_error_class`

Implement exponential backoff for network/tool failures, no retry for validation failures, and optional per-host rate limits.

Benefits:

- Reduces manual intervention.
- Handles TikTok/rate-limit instability more gracefully.
- Makes queue behavior visible and tunable.

### 4. Add explicit job cancellation and pause controls

Files:

- `backend/queue.js`
- `backend/downloader.js`
- `frontend/src/components/LogQueue.jsx`

Problem:

Users can enqueue and observe jobs, but cannot cancel a stuck or unwanted job from the UI.

Recommendation:

Track active child processes by job ID. Add:

- `POST /api/queue/:id/cancel`
- `POST /api/queue/pause`
- `POST /api/queue/resume`

Use process termination carefully and persist a `cancelled` status.

Benefits:

- Gives users control over long downloads.
- Prevents one bad job from blocking the entire queue indefinitely.

### 5. Normalize post and channel identity consistently

Files:

- `backend/downloader.js`
- `backend/database.js`
- `backend/index.js`

Problem:

There is already a database healing path for numeric channel IDs, which indicates identity normalization has been fragile. Username extraction exists in multiple forms.

Recommendation:

Make a single identity module responsible for:

- profile URL normalization
- handle normalization
- post URL canonicalization
- deriving channel IDs from metadata
- detecting unsupported or unknown identity states

Benefits:

- Reduces future data-healing needs.
- Keeps database keys stable.
- Improves tests around hard TikTok URL cases.

## Priority 2: API, Persistence, and Observability

### 6. Add migrations instead of schema-only initialization

Files:

- `backend/database.js`

Problem:

`CREATE TABLE IF NOT EXISTS` works for initial setup but does not provide versioned schema changes.

Recommendation:

Add a `schema_migrations` table and small migration runner. Move current table definitions into migration `001_initial.sql`; add later changes as numbered migrations.

Benefits:

- Enables safe schema evolution.
- Makes deployments reproducible.
- Avoids silent drift between old and new installations.

### 7. Add pagination bounds and API error contracts

Files:

- `backend/index.js`
- `frontend/src/components/MediaBrowser.jsx`

Problem:

Pagination values are parsed directly from query strings. Errors are returned as raw messages with route-by-route variation.

Recommendation:

Clamp `limit`, validate `page`, and standardize errors:

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "limit must be between 1 and 100"
  }
}
```

Benefits:

- Prevents expensive accidental queries.
- Makes frontend error states consistent.
- Makes API behavior easier to test.

### 8. Replace unbounded log concatenation

Files:

- `backend/queue.js`
- `backend/database.js`
- `frontend/src/components/LogQueue.jsx`

Problem:

Job logs are appended into a single SQLite text field. Long-running jobs or verbose tools can make rows large and slow to update.

Recommendation:

Use a `download_job_logs` table with one row per event or cap the existing `log_output` length. Expose paginated logs or tail-only logs.

Benefits:

- Reduces write amplification.
- Keeps the queue table lightweight.
- Supports richer UI log filtering later.

### 9. Add structured application logs

Files:

- `backend/index.js`
- `backend/queue.js`
- `backend/downloader.js`
- `backend/database.js`

Problem:

Logs are mostly plain `console.log` strings. This is fine locally but weak in Docker or proxy deployments.

Recommendation:

Use a lightweight structured logger with fields for `job_id`, `channel_id`, `post_id`, `url_host`, `status`, and `duration_ms`.

Benefits:

- Speeds up production troubleshooting.
- Makes failure patterns visible.
- Allows log aggregation without fragile string matching.

## Priority 3: UI/UX Improvements

### 10. Redesign the app as an archive operations console

Files:

- `frontend/src/App.jsx`
- `frontend/src/index.css`
- all `frontend/src/components/*.jsx`

Problem:

The current UI is visually polished but uses a broad dashboard/glass-card style that consumes space. Archive workflows benefit from denser scanning, sorting, bulk actions, and clear operational state.

Recommendation:

Move toward a quieter operations-console layout:

- Persistent left navigation.
- Compact top toolbar for global actions.
- Dense content tables where comparison matters.
- Media grid density controls.
- Fewer oversized panels.
- Clear status chips for queue, monitor, downloader tools, and storage.

Benefits:

- More archived posts visible per screen.
- Faster management of large archives.
- Less visual noise during repeated use.

### 11. Add a real system status surface

Files:

- `frontend/src/App.jsx`
- `backend/index.js`

Problem:

The sidebar displays "Server Status: ONLINE" statically. It does not reflect backend health, tool availability, queue health, disk free space, or monitor state.

Recommendation:

Add `GET /api/status` returning:

- server uptime
- queue counts by status
- active worker state
- last monitor run
- next monitor run
- `yt-dlp`, `gallery-dl`, and `ffmpeg` availability
- data/download directory writability
- disk free space

Benefits:

- Makes failures self-explanatory.
- Helps users diagnose why downloads are not progressing.

### 12. Improve archive browsing for large collections

Files:

- `frontend/src/components/MediaBrowser.jsx`
- `backend/index.js`

Problem:

Browsing supports search and simple filters, but large archives need stronger discovery tools.

Recommendation:

Add:

- sort by upload date, download date, profile, type, and title
- date-range filters
- profile multi-select
- saved views
- "missing thumbnail" and "failed download" filters
- infinite scroll or virtualized grid
- selectable cards and bulk ZIP/download actions

Benefits:

- Makes the archive useful after thousands of posts.
- Reduces repetitive profile-by-profile operations.

### 13. Make queue actions first-class

Files:

- `frontend/src/components/LogQueue.jsx`
- `backend/queue.js`

Problem:

The queue view is observability-only.

Recommendation:

Add controls for:

- retry failed job
- cancel active job
- delete history entry
- clear completed jobs
- pause/resume queue
- filter by status/type
- show estimated duration and attempt count

Benefits:

- Turns the queue into an operations surface.
- Reduces the need to restart the container or edit SQLite manually.

### 14. Improve media cards and previews

Files:

- `frontend/src/components/MediaBrowser.jsx`
- `frontend/src/index.css`

Problem:

Cards depend on thumbnails that may be missing or have unusual `.image` extensions. Metadata density is low.

Recommendation:

Add:

- robust fallback thumbnails by media type
- visible duration for videos when metadata exists
- slideshow image count
- download status indicators
- quick actions on hover/focus
- selectable card mode for bulk actions
- keyboard focus rings and ARIA labels for icon-only actions

Benefits:

- Faster visual scanning.
- Better accessibility.
- Better handling of partial or old archive data.

## Priority 4: Testing and Developer Experience

### 15. Add automated tests around core behavior

Files:

- `backend/*.js`
- `frontend/src/components/*.jsx`

Problem:

No test framework or test scripts are currently defined.

Recommendation:

Add backend tests for:

- URL normalization
- username extraction
- profile-vs-post detection
- channel file synchronization
- queue enqueue/reset behavior
- startup recovery
- API query validation

Add frontend tests for:

- filter parameter generation
- queue polling behavior
- error rendering
- profile add/remove flows

Benefits:

- Protects the highest-risk logic.
- Makes future refactors safe.

### 16. Add linting and formatting

Files:

- `package.json`
- `backend/package.json`
- `frontend/package.json`

Problem:

There are no lint, format, or test scripts at the root.

Recommendation:

Add ESLint and Prettier or Biome. Provide root scripts:

```json
{
  "lint": "npm run lint --prefix backend && npm run lint --prefix frontend",
  "test": "npm run test --prefix backend && npm run test --prefix frontend",
  "format": "prettier --write ."
}
```

Benefits:

- Keeps contributions consistent.
- Catches React hook and accessibility mistakes earlier.

### 17. Add sample environment and operational docs

Files:

- `.env.example`
- `README.md`

Problem:

Configuration exists but is not represented as a sample env file.

Recommendation:

Add `.env.example` with `PORT`, `DATA_DIR`, `DOWNLOADS_DIR`, and deployment notes for reverse proxies.

Benefits:

- Shortens setup time.
- Makes production expectations explicit.

## Backend Deepening Opportunities

These are the main architecture refactors worth considering.

### 1. Channel registry module

Files:

- `backend/index.js`
- `backend/database.js`
- `data/channels.txt`

Problem:

Channel state lives in both a file and SQLite, but the sync behavior is embedded in the server module.

Solution:

Create a channel registry module that owns the file/database interface and exposes operations like `syncFromFile()`, `listChannels()`, `monitorProfile(input)`, and `stopMonitoring(id)`.

Benefits:

- Locality: all channel sync rules live together.
- Leverage: route handlers and monitor code share one interface.
- Tests can cover file sync without booting Express.

### 2. Archive module

Files:

- `backend/index.js`
- `backend/downloader.js`

Problem:

Archive path resolution, post lookup, slideshow file listing, single-post downloads, and ZIP streaming are scattered between route handlers and downloader output assumptions.

Solution:

Create an archive module responsible for relative path validation, post media lookup, slideshow image enumeration, and ZIP stream assembly.

Benefits:

- Locality: file-serving rules and path safety live together.
- Leverage: the same module can support API downloads, future bulk actions, and consistency checks.

### 3. Download adapter module

Files:

- `backend/downloader.js`

Problem:

The downloader module combines metadata extraction, command construction, process execution, progress parsing, media type detection, file discovery, and database writes.

Solution:

Split child-process adapters from archive persistence:

- `YtDlpAdapter`
- `GalleryDlAdapter`
- `PostDownloader`
- `PostRepository`

Benefits:

- Locality: command/tool details are isolated.
- Leverage: tests can fake adapter output without spawning real tools.
- Makes future support for alternate download strategies possible.

### 4. Queue worker module

Files:

- `backend/queue.js`

Problem:

Queue persistence, job selection, job execution, logging, retries, and worker state are combined in one module.

Solution:

Separate a job repository from a worker runner. The runner should depend on explicit handlers for `channel` and `post` jobs.

Benefits:

- Locality: persistence rules are not mixed with download behavior.
- Leverage: retry/cancel/recovery policy can be tested through the worker interface.

## Suggested Implementation Order

1. Add queue startup recovery.
2. Extract channel registry and archive modules.
3. Add tests around extracted modules.
4. Add `/api/status` and replace static status UI.
5. Redesign Archive and Queue screens for dense operations.
6. Add retries, cancellation, and backoff.
7. Add migrations and structured logs.
