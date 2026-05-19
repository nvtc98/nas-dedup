const express = require("express");
const path = require("path");
const { Worker } = require("worker_threads");
const os = require("os");
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const session = require("express-session");

const app = express();
app.use(express.json());
app.use(
  session({
    secret:
      process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
  }),
);
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 5003;

// Per-session scan state
const sessionStates = new Map();

function getState(sid) {
  if (!sessionStates.has(sid)) {
    sessionStates.set(sid, { worker: null, results: null, clients: [], controlBuf: null });
  }
  return sessionStates.get(sid);
}

function broadcast(sid, data) {
  const state = sessionStates.get(sid);
  if (!state) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (let i = state.clients.length - 1; i >= 0; i--) {
    try {
      state.clients[i].write(msg);
    } catch {
      state.clients.splice(i, 1);
    }
  }
}

function requireAuth(req, res, next) {
  if (!req.session.username)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Thiếu thông tin đăng nhập" });

  // Xác thực qua WebDAV (port 5006) bằng PROPFIND + Basic Auth
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  const webdavReq = https.request(
    {
      hostname: "localhost",
      port: 5006,
      path: "/home/",
      method: "PROPFIND",
      rejectUnauthorized: false,
      headers: {
        Authorization: `Basic ${auth}`,
        Depth: "0",
        "Content-Type": "application/xml",
      },
    },
    (webdavRes) => {
      // WebDAV trả 207 Multi-Status = xác thực thành công
      // 401 = sai credentials, 403 = không có quyền
      webdavRes.resume(); // drain response body

      if (webdavRes.statusCode === 207 || webdavRes.statusCode === 200) {
        const homeDir = `/volume1/homes/${username}`;
        req.session.username = username;
        req.session.homeDir = homeDir;
        res.json({ ok: true, username });
      } else if (webdavRes.statusCode === 401) {
        res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
      } else {
        res
          .status(401)
          .json({ error: `WebDAV trả về status ${webdavRes.statusCode}` });
      }
    },
  );

  webdavReq.on("error", () =>
    res.status(500).json({ error: "Không kết nối được WebDAV (port 5006)" }),
  );
  webdavReq.end();
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (!req.session.username)
    return res.status(401).json({ error: "Unauthorized" });
  res.json({ username: req.session.username, home: req.session.homeDir });
});

app.get("/api/ls", requireAuth, (req, res) => {
  const homeDir = req.session.homeDir;
  const rawPath = req.query.path || homeDir;
  const resolved = path.resolve(rawPath.replace(/^~/, homeDir));
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('@') && e.name !== '#recycle')
      .map(e => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ path: resolved, dirs });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/home", requireAuth, (req, res) => {
  res.json({ home: req.session.homeDir });
});

app.get("/api/progress", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const state = getState(req.session.id);
  state.clients.push(res);
  req.on("close", () => {
    const idx = state.clients.indexOf(res);
    if (idx !== -1) state.clients.splice(idx, 1);
  });
});

app.post("/api/scan", requireAuth, (req, res) => {
  const sid = req.session.id;
  const homeDir = req.session.homeDir;
  const state = getState(sid);

  if (state.worker)
    return res.status(409).json({ error: "Scan đang chạy, vui lòng chờ" });

  const { dir: rawDir, perceptual = false } = req.body;
  const dirInput = rawDir === undefined || rawDir === null ? `${homeDir}/Photos` : rawDir;
  const dir = dirInput.replace(/^~/, homeDir);
  if (typeof dir !== "string")
    return res.status(400).json({ error: "dir phải là string" });

  const resolved = path.resolve(dir);

  state.results = null;
  const controlBuf = new SharedArrayBuffer(4);
  state.controlBuf = new Int32Array(controlBuf);
  Atomics.store(state.controlBuf, 0, 0);

  state.worker = new Worker(path.join(__dirname, "scanner.worker.js"), {
    workerData: { dir: resolved, perceptual, controlBuf },
  });

  state.worker.on("message", (msg) => {
    if (msg.type === "progress") {
      broadcast(sid, { type: "progress", count: msg.count, total: msg.total });
    } else if (msg.type === "done") {
      state.results = msg.groups;
      state.controlBuf = null;
      broadcast(sid, { type: "done" });
      state.worker = null;
    } else if (msg.type === "cancelled") {
      state.controlBuf = null;
      broadcast(sid, { type: "cancelled" });
      state.worker = null;
    } else if (msg.type === "error") {
      state.controlBuf = null;
      broadcast(sid, { type: "error", message: msg.message });
      state.worker = null;
    }
  });

  state.worker.on("error", (err) => {
    state.controlBuf = null;
    broadcast(sid, { type: "error", message: err.message });
    state.worker = null;
  });

  state.worker.on("exit", (code) => {
    if (state.worker !== null) {
      broadcast(sid, {
        type: "error",
        message: `Worker thoát bất ngờ (code ${code})`,
      });
      state.worker = null;
    }
  });

  res.json({ ok: true });
});

app.post("/api/scan/pause", requireAuth, (req, res) => {
  const state = getState(req.session.id);
  if (!state.controlBuf) return res.status(400).json({ error: "Không có scan đang chạy" });
  Atomics.store(state.controlBuf, 0, 1);
  res.json({ ok: true });
});

app.post("/api/scan/resume", requireAuth, (req, res) => {
  const state = getState(req.session.id);
  if (!state.controlBuf) return res.status(400).json({ error: "Không có scan đang chạy" });
  Atomics.store(state.controlBuf, 0, 0);
  res.json({ ok: true });
});

app.post("/api/scan/cancel", requireAuth, (req, res) => {
  const state = getState(req.session.id);
  if (!state.controlBuf) return res.status(400).json({ error: "Không có scan đang chạy" });
  Atomics.store(state.controlBuf, 0, 2);
  res.json({ ok: true });
});

app.get("/api/results", requireAuth, (req, res) => {
  const state = getState(req.session.id);
  if (!state.results) return res.status(404).json({ error: "Chưa có kết quả" });
  res.json(state.results);
});

app.get("/api/preview", requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath || typeof filePath !== "string")
    return res.status(400).json({ error: "Thiếu path" });

  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".heic": "image/heic" };
  if (!mime[ext]) return res.status(400).json({ error: "Không phải file ảnh" });

  try {
    const stat = fs.statSync(resolved);
    res.setHeader("Content-Type", mime[ext]);
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(resolved).pipe(res);
  } catch {
    res.status(404).json({ error: "Không tìm thấy file" });
  }
});

app.post("/api/delete", requireAuth, (req, res) => {
  const homeDir = req.session.homeDir;
  const { paths } = req.body;
  if (!Array.isArray(paths))
    return res.status(400).json({ error: "paths phải là array" });

  const success = [];
  const failed = [];

  for (const filePath of paths) {
    if (typeof filePath !== "string") {
      failed.push({ path: filePath, reason: "Path phải là string" });
      continue;
    }
    const resolved = path.resolve(filePath);

    // Đưa vào #recycle của shared folder chứa file đó
    const parts = resolved.split(path.sep);
    // /volume1/homes/user/... → recycleRoot = /volume1/homes/user
    // /volume1/Photos/... → recycleRoot = /volume1/Photos
    const recycleRoot =
      parts.length >= 4
        ? path.sep + path.join(parts[1], parts[2], parts[3])
        : path.dirname(resolved);
    const relative = path.relative(recycleRoot, resolved);
    const recyclePath = path.join(recycleRoot, "#recycle", relative);
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NAS Dedup running at http://0.0.0.0:${PORT}`);
});
