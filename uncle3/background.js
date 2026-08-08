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
let closeTimer = null; // 延迟关闭 offscreen 的定时器句柄（可取消，防竞态）

// ---------- offscreen 管理 ----------

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

// ---------- 徽标 ----------

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || '#ef4444' });
  chrome.action.setBadgeText({ text: text || '' });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

// ---------- 消息处理 ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 来自 offscreen 的消息（无 sender.tab，且 type 为大写常量）
  if (msg.type === 'TIME') return onTime(msg, sendResponse);
  if (msg.type === 'STOPPED') return onStopped(msg, sendResponse);
  if (msg.type === 'REC_ERROR') return onRecError(msg, sendResponse);

  // 来自 popup 的消息（异步回复）
  handleMessage(msg).then(sendResponse).catch(err => {
    sendResponse({ ok: false, error: String(err && err.message || err) });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'getState':
      return { ok: true, session, maxMs: MAX_RECORD_MS };

    case 'startSession': {
      if (session && (session.state === 'recording' || session.state === 'paused')) {
        return { ok: false, error: '已有录制会话进行中' };
      }
      cancelPendingClose(); // 取消残留的延迟关闭，避免新录制中被旧定时器关掉
      await ensureOffscreen();
      setBadge('0:00');
      try {
        await chrome.runtime.sendMessage({
          type: 'OFF_START',
          streamId: msg.streamId,
          audio: !!msg.audio,
          mp4: msg.mp4 !== false,
          fps30: !!msg.fps30,
          maxMs: Number(msg.maxMs) > 0 ? Number(msg.maxMs) : MAX_RECORD_MS,
          title: msg.title || ''
        });
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
      return { ok: true };
    }

    case 'stopSession': {
      if (!session || (session.state !== 'recording' && session.state !== 'paused')) {
        return { ok: false };
      }
      session.state = 'encoding';
      clearBadge();
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
      closeOffscreen();
      return { ok: true };
    }

    default:
      return { ok: false, error: 'unknown message type' };
  }
}

// ---------- offscreen 回调 ----------

function onTime(msg, sendResponse) {
  if (!session) return sendResponse({ ok: true });
  // 仅活跃会话接受计时上报，避免残留定时器的 TIME 污染 error/done 会话
  if (session.state === 'recording' || session.state === 'paused') {
    session.elapsedMs = msg.ms || 0;
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
    cleanup();
    return;
  }

  session.limitReached = !!msg.limitReached;
  session.mime = msg.mime || '';
  session.fileName = msg.fileName;
  session.state = 'done';
  clearBadge();
  cleanup();
}

function onRecError(msg, sendResponse) {
  sendResponse({ ok: true });
  session = { state: 'error', reason: msg.error || '录制失败' };
  clearBadge();
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
  closeOffscreen();
  return { ok: false, error: '操作失败：' + errMsg(err) };
}

function errMsg(e) {
  return String((e && e.message) || e || '未知错误');
}
