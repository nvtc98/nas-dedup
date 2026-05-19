const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKIP_DIRS = new Set(['#recycle', '@eaDir', '@Recently-Snapshot', '@sharebin', '.DS_Store', '@tmp']);

// controlBuf: Int32Array[0] — 0=running, 1=paused, 2=cancelled
const controlBuf = workerData.controlBuf ? new Int32Array(workerData.controlBuf) : null;

function getControl() {
  return controlBuf ? Atomics.load(controlBuf, 0) : 0;
}

async function waitIfPaused() {
  while (controlBuf && Atomics.load(controlBuf, 0) === 1) {
    await new Promise(r => setTimeout(r, 200));
  }
}

async function walk(dir, files = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (getControl() === 2) return files;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('@')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function md5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function scan() {
  const { dir } = workerData;
  const files = await walk(dir);
  if (getControl() === 2) {
    parentPort.postMessage({ type: 'cancelled' });
    return;
  }

  const total = files.length;
  const hashMap = {};

  for (let i = 0; i < files.length; i++) {
    await waitIfPaused();
    if (getControl() === 2) {
      parentPort.postMessage({ type: 'cancelled' });
      return;
    }

    const filePath = files[i];
    try {
      const hash = await md5(filePath);
      if (!hashMap[hash]) hashMap[hash] = [];
      hashMap[hash].push(filePath);
    } catch {
      // skip unreadable files
    }

    const isLast = i === files.length - 1;
    if ((i + 1) % 100 === 0 || (isLast && (i + 1) % 100 !== 0)) {
      parentPort.postMessage({ type: 'progress', count: i + 1, total });
    }
  }

  const groups = Object.values(hashMap)
    .filter(g => g.length > 1)
    .map((paths, idx) => {
      const stats = paths.map(p => {
        try {
          const s = fs.statSync(p);
          return { path: p, size: s.size, mtime: s.mtimeMs };
        } catch {
          return null;
        }
      }).filter(Boolean);
      stats.sort((a, b) => b.mtime - a.mtime);
      return { id: idx + 1, files: stats };
    })
    .filter(g => g.files.length > 1);

  parentPort.postMessage({ type: 'done', groups });
}

scan().catch(err => {
  parentPort.postMessage({ type: 'error', message: err.message });
});
