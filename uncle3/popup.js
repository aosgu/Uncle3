// popup.js —— Uncle3 弹窗逻辑

const $ = id => document.getElementById(id);

// ==================== 通用 ====================

function bgSend(msg) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, resp => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(resp || { ok: false });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ==================== 窗口尺寸 ====================

// v1.3 起统一预设列表（内置+自定义合并，顺序可在设置页拖拽调整），storage 键 presets
let presets = [];
let lastSelectedKey = '';

async function persistPresets() {
  await chrome.storage.local.set({ presets });
}

function renderPresets() {
  const grid = $('presets');
  grid.innerHTML = '';
  // 除 HD（锁定）外，其余预设均可在弹窗内删除
  presets.forEach(p => grid.appendChild(buildPresetCard(p, !isLockedPreset(p))));
  markSelected();
}

function buildPresetCard(p, deletable) {
  const el = document.createElement('button');
  el.className = 'preset';
  el.dataset.key = presetKey(p);
  el.innerHTML = '<div class="name"></div><div class="size"></div>';
  el.querySelector('.name').textContent = p.name;
  el.querySelector('.size').textContent = p.w + ' × ' + p.h;
  el.onclick = () => applySize(p.w, p.h);
  if (deletable) {
    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '×';
    del.title = '删除该预设';
    del.onclick = e => { e.stopPropagation(); deletePreset(p); };
    el.appendChild(del);
  }
  return el;
}

function markSelected() {
  document.querySelectorAll('.preset').forEach(el => {
    el.classList.toggle('selected', el.dataset.key === lastSelectedKey);
  });
}

async function applySize(w, h) {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.storage.local.set({ lastSize: { w: win.width, h: win.height } });
    const updated = await chrome.windows.update(win.id, { width: w, height: h, state: 'normal' });
    lastSelectedKey = w + 'x' + h;
    markSelected();
    $('curSize').textContent = updated.width + ' × ' + updated.height;
    if (Math.abs(updated.width - w) > 10 || Math.abs(updated.height - h) > 10) {
      toast('当前屏幕无法容纳目标尺寸，已调整至最大可用尺寸');
    } else {
      toast('已调整为 ' + w + ' × ' + h);
    }
  } catch (e) {
    toast('调整失败：' + e.message);
  }
}

function applyCustom() {
  const r = validateSize($('w').value, $('h').value);
  if (!r.ok) { toast(r.reason); return; }
  applySize(r.w, r.h);
}

async function restoreSize() {
  const { lastSize } = await chrome.storage.local.get('lastSize');
  if (!lastSize) { toast('暂无可恢复的尺寸记录'); return; }
  lastSelectedKey = '';
  applySize(lastSize.w, lastSize.h);
}

// ---- 存为预设 ----

function toggleSaveForm() {
  const form = $('saveForm');
  if (form.classList.contains('show')) { closeSaveForm(); return; }
  const w = Number($('w').value), h = Number($('h').value);
  $('presetName').value = (w && h) ? (w + ' × ' + h) : '';
  form.classList.add('show');
  $('presetName').focus();
}

function closeSaveForm() {
  $('saveForm').classList.remove('show');
}

async function confirmSavePreset() {
  const r = validateSize($('w').value, $('h').value);
  if (!r.ok) { toast('请先输入有效的自定义尺寸：' + r.reason); return; }
  if (presets.length >= 20) { toast('预设最多保存 20 个'); return; }
  const name = $('presetName').value.trim() || (r.w + ' × ' + r.h);
  if (presets.some(p => presetKey(p) === r.w + 'x' + r.h)) {
    toast('该尺寸预设已存在');
    return;
  }
  presets.push({ name, w: r.w, h: r.h });
  await persistPresets();
  closeSaveForm();
  renderPresets();
  toast('已保存预设：' + name);
}

async function deletePreset(p) {
  if (isLockedPreset(p)) { toast('HD 为内置预设，不可删除'); return; }
  // 按引用精准删除当前条目，避免同尺寸预设（如迁移残留）被按 key 过滤「连坐」误删
  const i = presets.indexOf(p);
  if (i >= 0) presets.splice(i, 1);
  await persistPresets();
  renderPresets();
  toast('已删除预设：' + p.name);
}

// ---- 当前尺寸回显 ----

async function refreshCurrentSize() {
  try {
    const win = await chrome.windows.getCurrent();
    $('curSize').textContent = win.width + ' × ' + win.height;
  } catch (e) { /* 忽略 */ }
}

function updateApplyBtn() {
  // 仅当宽或高为空时禁用；超范围可点击，由 applyCustom 给出错误提示（PRD 3.1.3）
  $('applyBtn').disabled = $('w').value === '' || $('h').value === '';
}

// ==================== 页面录制 ====================

// uiState: null(跟随后台 session) | 'requesting'
let uiState = null;
let restrictedTab = false;

function showPanel(id) {
  ['st-idle', 'st-running', 'st-encoding', 'st-done', 'st-error'].forEach(i => {
    $(i).classList.toggle('hidden', i !== id);
  });
}

async function checkRestricted() {
  const tab = await getActiveTab();
  restrictedTab = !tab || isRestrictedUrl(tab.url);
}

