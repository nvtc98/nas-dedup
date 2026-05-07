const express = require('express');
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const username = os.userInfo().username;
const nasHome = `/volume1/homes/${username}`;
const homeDir = fs.existsSync(nasHome) ? nasHome : os.homedir();

let activeWorker = null;
let lastResults = null;
const sseClients = [];

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(msg);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

app.get('/api/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

app.post('/api/scan', (req, res) => {
  if (activeWorker) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  const { dir = `${homeDir}/Photos`, perceptual = false } = req.body;
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(homeDir + path.sep)) {
    return res.status(400).json({ error: 'Directory outside user home' });
  }

  lastResults = null;
  activeWorker = new Worker(path.join(__dirname, 'scanner.worker.js'), {
    workerData: { dir: resolved, perceptual }
  });

  activeWorker.on('message', (msg) => {
    if (msg.type === 'progress') {
      broadcast({ type: 'progress', count: msg.count, total: msg.total });
    } else if (msg.type === 'done') {
      lastResults = msg.groups;
      broadcast({ type: 'done' });
      activeWorker = null;
    } else if (msg.type === 'error') {
      broadcast({ type: 'error', message: msg.message });
      activeWorker = null;
    }
  });

  activeWorker.on('error', (err) => {
    broadcast({ type: 'error', message: err.message });
    activeWorker = null;
  });

  activeWorker.on('exit', (code) => {
    if (activeWorker !== null) {
      broadcast({ type: 'error', message: `Worker exited unexpectedly (code ${code})` });
      activeWorker = null;
    }
  });

  res.json({ ok: true });
});

app.get('/api/results', (req, res) => {
  if (!lastResults) return res.status(404).json({ error: 'No results yet' });
  res.json(lastResults);
});

app.post('/api/delete', (req, res) => {
  const { paths } = req.body;
  if (!Array.isArray(paths)) return res.status(400).json({ error: 'paths must be array' });

  const success = [];
  const failed = [];

  for (const filePath of paths) {
    if (typeof filePath !== 'string') {
      failed.push({ path: filePath, reason: 'Path must be a string' });
      continue;
    }
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(homeDir + path.sep)) {
      failed.push({ path: filePath, reason: 'Path not allowed' });
      continue;
    }

    const relative = path.relative(homeDir, resolved);
    const recyclePath = path.join(homeDir, '#recycle', relative);
    const recycleDir = path.dirname(recyclePath);

    try {
      fs.mkdirSync(recycleDir, { recursive: true });
      fs.renameSync(resolved, recyclePath);
      success.push(filePath);
    } catch (err) {
      failed.push({ path: filePath, reason: err.message });
    }
  }

  res.json({ success, failed });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NAS Dedup running at http://0.0.0.0:${PORT}`);
});
