# TikTok Archiver — Architecture, Robustness, UI, and Docs Improvements


## Problem Statement

The project is a self-hosted TikTok/VSCO media archiver (Express + SQLite + React + yt-dlp/gallery-dl). It already has a reasonable layering (routes → services → repositories), but several areas have efficiency, robustness, mobile-UI, and documentation gaps that are worth addressing in a focused pass.

## Current State (key observations)

* **Backend layering exists but is inconsistent.** `index.js` mounts route modules for most resources but still inlines the `/api/download-url` handler and directly imports `dbAll/dbGet/dbRun` and `archiveService`. `queue.js` is a thin re-export shim over `services/job-service.js`, but `job-service.js` still reaches back into `downloader.js` via dynamic `import()` and issues raw SQL (`SELECT id FROM posts ...`) instead of using the post repository.
* **SQLite is single-connection, synchronous-style.** `database.js` opens one `sqlite3` Database and wraps `run/get/all` in promises. There is no WAL mode, no busy timeout, and no PRAGMA tuning, so concurrent reads/writes (monitor + queue + API) can serialize or hit `SQLITE_BUSY`.
* **Status endpoint is expensive and called frequently.** `/api/status` spawns three child processes (`yt-dlp --version`, `gallery-dl --version`, `ffmpeg --version`) on every call, and the frontend polls it every 10s. That's 3 spawns × 6 calls/min = 18 process spawns/min just for status.
* **`downloader.js` is a 1077-line god module** mixing yt-dlp, gallery-dl, VSCO direct fallback, post persistence, thumbnail generation, and metadata parsing. It uses three separate hand-rolled `spawn` wrappers (`spawnTool`, `spawnCapture`, and inline in `getMetadata`/`scanProfile`) with duplicated stdout/stderr buffering and no abort signal support (cancellation relies on `proc.kill` from a side-channel map).
* **No request timeouts or concurrency limits** on spawned download tools; a hung yt-dlp can block the single-worker queue indefinitely.
* **Frontend has responsive CSS but rough edges:** no code-splitting (single `App.jsx` bundle imports every component eagerly), no skeleton/loading states beyond text, `LogQueue` polls every 1.5s with full refetch (no etag/if-modified), `MediaBrowser` keyboard handlers and cross-page nav are correct but the modal layout uses many `!important` overrides in `index.css`, and the `SystemOverview`/metrics row duplicate information.
* **README is good** but documents an `ARCHITECTURE.md` and `improvements.md` that were deleted (commit `e6ef6fa`), and the API table omits the newer `/api/archive/*` maintenance endpoints.

## Proposed Changes

### 1. Backend robustness & efficiency

**SQLite hardening** (`database.js`)
* Enable `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL`, `PRAGMA busy_timeout=5000`, and `PRAGMA foreign_keys=ON` after open. This materially improves concurrency between the monitor, queue worker, and API reads, and reduces `SQLITE_BUSY` failures.
* Wrap the single `db` handle so PRAGMAs are applied once. Keep the existing `dbRun/dbGet/dbAll` API unchanged.

**Status endpoint caching** (`status.js`)
* Cache tool-availability results with a TTL (e.g. 60s) instead of spawning three processes per request. Store `{ytDlp, galleryDl, ffmpeg, checkedAt}` in a module-scoped cache and reuse until stale.
* This removes ~18 spawns/min under the 10s frontend poll.

**Download tool timeouts & signals** (`downloader.js`)
* Add an `AbortController`-based timeout to all spawn wrappers (default e.g. 30 min, configurable via `DOWNLOAD_TIMEOUT_MS`). On timeout, kill the child process tree and reject with a classified `timeout` error so the queue can retry.
* Consolidate the three spawn wrappers into one `runProcess({ command, args, label, onStdout, capture, timeout, signal })` helper.
* Pass the queue's cancellation signal through to spawned `yt-dlp`/`gallery-dl` so SIGTERM propagates cleanly.

