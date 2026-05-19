let allGroups = [];
let selectedPaths = new Set();
let homeDir = '';

// --- Auth check ---
async function initAuth() {
  const res = await fetch('/api/me');
  if (res.status === 401) {
    location.href = '/login.html';
    return false;
  }
  const data = await res.json();
  homeDir = data.home;
  document.getElementById('username-display').textContent = data.username;
  return true;
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login.html';
});

// --- Folder browser ---
let browserCurrentPath = '';

async function browserLoad(dirPath) {
  const res = await fetch('/api/ls?path=' + encodeURIComponent(dirPath));
  if (res.status === 401) { location.href = '/login.html'; return; }
  const data = await res.json();
  if (data.error) return;

  browserCurrentPath = data.path;
  document.getElementById('browser-path').textContent = displayPath(data.path);

  const list = document.getElementById('browser-list');
  list.innerHTML = '';

  // Up button
  const parentPath = data.path.split('/').slice(0, -1).join('/') || '/';
  if (data.path !== '/') {
    const up = document.createElement('div');
    up.className = 'browser-item';
    up.innerHTML = '<i class="ph ph-arrow-up"></i> ..';
    up.addEventListener('click', () => browserLoad(parentPath));
    list.appendChild(up);
  }

  data.dirs.forEach(d => {
    const item = document.createElement('div');
    item.className = 'browser-item';
    item.innerHTML = `<i class="ph ph-folder"></i> ${d.name}`;
    item.addEventListener('click', () => browserLoad(d.path));
    list.appendChild(item);
  });

  if (data.dirs.length === 0 && data.path === '/') {
    list.innerHTML = '<div style="padding:10px;color:#888;font-size:0.85rem">Không có thư mục con</div>';
  }
}

document.getElementById('browse-btn').addEventListener('click', async () => {
  const browser = document.getElementById('folder-browser');
  if (!browser.hidden) { browser.hidden = true; return; }
  browser.hidden = false;
  const current = document.getElementById('dir-input').value.trim() || '~';
  await browserLoad(current);
});

document.getElementById('browser-select-btn').addEventListener('click', () => {
  document.getElementById('dir-input').value = displayPath(browserCurrentPath);
  document.getElementById('folder-browser').hidden = true;
});

document.getElementById('browser-cancel-btn').addEventListener('click', () => {
  document.getElementById('folder-browser').hidden = true;
});

let isPaused = false;

document.getElementById('pause-btn').addEventListener('click', async () => {
  const btn = document.getElementById('pause-btn');
  if (!isPaused) {
    await fetch('/api/scan/pause', { method: 'POST' });
    isPaused = true;
    btn.innerHTML = '<i class="ph ph-play"></i> Tiếp tục';
    btn.style.background = '#16a34a';
    document.getElementById('progress-text').textContent += ' (đã tạm dừng)';
  } else {
    await fetch('/api/scan/resume', { method: 'POST' });
    isPaused = false;
    btn.innerHTML = '<i class="ph ph-pause"></i> Tạm dừng';
    btn.style.background = '#f59e0b';
  }
});

document.getElementById('cancel-btn').addEventListener('click', async () => {
  if (!confirm('Hủy scan? Kết quả đã scan được sẽ mất.')) return;
  await fetch('/api/scan/cancel', { method: 'POST' });
});

// --- Step navigation ---
function showStep(n) {
  [1, 2, 3].forEach(i => {
    document.getElementById(`step-${i}`).hidden = i !== n;
    const label = document.getElementById(`step-label-${i}`);
    label.className = 'step' + (i === n ? ' active' : i < n ? ' done' : '');
  });
}

// Click step-1 label when on step 3 to restart
document.getElementById('step-label-1').addEventListener('click', () => {
  const step3 = document.getElementById('step-3');
  if (!step3.hidden) {
    allGroups = [];
    selectedPaths.clear();
    showStep(1);
  }
});

// --- Step 1: Configure ---
document.getElementById('start-btn').addEventListener('click', async () => {
  const dir = document.getElementById('dir-input').value.trim();
  const perceptual = document.getElementById('perceptual-toggle').checked;

  showStep(2);
  isPaused = false;
  document.getElementById('pause-btn').innerHTML = '<i class="ph ph-pause"></i> Tạm dừng';
  document.getElementById('pause-btn').style.background = '#f59e0b';
  const es = startSSE();

  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: dir || undefined, perceptual })
  });

  if (res.status === 401) { location.href = '/login.html'; return; }
  if (res.status === 409) {
    es.close();
    showStep(1);
    alert('Scan đang chạy, vui lòng chờ.');
    return;
  }
  if (!res.ok) {
    es.close();
    showStep(1);
    const err = await res.json();
    alert('Lỗi: ' + err.error);
    return;
  }
});

