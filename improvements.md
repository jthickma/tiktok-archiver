# Improvements

Review date: 2026-06-13

This project is a compact Dockerized archive console: a single Express process serves the API, static React build, queue worker, monitor scheduler, SQLite persistence, and local media files. The core workflow is coherent and already has useful operations features: persistent jobs, bounded retries, cancellation, queue pause/resume, profile monitoring, archive filters, thumbnails, structured API errors, and a `/api/status` endpoint.

The most valuable remaining work is to keep the deployment observable, make the large downloader/archive modules easier to test, and make the UI faster for large archives.

## Implemented In This Pass

- Added a shared frontend API helper in `frontend/src/utils/api.js` so components use the same JSON error-contract handling.
- Added shared formatting and media helpers in `frontend/src/utils/format.js` and `frontend/src/utils/media.js`.
- Added `frontend/src/components/SystemOverview.jsx` to expose queue worker, monitor, tool, storage, and uptime state directly in the main UI.
- Added Docker image healthcheck coverage through `/api/status`.
- Removed the obsolete Compose `version` field.

## High-Value Functionality Improvements

### 1. Archive Workflows

Add saved archive views for common filters such as profile groups, missing thumbnails, recent downloads, and media type. The current filters are strong, but repeated operators have to rebuild the same view each session.

Add bulk actions after selection support is introduced:

- download selected files
- delete selected archive entries and media files
- regenerate selected thumbnails
- export selected metadata as JSON or CSV

### 2. Queue Operations

The queue supports cancellation, retry, clearing completed jobs, pause, and resume. The next useful controls are queue priority and reordering:

- move pending job to top
- pause only profile scans while allowing direct downloads
- retry only jobs with a selected error class
- set per-job max attempts

Add explicit rate-limit settings for TikTok/profile scans so monitored profiles do not enqueue large bursts at once.

### 3. Monitor Management

The monitor currently runs immediately on startup and then every six hours. Add a UI surface for:

- manual "scan now"
- per-profile scan interval
- last result and last error per profile
- backoff after repeated profile failures
- disabling startup scan for constrained deployments

### 4. Authentication And Exposure

The app has no authentication or authorization model. Keep the README warning, but add one of these before any public deployment:

- reverse-proxy auth with documented headers
- basic auth in the Express app
- single-user session auth

This matters because the UI can write cookies, trigger downloads, and expose local archived media.

### 5. Storage Management

The UI now shows disk health, but users still need maintenance actions:

- show largest profiles
- show orphaned files not present in SQLite
- show posts whose media is missing on disk
- prune failed job logs older than a configurable age
- compact or vacuum SQLite on demand

## Module Improvements

### 1. Split Downloader Responsibilities

`backend/downloader.js` still mixes tool invocation, metadata parsing, media discovery, post persistence, filename policy, and fallback behavior. Split it into:

- tool adapters: `yt-dlp`, `gallery-dl`
- metadata normalization
- archive file discovery
- post repository writes
- thumbnail extraction hooks

This would let tests fake tool output without spawning external binaries.

### 2. Split Database Schema From Healing

`backend/database.js` creates tables, adds columns, creates indexes, records schema state, and heals historical channel mappings. Move toward:

- `database/connection.js`
- `database/migrations.js`
- `database/schema/*.sql`
- `database/heal.js`

The existing `schema_migrations` table is a good start, but schema changes are still embedded in code instead of applied as versioned migrations.

### 3. Separate Queue Persistence From Worker Policy

`backend/queue.js` combines job repository queries, worker state, cancellation, retry classification, logging, and job execution. Extract:

- `jobRepository`
- `jobLogger`
- `queueWorker`
- `retryPolicy`

That would make recovery, duplicate enqueue behavior, and retry backoff directly testable.

### 4. Break Up Archive Browser UI

`frontend/src/components/MediaBrowser.jsx` is the main frontend hotspot. It owns filters, pagination, card rendering, modal playback, slideshow navigation, and keyboard shortcuts. Split it into:

- `ArchiveToolbar`
- `ProfileFilter`
- `MediaGrid`
- `MediaCard`
- `MediaModal`
- `useArchiveQuery`

The utility extraction in this pass reduces shared helper duplication, but the component is still large enough to slow feature work.

## UI Improvements

The current UI is already an operations console rather than a landing page. Continue that direction:

- Replace browser `confirm()` for destructive profile actions with an in-app modal that keeps focus inside the dialog.
- Replace text-only action buttons such as `DL`, `Retry`, and `Delete` with consistent icon-plus-tooltip controls once an icon library is added.
- Add a compact status drawer for detailed tool paths, data directory, downloads directory, and last status check time.
- Add a queue log severity filter and copy-log action.
- Add archive keyboard focus affordances for card navigation outside the modal.
- Add skeleton states for archive and queue loading instead of full empty-state replacement.

## Testing And Verification Debt

Current scripts mostly perform syntax/build checks. Add focused automated tests before deeper backend refactors:

- identity normalization and URL classification
- API query validation
- channel file/database sync
- duplicate enqueue and requeue behavior
- startup recovery of interrupted jobs
- retry policy classification and backoff
- archive media path safety
- frontend request helper error handling

For Docker, add CI jobs for:

- `npm run lint`
- `npm run build:frontend`
- container build
- a smoke test that starts the image and waits for `/api/status`

## Suggested Order

1. Add unit tests for identity, validation, queue repository behavior, and request helpers.
2. Split `MediaBrowser.jsx` into subcomponents while tests/build are green.
3. Extract queue repository and retry policy from `backend/queue.js`.
4. Extract downloader tool adapters from `backend/downloader.js`.
5. Add monitor controls and per-profile health state.
6. Add authentication or document a supported reverse-proxy auth recipe.
