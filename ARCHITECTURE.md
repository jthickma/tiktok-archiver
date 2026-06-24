# Architecture

## Design Vocabulary

This repository uses the following terms consistently:

- **module**: implementation hidden behind an interface.
- **interface**: the behavior callers depend on and tests exercise.
- **depth**: the amount of implementation hidden by an interface.
- **seam**: a place where one implementation can be replaced.
- **adapter**: an implementation connected at a seam.
- **locality**: related decisions and invariants live together.
- **leverage**: one interface supports many callers.

Deep modules are preferred. A new seam requires two real adapters or a clear
operational reason; test-only indirection is not sufficient.

## Runtime Shape

```text
React presentation
        |
   Express routes
        |
  +-----+----------------------+--------------------+
  |                            |                    |
Download Queue         Monitored Profiles     Archive Catalog
  |                            |                    |
Acquisition adapters      file + SQLite       SQLite + filesystem
  |
yt-dlp / gallery-dl / HTTP / ffmpeg
```

`backend/index.js` is the composition root. It creates concrete modules and
connects route adapters. It must not contain domain persistence or process
lifecycle logic.

## Deep Backend Modules

### Download Queue

Files:

- `backend/download-queue.js`
- `backend/queue.js` (compatibility exports)
- `backend/repositories/job-repository.js`

The Download Queue owns:

- durable enqueue/requeue behavior;
- single-worker state;
- retry classification and delayed wake-up;
- progress and log persistence;
- cancellation of active child processes;
- conversion of profile scans into post jobs;
- dispatch to Acquisition.

Routes, status checks, and the profile monitor use the queue interface. They do
not receive database helper functions.

The job repository is internal persistence implementation. Repository tests
protect SQL details; `download-queue.test.js` protects lifecycle behavior
through the real queue interface.

### Acquisition

Files:

- `backend/acquisition.js`
- `backend/downloader.js`
- `backend/yt-dlp-options.js`
- `backend/thumbnails.js`

The Acquisition interface is intentionally small: profile scan, normal media
download, gallery download, and metadata lookup. Provider parsing, child
processes, fallback logic, naming, and normalized results retain locality in
the implementation.

External tools are real adapters. The queue can substitute them in tests
without mocking internal queue behavior.

### Monitored Profiles

Files:

- `backend/channels.js`
- `backend/repositories/channel-repository.js`
- `backend/routes/channel-routes.js`

This module owns profile mutations, Profile Reconciliation, monitor timing,
last-scan updates, and requests to the Download Queue.

`channels.txt` and SQLite are intentionally both operational state. The policy
is recorded in [ADR-0001](docs/adr/0001-dual-profile-state.md).

### Archive Catalog

Files:

- `backend/archive-catalog.js`
- `backend/archive-runtime.js`
- `backend/repositories/post-repository.js`
- `backend/utils/media-files.js`
- `backend/utils/path-utils.js`

The Archive Catalog owns the database-to-filesystem invariant. Search, detail,
safe file resolution, thumbnails, statistics, orphan detection, cleanup, and
deduplication cross one interface.

HTTP route modules contain request parsing and response adaptation only.

## Database Adapter

`backend/database.js` exports one stable `database` adapter with `run`, `get`,
and `all`. Compatibility function exports remain for migrations and repository
tests. Deep modules receive the adapter rather than three unrelated function
arguments.

SQLite remains appropriate for the single-process deployment model. The queue,
monitor, API, and static file server intentionally run in one Node process.

## Frontend Presentation

`frontend/src/App.jsx` owns application navigation and system status.

The Archive workspace is split into:

- `MediaBrowser.jsx`: query state, pagination, and Archive Item selection;
- `archive/ArchiveFilters.jsx`: filter controls;
- `archive/ArchiveViewer.jsx`: media viewing, keyboard control, metadata, and
  per-file download behavior.

Styles have explicit ownership:

- `app-shell.css`: app shell, navigation, dashboard, archive workspace, and
  installed/mobile shell states;
- `media-viewer.css`: viewer layout and responsive viewer behavior;
- `queue.css`: queue layout and responsive queue behavior;
- remaining files: shared variables, controls, and feature presentation.

`index.css` is only an import manifest. It contains no late responsive
overrides.

## Test Surfaces

The interface is the primary test surface:

- Download Queue lifecycle: `backend/download-queue.test.js`
- Monitored Profile reconciliation: `backend/channels.test.js`
- Archive Catalog row/file invariant: `backend/archive-catalog.test.js`
- SQL implementation: `backend/tests/repositories/*`
- identity, validation, naming, migration, tool options: focused module tests
- frontend: production build plus browser smoke/interaction checks

## Change Rules

1. Keep route modules free of SQL and filesystem policy.
2. Keep database helpers out of public module interfaces.
3. Add a seam only for real adapters.
4. Test orchestration through the deep module interface.
5. Update `CONTEXT.md` when domain terminology changes.
6. Record durable architecture choices in `docs/adr/`.