// --- Step 2: SSE progress ---
function startSSE() {
  const es = new EventSource('/api/progress');
  const bar = document.getElementById('progress-bar');
  const text = document.getElementById('progress-text');

  es.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'progress') {
      bar.max = msg.total;
      bar.value = msg.count;
      text.textContent = `Đang scan... ${msg.count} / ${msg.total} files`;
    } else if (msg.type === 'done') {
      es.close();
      try {
        const data = await fetch('/api/results').then(r => r.json());
        allGroups = data;
        renderResults();
        showStep(3);
      } catch {
        text.textContent = 'Lỗi khi tải kết quả.';
        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'Thử lại';
        retryBtn.style.marginTop = '12px';
        retryBtn.onclick = async () => {
          try {
            const data = await fetch('/api/results').then(r => r.json());
            allGroups = data;
            renderResults();
            showStep(3);
          } catch {
            text.textContent = 'Không thể tải kết quả. Vui lòng restart server.';
          }
        };
        document.getElementById('step-2').appendChild(retryBtn);
      }
    } else if (msg.type === 'cancelled') {
      es.close();
      isPaused = false;
      document.getElementById('pause-btn').innerHTML = '<i class="ph ph-pause"></i> Tạm dừng';
      document.getElementById('pause-btn').style.background = '#f59e0b';
      allGroups = [];
      selectedPaths.clear();
      showStep(1);
    } else if (msg.type === 'error') {
      es.close();
      text.textContent = 'Lỗi: ' + msg.message;
      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Thử lại';
      retryBtn.style.marginTop = '12px';
      retryBtn.onclick = () => showStep(1);
      document.getElementById('step-2').appendChild(retryBtn);
    }
  };

  return es;
}

// --- Image preview ---
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic']);

function isImage(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function openPreview(filePath) {
  const modal = document.getElementById('preview-modal');
  const img = document.getElementById('preview-img');
  const name = document.getElementById('preview-name');
  img.src = '/api/preview?path=' + encodeURIComponent(filePath);
  name.textContent = displayPath(filePath);
  modal.hidden = false;
}

function closePreview() {
  const modal = document.getElementById('preview-modal');
  modal.hidden = true;
  document.getElementById('preview-img').src = '';
}

document.getElementById('preview-close').addEventListener('click', closePreview);
document.getElementById('preview-backdrop').addEventListener('click', closePreview);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });

// --- Step 3: Render results ---
function displayPath(p) {
  if (homeDir && p.startsWith(homeDir)) return '~' + p.slice(homeDir.length);
  return p;
}

function getDir(p) {
  return p.substring(0, p.lastIndexOf('/'));
}

function getFolders(groups) {
  const folders = new Set();
  groups.forEach(g => g.files.forEach(f => folders.add(getDir(f.path))));
  return [...folders].sort();
}

function totalSize(groups) {
  let bytes = 0;
  groups.forEach(g => {
    g.files.slice(1).forEach(f => { bytes += f.size; });
  });
  return bytes;
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

function getFilteredGroups() {
  const folder = document.getElementById('folder-filter').value;
  if (!folder) return allGroups;
  return allGroups.filter(g => g.files.some(f => getDir(f.path) === folder));
}

function renderResults() {
  const recoverable = totalSize(allGroups);
  document.getElementById('summary-text').textContent =
    `${allGroups.length} nhóm trùng · ${formatSize(recoverable)} có thể xóa`;

  const folderSelect = document.getElementById('folder-filter');
  folderSelect.innerHTML = '<option value="">Tất cả thư mục</option>';
  getFolders(allGroups).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = displayPath(f);
    folderSelect.appendChild(opt);
  });

  renderTable();
}

function renderTable() {
  const groups = getFilteredGroups();
  const tbody = document.getElementById('results-body');
  tbody.innerHTML = '';

  groups.forEach((group, gi) => {
    group.files.forEach((file, fi) => {
      const tr = document.createElement('tr');
      tr.className = gi % 2 === 0 ? 'group-even' : 'group-odd';
      if (selectedPaths.has(file.path)) tr.classList.add('marked-delete');

      const isKeep = fi === 0;

      const td0 = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedPaths.has(file.path);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedPaths.add(file.path);
        else selectedPaths.delete(file.path);
        tr.classList.toggle('marked-delete', cb.checked);
        updateDeleteBtn();
      });
      td0.appendChild(cb);

      const td1 = document.createElement('td');
      if (isImage(file.path)) {
        const link = document.createElement('span');
        link.className = 'preview-link';
        link.textContent = displayPath(file.path);
        link.addEventListener('click', () => openPreview(file.path));
        td1.appendChild(link);
      } else {
        td1.textContent = displayPath(file.path);
      }

      const td2 = document.createElement('td');
      td2.textContent = '#' + group.id;
      td2.style.color = '#4f46e5';

      const td3 = document.createElement('td');
      td3.textContent = formatSize(file.size);

      const td4 = document.createElement('td');
      td4.textContent = formatDate(file.mtime);
      td4.style.color = '#888';

      tr.append(td0, td1, td2, td3, td4);
      tbody.appendChild(tr);
    });
  });

  updateDeleteBtn();
}