function renderRecordState(session) {
  if (uiState === 'requesting') {
    showPanel('st-idle');
    $('recBtn').disabled = true;
    $('recBtnText').textContent = '正在请求授权…';
    return;
  }
  $('recBtn').disabled = restrictedTab;
  $('recBtnText').textContent = '开始录制';
  $('idleTip').textContent = restrictedTab
    ? '该页面类型不支持录制（如 chrome:// 页面）'
    : '仅录制当前标签页 · 单次最长 10 分钟';

  if (!session) { showPanel('st-idle'); return; }

  switch (session.state) {
    case 'recording':
    case 'paused': {
      showPanel('st-running');
      $('timer').textContent = fmtTime(session.elapsedMs || 0);
      const paused = session.state === 'paused';
      $('pauseBtn').textContent = paused ? '继续' : '暂停';
      $('recDot').classList.toggle('paused', paused);
      $('recStateText').textContent = paused ? '已暂停' : '正在录制当前标签页';
      break;
    }
    case 'encoding':
      showPanel('st-encoding');
      break;
    case 'done':
      showPanel('st-done');
      $('doneFile').textContent = session.fileName || '';
      $('doneTitle').textContent = session.limitReached
        ? '已达 10 分钟上限，自动停止并完成导出'
        : '视频已完成导出';
      // Chrome 设置「下载前询问保存位置」开启时会弹保存对话框（插件无法绕过），
      // 此处文件名已预填，提示用户直接保存及如何改为直下
      $('doneHint').textContent = '若弹出了保存对话框：文件名已预填，直接点「保存」即可。' +
        '想跳过对话框：Chrome 设置 → 下载内容 → 关闭「下载前询问每个文件的保存位置」。';
      break;
    case 'error':
      showPanel('st-error');
      $('errText').textContent = session.reason || '录制失败';
      break;
    default:
      showPanel('st-idle');
  }
}

async function pollRecordState() {
  if (uiState === 'requesting') return;
  const resp = await bgSend({ type: 'getState' });
  if (resp.ok) renderRecordState(resp.session);
}

async function startRecording() {
  if (restrictedTab) { toast('该页面类型不支持录制'); return; }
  const tab = await getActiveTab();
  if (!tab) { toast('未找到当前标签页'); return; }

  uiState = 'requesting';
  renderRecordState(null);
  try {
    // tabCapture 必须在用户手势上下文中立即调用
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const { fixedFps30 } = await chrome.storage.local.get('fixedFps30');
    const resp = await bgSend({
      type: 'startSession',
      streamId,
      tabId: tab.id,
      audio: $('audioChk').checked,
      mp4: $('mp4Chk').checked,
      fps30: fixedFps30 === true, // 设置页选项，默认不勾选
      title: tab.title || tab.url || ''
    });
    if (!resp.ok) toast('启动录制失败：' + (resp.error || '未知错误'));
  } catch (e) {
    toast('录制授权失败：' + (e.message || e));
  } finally {
    uiState = null;
    pollRecordState();
  }
}

async function togglePause() {
  // 以后台真实会话状态为准，避免依赖 UI 文案（i18n/文案改动即崩）
  let paused = $('pauseBtn').textContent === '继续';
  try {
    const resp = await bgSend({ type: 'getState' });
    if (resp && resp.ok && resp.session) {
      paused = resp.session.state === 'paused';
    }
  } catch (e) { /* 降级用按钮文案 */ }
  bgSend({ type: paused ? 'resumeSession' : 'pauseSession' }).then(pollRecordState);
}

function stopRecording() {
  bgSend({ type: 'stopSession' }).then(pollRecordState);
}

function resetRecording() {
  bgSend({ type: 'clearSession' }).then(pollRecordState);
}

function saveAudioPref() {
  chrome.storage.local.set({ recordAudio: $('audioChk').checked });
}

function saveMp4Pref() {
  chrome.storage.local.set({ exportMp4: $('mp4Chk').checked });
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

// ==================== 初始化 ====================

let eventsBound = false;
function bindEvents() {
  // MV3 扩展页 CSP 禁止内联事件（onclick="…" 会被静默拦截），
  // 因此所有交互统一在此用 addEventListener 绑定；防止重复绑定。
  if (eventsBound) return;
  eventsBound = true;
  $('applyBtn').addEventListener('click', applyCustom);
  $('saveFormBtn').addEventListener('click', toggleSaveForm);
  $('restoreBtn').addEventListener('click', restoreSize);
  $('saveCancelBtn').addEventListener('click', closeSaveForm);
  $('saveConfirmBtn').addEventListener('click', confirmSavePreset);
  $('recBtn').addEventListener('click', startRecording);
  $('audioChk').addEventListener('change', saveAudioPref);
  $('mp4Chk').addEventListener('change', saveMp4Pref);
  $('pauseBtn').addEventListener('click', togglePause);
  $('stopBtn').addEventListener('click', stopRecording);
  $('againBtn').addEventListener('click', resetRecording);
  $('errCloseBtn').addEventListener('click', resetRecording);
  $('settingsBtn').addEventListener('click', openSettings);
}

async function init() {
  const data = await chrome.storage.local.get(['presets', 'customPresets', 'recordAudio', 'exportMp4']);
  // 首次使用以默认顺序（HD/Full HD 置顶）初始化，并合入旧版 customPresets
  presets = normalizePresets(data.presets, data.customPresets);
  if (!Array.isArray(data.presets) || data.presets.length === 0) {
    await chrome.storage.local.set({ presets, customPresets: [] });
  }
  $('audioChk').checked = data.recordAudio !== false;
  $('mp4Chk').checked = data.exportMp4 !== false; // 默认勾选

  bindEvents();
  renderPresets();
  await refreshCurrentSize();
  await checkRestricted();
  pollRecordState();

  $('w').addEventListener('input', updateApplyBtn);
  $('h').addEventListener('input', updateApplyBtn);
  updateApplyBtn();

  setInterval(refreshCurrentSize, 1000);
  setInterval(pollRecordState, 600);
}

init();
