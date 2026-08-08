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

async function closeOffscreen() {
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
      await ensureOffscreen();
      session = {
        state: 'recording',
        tabId: msg.tabId,
        title: msg.title || '',
        elapsedMs: 0,
        limitReached: false
      };
      setBadge('0:00');
      await chrome.runtime.sendMessage({
        type: 'OFF_START',
        streamId: msg.streamId,
        audio: !!msg.audio,
        mp4: msg.mp4 !== false,
        fps30: !!msg.fps30,
        maxMs: MAX_RECORD_MS,
        title: msg.title || ''
      });
      return { ok: true };
    }

    case 'pauseSession': {
      if (!session || session.state !== 'recording') return { ok: false };
      await chrome.runtime.sendMessage({ type: 'OFF_PAUSE' });
      session.state = 'paused';
      setBadge(fmtBadge(session.elapsedMs), '#f59e0b');
      return { ok: true };
    }

    case 'resumeSession': {
      if (!session || session.state !== 'paused') return { ok: false };
      await chrome.runtime.sendMessage({ type: 'OFF_RESUME' });
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
      await chrome.runtime.sendMessage({ type: 'OFF_STOP' });
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
  session.elapsedMs = msg.ms || 0;
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
  setTimeout(() => {
    closingOffscreen = false;
    closeOffscreen();
  }, 1500);
}
