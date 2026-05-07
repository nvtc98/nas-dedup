const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === '#recycle') continue;
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function md5(filePath) {
  const hash = crypto.createHash('md5');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

async function scan() {
  const { dir, perceptual } = workerData;
  const files = await walk(dir);
  const total = files.length;
  const hashMap = {};

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    try {
      const hash = md5(filePath);
      if (!hashMap[hash]) hashMap[hash] = [];
      hashMap[hash].push(filePath);
    } catch {
      // skip unreadable files
    }

    if ((i + 1) % 100 === 0 || i === files.length - 1) {
      parentPort.postMessage({ type: 'progress', count: i + 1, total });
    }
  }

  const groups = Object.values(hashMap)
    .filter(g => g.length > 1)
    .map((paths, idx) => {
      const stats = paths.map(p => {
        const s = fs.statSync(p);
        return { path: p, size: s.size, mtime: s.mtimeMs };
      });
      stats.sort((a, b) => b.mtime - a.mtime);
      return { id: idx + 1, files: stats };
    });

  parentPort.postMessage({ type: 'done', groups });
}

scan().catch(err => {
  parentPort.postMessage({ type: 'error', message: err.message });
});
