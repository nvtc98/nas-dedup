# nas-dedup

Duplicate file checker for Synology NAS. Scan a directory, identify duplicate files by MD5 hash, and either review results in a web UI or export an HTML report.

## Requirements

- Synology DSM 7.x
- Node.js v20 (install from Package Center)

## Install

Upload the following files to `/volume1/Shared/nas-dedup/` via File Station (do not upload `node_modules`):

```
scan.js
server.js
scanner.worker.js
package.json
package-lock.json
public/
```

Then install dependencies. Run once via Task Scheduler or SSH:

```bash
cd /volume1/Shared/nas-dedup && npm install
```

## Option 1 — Standalone scan (no SSH required)

Scans a directory and writes an HTML report. Suitable when SSH is unavailable.

**Run via DSM Task Scheduler:**

Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script

```bash
node /volume1/Shared/nas-dedup/scan.js
```

Default scan directory: `~/Photos`
Default output: `~/nas-dedup-report.html`

Open the report in File Station to review duplicates. Delete files manually.

**Custom paths:**

```bash
node /volume1/Shared/nas-dedup/scan.js ~/Photos ~/report.html
```

**Include Synology system directories** (e.g. `@eaDir` thumbnails — excluded by default):

```bash
node /volume1/Shared/nas-dedup/scan.js ~/Photos ~/report.html --no-filter
```

## Option 2 — Web UI (requires SSH or LAN access)

Runs an Express server with an interactive 3-step wizard: configure → scan → review and delete.

**Requires:** Recycle Bin enabled on the shared folder (DSM → Control Panel → Shared Folder → Edit → Enable Recycle Bin)

```bash
node /volume1/Shared/nas-dedup/server.js
```

Open `http://<nas-ip>:8080` in your browser.

Run in background after closing SSH:

```bash
nohup node /volume1/Shared/nas-dedup/server.js > /volume1/Shared/nas-dedup/app.log 2>&1 &
```

Stop: `ps aux | grep server.js` then `kill <PID>`

Custom port:

```bash
PORT=5003 nohup node /volume1/Shared/nas-dedup/server.js > app.log 2>&1 &
```

## Notes

- Files are moved to `#recycle` (Synology Recycle Bin), not permanently deleted.
- Synology system directories (`@eaDir`, `#recycle`, `@Recently-Snapshot`) are excluded from scans by default.
- Only scans within the running user's home directory (`/volume1/homes/<username>`).
- Default scan directory: `~/Photos`.