**Queue service cleanup** (`services/job-service.js`)
* Replace the raw `SELECT id FROM posts WHERE id = ?` and `INSERT OR IGNORE INTO download_jobs ...` in the channel-scan loop with calls to `post-repository.js` (`getPostById`/`getAllPosts`) and `job-repository.js` (`enqueueJob`). This removes SQL duplication and keeps the service layer SQL-free.
* Move the `import('../downloader.js')` dynamic imports to top-level static imports if the cycle can be broken (downloader imports from database/utils, not from services, so a static import should be safe and removes lazy-load latency).

**Database healing performance** (`database.js`)
* `healDatabase` runs on every startup and scans all posts twice with per-row `dbGet`/`dbRun` calls. For large archives this is O(n) round-trips. Batch the channel existence checks into a single `SELECT` and use a transaction (`BEGIN/COMMIT`) for the updates. Guard with a schema-version flag so it only re-runs when needed rather than every boot.

### 2. Frontend UI cleanup (mobile + desktop)

**Code-splitting & loading states**
* Lazy-load tab components (`React.lazy` + `Suspense`) so the initial bundle only includes the active tab. This reduces first-load size for the Archive grid which is the heaviest view.
* Add lightweight skeleton placeholders for the media grid and queue list instead of plain "Loading..." text.

**Status bar consolidation**
* The `topbar`, `metrics-row`, and `SystemOverview` all show overlapping queue/storage info. Consolidate into one responsive status strip: metrics on desktop, collapsed summary on mobile, with `SystemOverview` as a disclosure.
* Reduce `/api/status` poll interval to 15–20s (was 10s) now that status is cached server-side; pause polling when the tab is hidden via the Page Visibility API.

**Media modal CSS hardening**
* The `@media (max-width: 768px)` block in `index.css` uses ~15 `!important` overrides to force a layout that `media-viewer.css` should already produce. Move those rules into `media-viewer.css` using proper specificity (mobile-first base + desktop `min-width` overrides) and drop the `!important` declarations.
* Ensure the modal info pane scrolls independently on mobile (the current `min-height: 100dvh` container can clip the caption on small screens).

**Queue polling efficiency**
* `LogQueue` refetches the entire queue every 1.5s. Increase to 2.5–3s, and skip the log sub-fetch when the selected job is in a terminal state (`completed`/`failed`/`cancelled`).

### 3. Documentation

**README updates**
* Remove the stale `ARCHITECTURE.md` / `improvements.md` references from the repository layout block (both files were deleted).
* Add the `/api/archive/*` maintenance endpoints (stats, storage breakdown, orphans, dedupe) to the API table.
* Document the new env vars introduced by the robustness work (`DOWNLOAD_TIMEOUT_MS`, and note WAL mode).
* Add a short "Architecture" subsection describing the routes → services → repositories layering so contributors understand the boundaries without a missing ARCHITECTURE.md.

**Inline code docs**
* Add module-level JSDoc to `downloader.js` explaining the yt-dlp → gallery-dl → VSCO-direct fallback chain, since it's the most complex module.
* Document the `safeResolve` path-traversal guard in `utils/path-utils.js` with a comment noting why it's security-critical.

## Scope & Validation

* Run `npm run lint` (backend `node --check` across all files + frontend `vite build`) and `npm run test` (backend `node --test`) after changes.
* Manually verify: status endpoint returns within reasonable time after caching; a download still succeeds end-to-end; the media modal lays out correctly at 375px, 768px, and 1280px widths.
* Keep changes backward-compatible: no DB schema changes, no API signature changes, no new runtime dependencies.

## Orchestration

* **Decision**: Child agents will not be used. The work is a single coherent refactor across backend + frontend + docs within one repo, with interdependent edits (e.g. spawn-wrapper consolidation touches `downloader.js` and `job-service.js` together). A single agent can handle this more safely than parallel children that would risk conflicting edits to `downloader.js` and the CSS.
* **Dependencies and ordering**: Backend SQLite/PRAGMA changes first (low risk, foundational) → status caching → spawn/timeout consolidation → queue service cleanup → frontend code-splitting and CSS → README/docs last (reflects final state).
* **Merge strategy**: Single branch, one PR, validated by lint + test before handoff.
