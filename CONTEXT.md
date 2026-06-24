# Domain Context

This file defines the domain language used in code, tests, architecture
documentation, and future refactors.

## Archive

The durable collection of acquired media. An Archive consists of catalog rows
in SQLite and media files beneath `DOWNLOADS_DIR`. These two representations
must agree.

## Archive Item

One cataloged post or generic media result. An Archive Item has a stable ID,
source, media type, original URL, stored path, optional thumbnail, and
acquisition metadata.

## Archive Catalog

The module that owns the invariant between Archive Item rows and files. It
searches items, resolves media, validates download paths, reports storage,
finds orphan files, and performs catalog maintenance.

## Acquisition

The process of discovering or downloading remote media. Acquisition uses
external adapters for `yt-dlp`, `gallery-dl`, direct HTTP, and `ffmpeg`.

## Download Job

A durable request for Acquisition. A Download Job is one of:

- `channel`: scan a Monitored Profile and create post jobs.
- `post`: acquire one media URL with automatic tool selection.
- `gallery-dl`: acquire one URL explicitly through the gallery adapter.

## Download Queue

The module that owns Download Job lifecycle, persistence orchestration,
progress, cancellation, retry policy, wake-up scheduling, and dispatch to
Acquisition.

## Monitored Profile

A TikTok profile selected for recurring scans. Its active state is represented
in both `data/channels.txt` and the SQLite `channels` table.

## Profile Reconciliation

The policy that keeps `channels.txt` and SQLite synchronized. The text file
supports operator edits; SQLite supports queries, history, and the web UI.

## Monitor

The timing behavior inside the Monitored Profiles module. It periodically
requests `channel` Download Jobs for active profiles.

## Presentation Module

A frontend module that owns markup, behavior, responsive rules, and visual
states for one user-facing concept. The App Shell, Archive Filters, and Archive
Viewer are presentation modules.
