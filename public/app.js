let allGroups = [];
let selectedPaths = new Set();

// --- Step navigation ---
function showStep(n) {
  [1, 2, 3].forEach(i => {
    document.getElementById(`step-${i}`).hidden = i !== n;
    const label = document.getElementById(`step-label-${i}`);
    label.className = 'step' + (i === n ? ' active' : i < n ? ' done' : '');
  });
}

// --- Step 1: Configure ---
document.getElementById('start-btn').addEventListener('click', async () => {
  const dir = document.getElementById('dir-input').value.trim();
  const perceptual = document.getElementById('perceptual-toggle').checked;

  // Open SSE connection BEFORE starting scan to avoid race condition
  showStep(2);
  const es = startSSE();

  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: dir || undefined, perceptual })
  });

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

// --- Step 3: Render results ---
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
    // sum all but the first (keep) file
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
  return allGroups.map(g => ({
    ...g,
    files: g.files.filter(f => getDir(f.path) === folder)
  })).filter(g => g.files.length > 1);
}

function renderResults() {
  // Summary
  const recoverable = totalSize(allGroups);
  document.getElementById('summary-text').textContent =
    `${allGroups.length} nhóm trùng · ${formatSize(recoverable)} có thể xóa`;

  // Folder filter
  const folderSelect = document.getElementById('folder-filter');
  folderSelect.innerHTML = '<option value="">Tất cả thư mục</option>';
  getFolders(allGroups).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
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

      const isKeep = fi === 0; // newest mtime = keep

      const td0 = document.createElement('td');
      if (!isKeep) {
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
      } else {
        td0.textContent = '✓';
        td0.style.color = '#16a34a';
        td0.title = 'Giữ lại (mới nhất)';
      }

      const td1 = document.createElement('td');
      td1.textContent = file.path;

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
  btn.textContent = `🗑 Xóa đã chọn (${selectedPaths.size})`;
  btn.disabled = selectedPaths.size === 0;
}

// Select all in folder
document.getElementById('select-folder-all').addEventListener('change', (e) => {
  const folder = document.getElementById('folder-filter').value;
  const groups = getFilteredGroups();
  groups.forEach(g => {
    g.files.slice(1).forEach(f => {
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
    g.files.slice(1).forEach(f => {
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

// Delete
document.getElementById('delete-btn').addEventListener('click', async () => {
  if (!confirm(`Xóa ${selectedPaths.size} file vào Recycle Bin?`)) return;

  const paths = [...selectedPaths];
  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths })
  });
  const result = await res.json();

  // Remove successfully deleted from allGroups
  const deletedSet = new Set(result.success);
  allGroups = allGroups.map(g => ({
    ...g,
    files: g.files.filter(f => !deletedSet.has(f.path))
  })).filter(g => g.files.length > 1);

  selectedPaths.clear();
  document.getElementById('select-all').checked = false;
  document.getElementById('select-folder-all').checked = false;
  renderResults();

  // Show result message
  const resultDiv = document.getElementById('delete-result');
  resultDiv.hidden = false;
  resultDiv.className = result.failed.length > 0 ? 'has-errors' : '';
  resultDiv.textContent = `Đã xóa ${result.success.length} file.` +
    (result.failed.length > 0 ? ` Thất bại: ${result.failed.map(f => f.path).join(', ')}` : '');
});

// Init
showStep(1);
