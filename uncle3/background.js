// background.js —— Uncle3 录制会话管理（MV3 Service Worker）
importScripts('core.js');

const OFFSCREEN_PATH = 'offscreen.html';

/**
 * session 结构：
 * {
 *   state: 'recording' | 'paused' | 'encoding' | 'done' | 'error',
 *   tabId, title, elapsedMs, fileName, mime, reason, limitReached
 * }
 * 为 null 表示空闲（idle）。
 */
let session = null;
let closingOffscreen = false;
let closeTimer = null;

let persistTimer = null;
async function persistSession() {
  if (!chrome.storage || !chrome.storage.session) return;
  try {
    if (session) await chrome.storage.session.set({ session });
    else await chrome.storage.session.remove('session');
  } catch (e) { /* session storage 不可用时降级为内存 */ }
}
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persistSession(); }, 300);
}
async function restoreSession() {
  if (!chrome.storage || !chrome.storage.session) return;
  try {
    const data = await chrome.storage.session.get('session');
    // 读取期间若已有会话被创建（如并发 startSession），不得用陈旧快照覆盖它
    if (session) return;
    if (data && data.session) {
      session = data.session;
      if (session.state === 'recording') setBadge(fmtBadge(session.elapsedMs || 0));
      else if (session.state === 'paused') setBadge(fmtBadge(session.elapsedMs || 0), '#f59e0b');
      else if (session.state === 'encoding') clearBadge();
    }
  } catch (e) { /* 忽略 */ }
}
// 启动时尝试恢复（不阻塞后续消息处理）
restoreSession();

async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument) {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) return;
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA'],
    justification: '录制当前标签页的媒体流'
  });
}

async function closeOffscreen(force) {
  // 非强制关闭时，若存在活跃会话（录制/暂停/导出中）则拒绝关闭：
  // 防止延迟关闭定时器与慢机上新会话启动的竞争把正在使用的文档关掉
  if (!force && session &&
      (session.state === 'recording' || session.state === 'paused' || session.state === 'encoding')) {
    return;
  }
  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) { /* 忽略 */ }
}

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || '#ef4444' });
  chrome.action.setBadgeText({ text: text || '' });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // OFF_* 是 background ↔ offscreen 之间的私有录制协议，只应由 offscreen 文档处理。
  // 真实 Chrome 中 runtime.sendMessage 不会自我投递（background 发出去的 OFF_* 不会
  // 回到本上下文），此处显式忽略可避免仿真环境/异常投递下 background 抢答该消息
  // （background 无能力处理 OFF_*，会误回 unknown message type 造成 startSession 误判失败）。
  if (msg && typeof msg.type === 'string' && msg.type.indexOf('OFF_') === 0) return;

  if (msg.type === 'TIME') return onTime(msg, sendResponse);
  if (msg.type === 'STOPPED') return onStopped(msg, sendResponse);
  if (msg.type === 'REC_ERROR') return onRecError(msg, sendResponse);

  handleMessage(msg).then(sendResponse).catch(err => {
    sendResponse({ ok: false, error: String(err && err.message || err) });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'getState': {
      // SW 可能被系统回收后重启，内存 session 丢失但 storage.session 仍有快照，延迟恢复
      if (!session && chrome.storage && chrome.storage.session) {
        try {
          const data = await chrome.storage.session.get('session');
          if (data && data.session) {
            session = data.session;
            if (session.state === 'recording') setBadge(fmtBadge(session.elapsedMs || 0));
            else if (session.state === 'paused') setBadge(fmtBadge(session.elapsedMs || 0), '#f59e0b');
          }
        } catch (e) {}
      }
      return { ok: true, session, maxMs: MAX_RECORD_MS };
    }

    case 'startSession': {
      if (session && (session.state === 'recording' || session.state === 'paused')) {
        return { ok: false, error: '已有录制会话进行中' };
      }
      cancelPendingClose(); // 取消残留的延迟关闭，避免新录制中被旧定时器关掉
      await ensureOffscreen();
      setBadge('0:00');
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'OFF_START',
          streamId: msg.streamId,
          audio: !!msg.audio,
          mp4: msg.mp4 !== false,
          fps30: !!msg.fps30,
          maxMs: Number(msg.maxMs) > 0 ? Number(msg.maxMs) : MAX_RECORD_MS,
          title: msg.title || ''
        });
        // offscreen 可能以 {ok:false} 拒绝启动（录制器忙 / 不支持 MediaRecorder /
        // 获取媒体流失败等）。必须校验响应，否则会建立「幻影 recording」会话：
        // 无媒体流、计时冻结、停止后也无 STOPPED 回传（P1-1，tests/sim.js T19 回归）。
        // 注意：此处不强制关闭 offscreen 文档——「录制器忙」时文档正忙于上一会话
        // 的 finalize，关闭会中断其导出；让旧会话的 STOPPED → cleanup 自行回收。
        if (!resp || !resp.ok) {
          clearBadge();
          return { ok: false, error: '录制启动失败：' + ((resp && resp.error) || '未知错误') };
        }
      } catch (e) {
        // 发送失败即录制文档不可用（崩溃/被回收）：不留残留会话，清理后返回错误
        clearBadge();
        await closeOffscreen();
        return { ok: false, error: '录制启动失败：' + errMsg(e) };
      }
      session = {
        state: 'recording',
        tabId: msg.tabId,
        title: msg.title || '',
        elapsedMs: 0,
        limitReached: false
      };
      persistSession();
      return { ok: true };
    }

    case 'pauseSession': {
      if (!session || session.state !== 'recording') return { ok: false };
      try {
        await chrome.runtime.sendMessage({ type: 'OFF_PAUSE' });
      } catch (e) {
        return onOffscreenDead(e);
      }
      session.state = 'paused';
      setBadge(fmtBadge(session.elapsedMs), '#f59e0b');
      persistSession();
      return { ok: true };
    }

    case 'resumeSession': {
      if (!session || session.state !== 'paused') return { ok: false };
      try {
        await chrome.runtime.sendMessage({ type: 'OFF_RESUME' });
      } catch (e) {
        return onOffscreenDead(e);
      }
      session.state = 'recording';
      setBadge(fmtBadge(session.elapsedMs));
      persistSession();
      return { ok: true };
    }

    case 'stopSession': {
      if (!session || (session.state !== 'recording' && session.state !== 'paused')) {
        return { ok: false };
      }
      session.state = 'encoding';
      clearBadge();
      persistSession();
      try {
        await chrome.runtime.sendMessage({ type: 'OFF_STOP' });
      } catch (e) {
        // 录制文档已死（崩溃/被回收）：会话降级为 error，避免永久卡在 encoding
        return onOffscreenDead(e);
      }
      return { ok: true };
    }

    case 'clearSession': {
      session = null;
      clearBadge();
      persistSession();
      // 先通知 offscreen 丢弃并停止可能仍在进行的录制（如看门狗降级 error 后用户关闭时
      // 文档仍活着的情况），避免残留录制器/媒体流/tick 定时器占用 offscreen，
      // 否则后续 OFF_START 会一直「录制器忙」。文档已死时该消息发送失败，忽略即可。
      try {
        await chrome.runtime.sendMessage({ type: 'OFF_DISCARD' });
      } catch (e) { /* 文档不可达，随 closeOffscreen 一并清理 */ }
      closeOffscreen();
      return { ok: true };
    }

    default:
      return { ok: false, error: 'unknown message type' };
  }
}

