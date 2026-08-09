// offscreen.js —— Uncle3 录制执行体（Offscreen Document）
// 负责 getUserMedia(tabCapture) → MediaRecorder → 数据回传 background。
// 整体包裹在 IIFE 中，避免函数名与 popup 等上下文发生全局冲突。
(() => {

let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let state = 'idle';
let startedAt = 0;
let pausedAccum = 0;
let pauseStartedAt = 0;
let maxMs = MAX_RECORD_MS;
let tickTimer = null;
let limitTriggered = false;
let discardFlag = false;
let sessionTitle = '';
let preferMp4 = true;
let selectedMime = '';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'OFF_START':
      // 注意：startRecording 内部失败时以 resolve({ok:false}) 返回，
      // 因此需在 then 中判断并上报 REC_ERROR，不能只依赖 catch。
      startRecording(msg).then(r => {
        if (!r || !r.ok) {
          chrome.runtime.sendMessage(
            { type: 'REC_ERROR', error: (r && r.error) || '录制启动失败' },
            () => void chrome.runtime.lastError);
        }
        sendResponse(r);
      }).catch(err => {
        chrome.runtime.sendMessage({ type: 'REC_ERROR', error: errMsg(err) },
          () => void chrome.runtime.lastError);
        sendResponse({ ok: false, error: errMsg(err) });
      });
      return true;

    case 'OFF_PAUSE':
      pauseRecording();
      sendResponse({ ok: true });
      return;

    case 'OFF_RESUME':
      resumeRecording();
      sendResponse({ ok: true });
      return;

    case 'OFF_STOP':
      // recorder.onstop 中异步回传 STOPPED
      stopRecording(false);
      sendResponse({ ok: true });
      return;

    case 'OFF_DISCARD':
      discardFlag = true;
      stopRecording(false);
      sendResponse({ ok: true });
      return;
  }
});

function errMsg(e) {
  return String((e && e.message) || e || '未知错误');
}

async function startRecording({ streamId, audio, maxMs: limit, title, mp4, fps30 }) {
  if (state !== 'idle') return { ok: false, error: '录制器忙' };
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, error: '当前浏览器不支持 MediaRecorder' };
  }

  maxMs = limit || MAX_RECORD_MS;
  limitTriggered = false;
  discardFlag = false;
  sessionTitle = title || '';
  preferMp4 = mp4 !== false;

  // 固定帧率选项（设置页，默认关）：仅能封顶捕获流帧率，不能抬高
  const videoMandatory = {
    chromeMediaSource: 'tab',
    chromeMediaSourceId: streamId
  };
  if (fps30) videoMandatory.maxFrameRate = 30;

  const constraints = {
    audio: audio ? {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    } : false,
    video: { mandatory: videoMandatory }
  };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    return { ok: false, error: '无法获取标签页媒体流：' + errMsg(e) };
  }

  const mime = pickMimeType(t => MediaRecorder.isTypeSupported(t), preferMp4);
  selectedMime = mime;
  const options = { videoBitsPerSecond: 4_000_000 };
  if (mime) options.mimeType = mime;

  chunks = [];
  try {
    mediaRecorder = new MediaRecorder(mediaStream, options);
  } catch (e) {
    cleanupStream();
    return { ok: false, error: 'MediaRecorder 初始化失败：' + errMsg(e) };
  }

  mediaRecorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onerror = e => {
    chrome.runtime.sendMessage({ type: 'REC_ERROR', error: '录制出错：' + errMsg(e && e.error) });
    cleanupAll();
  };
  mediaRecorder.onstop = () => finalize();

  // 标签页被关闭 / 导航导致轨道结束时，尽量保存已录内容
  const videoTrack = mediaStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.addEventListener('ended', () => {
      if (state === 'recording' || state === 'paused') stopRecording(false);
    });
  }

  try {
    mediaRecorder.start(1000);
  } catch (e) {
    // start() 抛异常时清理已获取的流与录制器，避免旧流泄漏
    cleanupAll();
    return { ok: false, error: '录制启动失败：' + errMsg(e) };
  }
  state = 'recording';
  startedAt = Date.now();
  pausedAccum = 0;
  pauseStartedAt = 0;

  tickTimer = setInterval(tick, 500);
  return { ok: true, mime: mediaRecorder.mimeType || mime };
}