function updateDeleteBtn() {
  const btn = document.getElementById('delete-btn');
  btn.innerHTML = `<i class="ph ph-trash"></i> Xóa đã chọn (${selectedPaths.size})`;
  btn.disabled = selectedPaths.size === 0;
}

// Select all in folder
document.getElementById('select-folder-all').addEventListener('change', (e) => {
  const folder = document.getElementById('folder-filter').value;
  const groups = getFilteredGroups();
  groups.forEach(g => {
    g.files.forEach(f => {
      const dir = getDir(f.path);
      if (!folder || dir === folder) {
        if (e.target.checked) selectedPaths.add(f.path);
        else selectedPaths.delete(f.path);
      }
    });
  });
  renderTable();
});

// Select all (header checkbox)
document.getElementById('select-all').addEventListener('change', (e) => {
  const groups = getFilteredGroups();
  groups.forEach(g => {
    g.files.forEach(f => {
      if (e.target.checked) selectedPaths.add(f.path);
      else selectedPaths.delete(f.path);
    });
  });
  renderTable();
});

// Folder filter change
document.getElementById('folder-filter').addEventListener('change', () => {
  document.getElementById('select-folder-all').checked = false;
  renderTable();
});

// Custom confirm dialog
function showConfirm({ title, body, warning, onOk }) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').textContent = body;
  const warnEl = document.getElementById('confirm-warning');
  if (warning) {
    warnEl.textContent = warning;
    warnEl.hidden = false;
  } else {
    warnEl.hidden = true;
  }
  modal.hidden = false;

  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const backdrop = document.getElementById('confirm-backdrop');

  function close() {
    modal.hidden = true;
    okBtn.replaceWith(okBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    backdrop.replaceWith(backdrop.cloneNode(true));
    // re-bind cancel/backdrop after clone
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => document.getElementById('confirm-modal').hidden = true);
    document.getElementById('confirm-backdrop').addEventListener('click', () => document.getElementById('confirm-modal').hidden = true);
  }

  document.getElementById('confirm-ok-btn').addEventListener('click', () => { close(); onOk(); });
}

document.getElementById('confirm-cancel-btn').addEventListener('click', () => { document.getElementById('confirm-modal').hidden = true; });
document.getElementById('confirm-backdrop').addEventListener('click', () => { document.getElementById('confirm-modal').hidden = true; });

// Delete
document.getElementById('delete-btn').addEventListener('click', () => {
  const paths = [...selectedPaths];

  // Detect groups that would be fully deleted
  const fullyDeletedGroups = allGroups.filter(g =>
    g.files.every(f => selectedPaths.has(f.path))
  );

  const warning = fullyDeletedGroups.length > 0
    ? `⚠ ${fullyDeletedGroups.length} nhóm sẽ bị xóa toàn bộ — không còn bản nào được giữ lại (nhóm: ${fullyDeletedGroups.map(g => '#' + g.id).join(', ')})`
    : null;

  showConfirm({
    title: 'Xác nhận xóa',
    body: `Chuyển ${paths.length} file vào Recycle Bin?`,
    warning,
    onOk: async () => {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths })
      });
      if (res.status === 401) { location.href = '/login.html'; return; }
      const result = await res.json();

      const deletedSet = new Set(result.success);
      allGroups = allGroups.map(g => ({
        ...g,
        files: g.files.filter(f => !deletedSet.has(f.path))
      })).filter(g => g.files.length > 0);

      selectedPaths.clear();
      document.getElementById('select-all').checked = false;
      document.getElementById('select-folder-all').checked = false;
      renderResults();

      const resultDiv = document.getElementById('delete-result');
      resultDiv.hidden = false;
      resultDiv.className = result.failed.length > 0 ? 'has-errors' : '';
      resultDiv.textContent = `Đã xóa ${result.success.length} file.` +
        (result.failed.length > 0 ? ` Thất bại: ${result.failed.map(f => f.path).join(', ')}` : '');
    }
  });
});
});

document.getElementById('rescan-btn').addEventListener('click', () => {
  allGroups = [];
  selectedPaths.clear();
  showStep(1);
});

// Init
initAuth().then(ok => { if (ok) showStep(1); });
