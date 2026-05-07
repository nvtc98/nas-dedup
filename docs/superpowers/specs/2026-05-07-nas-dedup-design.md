# NAS Duplicate File Checker — Design Spec

## Overview

A Node.js web app that scans a Synology NAS for duplicate files and images, presents results in a browser-based UI, and moves selected duplicates to the DSM Recycle Bin. Runs on-demand (user-initiated), not on a schedule.

## Architecture

```
nas-dedup/
├── server.js              # Express server + Worker Thread orchestration
├── scanner.worker.js      # Scan engine (hashing, dedup grouping)
├── public/
│   ├── index.html         # Wizard UI (3 steps)
│   ├── app.js             # Frontend logic (vanilla JS)
│   └── style.css
└── package.json
```

**Runtime:** Node.js v20 (pre-installed on DSM 7.3)
**Dependencies:** `express`, `sharp` (optional, for perceptual hash)

The server runs as the current DSM user. All file operations are scoped to that user's home directory (`/volume1/homes/<username>`).

## Components

### server.js

- Serves static files from `public/`
- Manages a single active scan at a time (rejects concurrent scan requests)
- Spawns `scanner.worker.js` as a Worker Thread when scan starts
- Relays worker progress/results via SSE to the browser
- Handles file move-to-recycle operations

### scanner.worker.js

Runs in a Worker Thread — does not block the main thread.

1. Recursively walks the target directory
2. For each file: compute MD5 hash (default) or perceptual hash if enabled
3. Groups files by identical hash
4. Filters out groups with only 1 member (no duplicates)
5. Posts progress every 100 files, posts final results when done

**Perceptual hash:** Uses `sharp` to resize image to 8x8 grayscale, computes average hash. Only applied to image files (`.jpg`, `.jpeg`, `.png`, `.heic`, `.webp`). Non-image files always use MD5.

### public/app.js

Wizard with 3 steps:

**Step 1 — Configure:**
- Directory input (default: `/volume1/homes/<username>/Photos`)
- Toggle: "Also check visually similar images (perceptual hash)" — off by default
- Start Scan button

**Step 2 — Scanning:**
- Progress bar + file count
- Connects to SSE endpoint, updates UI on each progress event
- Auto-advances to Step 3 on `done` event

**Step 3 — Review:**
- Summary bar: total groups, total recoverable size, Delete Selected button
- Toolbar: folder filter dropdown + "Select all in this folder" checkbox
- Flat table: checkbox | file path | group # | size | date modified
- Rows grouped visually by alternating background color per group
- File with the newest modification date in each group is auto-marked as "keep" (not pre-checked for deletion) — this is a suggestion only, user can override by checking/unchecking any row

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scan` | Start scan. Body: `{ dir, perceptual }`. Returns `{ scanId }`. Rejects if scan already running. |
| GET | `/api/progress` | SSE stream. Events: `progress` (count, total), `done` (results), `error` (message) |
| GET | `/api/results` | Returns last scan results as JSON |
| POST | `/api/delete` | Body: `{ paths: string[] }`. Moves files to recycle bin. Returns `{ success, failed }` |

## Recycle Bin Behavior

Files are moved (not deleted) to the shared folder's `#recycle` directory:

```
/volume1/homes/user/Photos/Backup/IMG_4521.jpg
→ /volume1/homes/user/#recycle/Photos/Backup/IMG_4521.jpg
```

- Intermediate directories inside `#recycle` are created if they don't exist
- If `#recycle` doesn't exist at the shared folder root, it is created automatically
- DSM displays recycled files in File Station's Recycle Bin if the shared folder has Recycle Bin enabled in DSM Control Panel → Shared Folder settings (recommended to enable before use)
- Files already in `#recycle` are skipped from scan results

## Security

- All paths in `/api/delete` are validated: must be absolute, must resolve within the user's home directory (`/volume1/homes/<username>`), no `..` traversal allowed
- Server binds to `0.0.0.0` on a configurable port (default `8080`) — accessible on local network only (no auth, intended for personal NAS use)
- Scan is scoped to the directory specified in the request, which must also be within the user's home directory

## Error Handling

- **Scan error mid-way** (permission denied, I/O error): worker posts `error` event via SSE, UI shows error message with retry button. Partial results are discarded.
- **Delete partial failure**: server attempts all deletions, returns `{ success: [...], failed: [...] }`. UI shows which files failed without blocking the rest.
- **Concurrent scan attempt**: POST `/api/scan` returns HTTP 409 with message "Scan already in progress".
- **No results yet**: GET `/api/results` returns HTTP 404 if no scan has completed.

## Running on DSM

Start manually via SSH:
```bash
cd /volume1/homes/<username>/nas-dedup
node server.js
```

Then open `http://<nas-ip>:8080` in a browser on the local network.

To run in background across SSH sessions:
```bash
nohup node server.js > app.log 2>&1 &
```

To stop: find the PID via `ps aux | grep server.js` and kill it, or use DSM Task Scheduler to manage the process.

## Future Considerations (out of scope for v1)

- Multi-user scan (scan across all users' home directories)
- Persistent scan cache (SQLite) to skip unchanged files on re-scan
- Switchable result layout (accordion vs flat table)
- DSM Task Scheduler integration for scheduled scans