function elapsedMs() {
  if (state === 'idle' || !startedAt) return 0;
  const pausing = state === 'paused' ? Date.now() - pauseStartedAt : 0;
  return Math.max(0, Date.now() - startedAt - pausedAccum - pausing);
}

function tick() {
  const ms = elapsedMs();
  chrome.runtime.sendMessage({ type: 'TIME', ms }, () => void chrome.runtime.lastError);
  if (ms >= maxMs && !limitTriggered) {
    limitTriggered = true;
    stopRecording(true);
  }
}

function pauseRecording() {
  if (state !== 'recording' || !mediaRecorder) return;
  if (mediaRecorder.state === 'recording') mediaRecorder.pause();
  pauseStartedAt = Date.now();
  state = 'paused';
}

function resumeRecording() {
  if (state !== 'paused' || !mediaRecorder) return;
  if (mediaRecorder.state === 'paused') mediaRecorder.resume();
  pausedAccum += Date.now() - pauseStartedAt;
  pauseStartedAt = 0;
  state = 'recording';
}

function stopRecording(byLimit) {
  if (byLimit) limitTriggered = true;
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    if (state === 'recording' || state === 'paused') finalize();
    return;
  }
  state = 'stopping';
  try {
    mediaRecorder.stop();
  } catch (e) {
    finalize();
  }
}

function finalize() {
  if (state === 'idle' && chunks.length === 0) return;
  clearInterval(tickTimer);
  tickTimer = null;

  const mime = (mediaRecorder && mediaRecorder.mimeType) || selectedMime || '';
  const blob = new Blob(chunks, { type: mime || 'video/webm' });
  const wasLimit = limitTriggered;
  const shouldDiscard = discardFlag || blob.size === 0;
  const titleForFile = sessionTitle; // 先取出，cleanupAll 会重置 sessionTitle

  cleanupAll();

  if (shouldDiscard) {
    if (!discardFlag) {
      chrome.runtime.sendMessage({ type: 'STOPPED', ok: false, error: '未捕获到任何画面' },
        () => void chrome.runtime.lastError);
    }
    return;
  }

  // 由本文档直接以 <a download> 发起下载：文件名来自 download 属性，
  // 不依赖 chrome.downloads.download 的 filename 参数——后者在保存对话框中
  // 预填不可靠（data URL 场景尤甚），且会被其他扩展注册的
  // onDeterminingFilename 监听器全局覆盖（表现为对话框里只剩默认的「下载」）。
  const fileName = makeFileName(titleForFile, mime);
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    chrome.runtime.sendMessage({
      type: 'STOPPED',
      ok: true,
      fileName,
      mime,
      size: blob.size,
      limitReached: wasLimit
    }, () => void chrome.runtime.lastError);
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'STOPPED', ok: false, error: '导出失败：' + errMsg(e) },
      () => void chrome.runtime.lastError);
  }
}

function cleanupStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
}

function cleanupAll() {
  // 统一清理，防止 onerror 等路径只清流/录制器却漏掉 tick 定时器（漏掉会让旧 interval
  // 在文档被复用前持续发 TIME，且与下一次 startRecording 新建的 interval 形成双发）。
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  cleanupStream();
  mediaRecorder = null;
  chunks = [];
  state = 'idle';
  startedAt = 0;
  pausedAccum = 0;
  pauseStartedAt = 0;
  sessionTitle = '';
  selectedMime = '';
  preferMp4 = true;
}

})();
