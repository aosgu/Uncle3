// settings.js —— Uncle3 设置页逻辑
// 依赖 core.js（normalizePresets / isLockedPreset），通过 manifest options_page 在新标签页打开。

const $ = id => document.getElementById(id);

let presets = [];
let editingIndex = -1;
let dragFrom = -1;

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function persistPresets() {
  await chrome.storage.local.set({ presets });
}

function saveFpsPref() {
  chrome.storage.local.set({ fixedFps30: $('fpsChk').checked });
}

function renderPresets() {
  const list = $('presetList');
  list.innerHTML = '';

  if (presets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'p-empty';
    empty.textContent = '暂无预设。在弹窗中输入尺寸后点「+ 存为预设」即可保存。';
    list.appendChild(empty);
    return;
  }

  presets.forEach((p, i) => {
    if (i === editingIndex) {
      list.appendChild(buildEditRow(p, i));
    } else {
      list.appendChild(buildViewRow(p, i));
    }
  });
}

function buildViewRow(p, i) {
  const locked = isLockedPreset(p);
  const row = document.createElement('div');
  row.className = 'p-row';
  row.draggable = true; // 全部预设均可拖拽排序（HD 仅禁止删除/改名）
  row.dataset.index = i;

  const main = document.createElement('div');
  main.className = 'p-main';

  const handle = document.createElement('span');
  handle.className = 'p-handle';
  handle.textContent = '⠿';
  handle.title = '拖拽调整顺序';

  const name = document.createElement('span');
  name.className = 'p-name';
  name.textContent = p.name;

  const size = document.createElement('span');
  size.className = 'p-size';
  size.textContent = p.w + ' × ' + p.h;

  const actions = document.createElement('div');
  actions.className = 'p-actions';

  if (locked) {
    const lock = document.createElement('span');
    lock.className = 'p-lock';
    lock.textContent = '内置';
    lock.title = 'HD 为内置预设，不可删除或修改名称';
    actions.appendChild(lock);
  } else {
    const editBtn = document.createElement('button');
    editBtn.className = 'p-btn';
    editBtn.textContent = '编辑';
    editBtn.title = '修改预设名称';
    editBtn.addEventListener('click', () => {
      editingIndex = i;
      renderPresets();
      const input = $('editName');
      if (input) { input.focus(); input.select(); }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'p-btn danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deletePreset(i));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
  }

  main.appendChild(handle);
  main.appendChild(name);
  main.appendChild(size);
  main.appendChild(actions);
  row.appendChild(main);

  row.addEventListener('dragstart', e => {
    dragFrom = i;
    row.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) { /* 忽略 */ }
    }
  });
  row.addEventListener('dragend', () => {
    dragFrom = -1;
    clearDropMarks();
  });
  row.addEventListener('dragover', e => {
    e.preventDefault(); // 必须阻止默认才允许 drop
    if (dragFrom < 0 || dragFrom === i) { row.classList.remove('drop-before', 'drop-after'); return; }
    const rect = row.getBoundingClientRect();
    const before = (e.clientY || 0) < rect.top + rect.height / 2;
    row.classList.toggle('drop-before', before);
    row.classList.toggle('drop-after', !before);
  });
  row.addEventListener('drop', e => {
    e.preventDefault();
    dropOnRow(i, e);
  });

  return row;
}

function clearDropMarks() {
  document.querySelectorAll('#presetList .p-row').forEach(r => {
    r.classList.remove('dragging', 'drop-before', 'drop-after');
  });
}

function dropOnRow(targetIndex, e) {
  if (dragFrom < 0 || dragFrom === targetIndex) { clearDropMarks(); return; }
  const rect = e.currentTarget.getBoundingClientRect();
  const before = (e.clientY || 0) < rect.top + rect.height / 2;
  const item = presets.splice(dragFrom, 1)[0];
  let to = targetIndex;
  if (dragFrom < targetIndex) to -= 1; // 先移除导致下标前移
  if (!before) to += 1;
  presets.splice(to, 0, item);
  dragFrom = -1;
  persistPresets();
  renderPresets();
  toast('已调整预设顺序');
}

function buildEditRow(p, i) {
  const row = document.createElement('div');
  row.className = 'p-row p-edit';

  const editRow = document.createElement('div');
  editRow.className = 'p-edit-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'editName';
  input.className = 'p-name-input';
  input.maxLength = 20;
  input.value = p.name;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRename(i);
    if (e.key === 'Escape') cancelRename();
  });

  const size = document.createElement('span');
  size.className = 'p-size';
  size.textContent = p.w + ' × ' + p.h; // 尺寸只读，仅支持改名

  const actions = document.createElement('div');
  actions.className = 'p-edit-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'p-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', cancelRename);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'p-btn';
  saveBtn.style.background = '#2563eb';
  saveBtn.style.color = '#fff';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => confirmRename(i));

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  editRow.appendChild(input);
  editRow.appendChild(size);
  row.appendChild(editRow);
  row.appendChild(actions);
  return row;
}

async function confirmRename(i) {
  if (isLockedPreset(presets[i])) { toast('HD 为内置预设，不可修改'); cancelRename(); return; }
  const input = $('editName');
  const name = (input.value || '').trim();
  if (!name) { toast('预设名称不能为空'); return; }
  presets[i] = { ...presets[i], name };
  editingIndex = -1;
  await persistPresets();
  renderPresets();
  toast('已重命名为：' + name);
}

function cancelRename() {
  editingIndex = -1;
  renderPresets();
}

async function deletePreset(i) {
  const p = presets[i];
  if (isLockedPreset(p)) { toast('HD 为内置预设，不可删除'); return; }
  presets.splice(i, 1);
  editingIndex = -1;
  await persistPresets();
  renderPresets();
  toast('已删除预设：' + p.name);
}

async function init() {
  const data = await chrome.storage.local.get(['presets', 'customPresets', 'fixedFps30']);
  presets = normalizePresets(data.presets, data.customPresets);
  if (!Array.isArray(data.presets) || data.presets.length === 0) {
    await chrome.storage.local.set({ presets, customPresets: [] });
  }
  $('fpsChk').checked = data.fixedFps30 === true;

  $('fpsChk').addEventListener('change', saveFpsPref);
  renderPresets();

  // 监听 storage 变更（与弹窗等多视图实时同步）
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.presets) {
          presets = normalizePresets(changes.presets.newValue, []);
          if (editingIndex >= presets.length) editingIndex = -1;
          renderPresets();
        }
        if (changes.fixedFps30) {
          $('fpsChk').checked = changes.fixedFps30.newValue === true;
        }
      }
    });
  }
}

init();
