# NAS Dedup

Duplicate file checker for Synology NAS.

## Requirements

- Synology DSM 7.x
- Node.js v20 (install from Package Center)
- Recycle Bin enabled on the shared folder (DSM → Control Panel → Shared Folder → Edit → Enable Recycle Bin)

## Install

SSH into your NAS:

```bash
cd /volume1/homes/<your-username>
git clone <repo-url> nas-dedup
cd nas-dedup
npm install
```

## Run

```bash
node server.js
```

Then open `http://<nas-ip>:8080` in your browser.

To keep running after SSH disconnect:

```bash
nohup node server.js > app.log 2>&1 &
```

To stop: find the process with `ps aux | grep server.js` and kill it.

## Notes

- Files are moved to `#recycle` (Synology Recycle Bin), not permanently deleted.
- Only scans files within your user home directory (`/volume1/homes/<username>`).
- Default scan directory: `/volume1/homes/<username>/Photos`.