function onTime(msg, sendResponse) {
  if (!session) return sendResponse({ ok: true });
  // 仅活跃会话接受计时上报，避免残留定时器的 TIME 污染 error/done 会话
  if (session.state === 'recording' || session.state === 'paused') {
    session.elapsedMs = msg.ms || 0;
    schedulePersist();
  }
  if (session.state === 'recording') setBadge(fmtBadge(session.elapsedMs));
  sendResponse({ ok: true });
}

function onStopped(msg, sendResponse) {
  sendResponse({ ok: true });
  if (!session) { cleanup(); return; }

  // 下载已由 offscreen 以 <a download> 直接发起（文件名预填更可靠），
  // 此处只接收结果更新会话状态。
  if (!msg.ok || !msg.fileName) {
    session = { state: 'error', reason: msg.error || '录制失败' };
    clearBadge();
    persistSession();
    cleanup();
    return;
  }

  session.limitReached = !!msg.limitReached;
  session.mime = msg.mime || '';
  session.fileName = msg.fileName;
  session.state = 'done';
  clearBadge();
  persistSession();
  cleanup();
}

function onRecError(msg, sendResponse) {
  sendResponse({ ok: true });
  session = { state: 'error', reason: msg.error || '录制失败' };
  clearBadge();
  persistSession();
  cleanup();
}

function cleanup() {
  if (closingOffscreen) return;
  closingOffscreen = true;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    closingOffscreen = false;
    closeOffscreen(); // 内部会检查活跃会话，竞争窗口内不会误关正在录制的文档
  }, 1500);
}

// 取消待执行的延迟关闭（新会话启动前调用，防止旧定时器误关正在录制的文档）
function cancelPendingClose() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  closingOffscreen = false;
}

// offscreen 文档不可用（崩溃/被系统回收）时的看门狗兜底：
// 将会话降级为 error（popup 据此展示错误面板，用户可关闭重来），并清理残留文档。
function onOffscreenDead(err) {
  session = { state: 'error', reason: '录制文档已丢失，请关闭后重试' };
  clearBadge();
  cancelPendingClose();
  persistSession();
  closeOffscreen();
  return { ok: false, error: '操作失败：' + errMsg(err) };
}

function errMsg(e) {
  return String((e && e.message) || e || '未知错误');
}
