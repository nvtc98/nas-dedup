const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const username = os.userInfo().username;
const nasHome = `/volume1/homes/${username}`;
const homeDir = fs.existsSync(nasHome) ? nasHome : os.homedir();

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));

const scanDir = args[0] || path.join(homeDir, 'Photos');
const outputFile = args[1] || path.join(homeDir, 'nas-dedup-report.html');
const noFilter = flags.includes('--no-filter');

// Synology system directories to skip by default
const SKIP_DIRS = new Set(['#recycle', '@eaDir', '@Recently-Snapshot', '.SynologyWorkingDirectory']);

async function walk(dir, files = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (!noFilter && SKIP_DIRS.has(entry.name)) continue;
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
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function formatSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString('vi-VN');
}

function generateHtml(groups, scanDir, duration) {
  const totalRecoverable = groups.reduce((sum, g) =>
    sum + g.files.slice(1).reduce((s, f) => s + f.size, 0), 0);

  const displayPath = p => p.startsWith(homeDir) ? '~/' + p.slice(homeDir.length + 1) : p;

  const rows = groups.map(g => {
    return g.files.map((f, fi) => {
      const isKeep = fi === 0;
      const rowClass = isKeep ? 'keep' : 'dup';
      const groupClass = g.id % 2 === 0 ? 'group-even' : 'group-odd';
      return `<tr class="${rowClass} ${groupClass}">
        <td>${isKeep ? '✓' : ''}</td>
        <td>${displayPath(f.path)}</td>
        <td>#${g.id}</td>
        <td>${formatSize(f.size)}</td>
        <td>${formatDate(f.mtime)}</td>
      </tr>`;
    }).join('');
  }).join('');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NAS Dedup Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #222; padding: 24px; }
    h1 { font-size: 1.3rem; margin-bottom: 8px; }
    .meta { font-size: 0.85rem; color: #666; margin-bottom: 20px; }
    .summary { background: #e8f5e9; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; font-size: 0.85rem; }
    th { background: #f0f0f0; padding: 8px 10px; text-align: left; border-bottom: 2px solid #ddd; }
    td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; }
    tr.group-even { background: #fafafa; }
    tr.group-odd { background: #f0f4ff; }
    tr.dup td:nth-child(2) { color: #dc2626; }
    tr.keep td:first-child { color: #16a34a; font-weight: bold; }
    .note { margin-top: 16px; font-size: 0.8rem; color: #888; }
  </style>
</head>
<body>
  <h1>NAS Duplicate Report</h1>
  <div class="meta">Scanned: ${displayPath(scanDir)} · Generated: ${new Date().toLocaleString('vi-VN')} · Duration: ${duration}s</div>
  <div class="summary">
    <strong>${groups.length} nhóm trùng</strong> · ${formatSize(totalRecoverable)} có thể xóa
  </div>
  <table>
    <thead>
      <tr>
        <th>Giữ</th>
        <th>File</th>
        <th>Nhóm</th>
        <th>Kích thước</th>
        <th>Ngày sửa</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">✓ = file được đề xuất giữ lại (mới nhất trong nhóm). Các file màu đỏ là bản trùng có thể xóa.</p>
</body>
</html>`;
}

async function main() {
  console.log(`Scanning: ${scanDir}`);
  const start = Date.now();

  const files = await walk(scanDir);
  console.log(`Found ${files.length} files, hashing...`);

  const hashMap = {};
  for (let i = 0; i < files.length; i++) {
    try {
      const hash = await md5(files[i]);
      if (!hashMap[hash]) hashMap[hash] = [];
      hashMap[hash].push(files[i]);
    } catch {
      // skip unreadable
    }
    if ((i + 1) % 500 === 0) process.stdout.write(`\r${i + 1}/${files.length}`);
  }
  console.log(`\rHashing done.`);

  const groups = Object.values(hashMap)
    .filter(g => g.length > 1)
    .map((paths, idx) => {
      const stats = paths.map(p => {
        try {
          const s = fs.statSync(p);
          return { path: p, size: s.size, mtime: s.mtimeMs };
        } catch { return null; }
      }).filter(Boolean);
      stats.sort((a, b) => b.mtime - a.mtime);
      return { id: idx + 1, files: stats };
    })
    .filter(g => g.files.length > 1);

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Found ${groups.length} duplicate groups in ${duration}s`);

  const html = generateHtml(groups, scanDir, duration);
  fs.writeFileSync(outputFile, html, 'utf8');
  console.log(`Report saved: ${outputFile}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
