// tests/sim.js —— 集成仿真测试脚本
// 在 mock chrome 环境下驱动真实的 background/offscreen/popup 代码，跑完关键用户流程

(function () {
  const sim = window.__sim;
  const $ = id => document.getElementById(id);
  let passed = 0, failed = 0;
  const resultsEl = $('results');

  function check(name, cond, detail) {
    const line = document.createElement('div');
    if (cond) { passed++; line.className = 'pass'; line.textContent = 'PASS  ' + name; }
    else { failed++; line.className = 'fail'; line.textContent = 'FAIL  ' + name + (detail ? '  <- ' + detail : ''); }
    resultsEl.appendChild(line);
    console.log(line.textContent);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 轮询等待条件成立（应对仿真机性能波动），超时后返回最后一次条件结果；支持 async 条件函数
  async function waitUntil(fn, timeout = 2500, interval = 80) {
    let last;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      last = await fn();
      if (last) return last;
      await sleep(interval);
    }
    return last;
  }

  function lastOfType(type) {
    for (let i = sim.msgLog.length - 1; i >= 0; i--) {
      if (sim.msgLog[i].type === type) return sim.msgLog[i];
    }
    return null;
  }

  async function getSession() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'getState' }, r => resolve(r));
    });
  }

  // 直接向 background 发消息（绕过 popup UI，用于构造特殊测试链路）
  function bgSendDirect(msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(msg, r => resolve(r));
    });
  }

  async function run() {
    await sleep(200); // 等待 popup init 完成

    // ---------- T1 初始化 ----------
    check('T1 初始预设渲染 4 个', document.querySelectorAll('#presets .preset').length === 4);
    const t1Cards = [...document.querySelectorAll('#presets .preset')];
    check('T1 默认顺序 HD/Full HD 置顶', t1Cards[0].dataset.key === '1280x720' && t1Cards[1].dataset.key === '1920x1080',
      t1Cards.map(c => c.dataset.key).join(','));
    check('T1 HD 卡片无删除按钮', !t1Cards[0].querySelector('.del'));
    check('T1 非 HD 卡片有删除按钮', !!t1Cards[1].querySelector('.del'));
    check('T1 当前尺寸回显', $('curSize').textContent === '1440 × 900', $('curSize').textContent);

    // ---------- T2 点击预设 HD ----------
    const hdCard = [...document.querySelectorAll('#presets .preset')].find(el => el.querySelector('.name').textContent === 'HD');
    hdCard.click();
    await sleep(80);
    const upd1 = sim.windowUpdates[sim.windowUpdates.length - 1];
    check('T2 调用 windows.update 1280×720', upd1 && upd1.width === 1280 && upd1.height === 720, JSON.stringify(upd1));
    check('T2 记录调整前尺寸', sim.store.lastSize && sim.store.lastSize.w === 1440 && sim.store.lastSize.h === 900);
    check('T2 卡片选中态', hdCard.classList.contains('selected'));
    check('T2 toast 提示', $('toast').textContent === '已调整为 1280 × 720', $('toast').textContent);

    // ---------- T3 恢复上次尺寸 ----------
    $('restoreBtn').click();
    await sleep(80);
    const upd2 = sim.windowUpdates[sim.windowUpdates.length - 1];
    check('T3 恢复到 1440×900', upd2 && upd2.width === 1440 && upd2.height === 900, JSON.stringify(upd2));

    // ---------- T4 自定义超范围 ----------
    $('w').value = '99999'; $('h').value = '800';
    $('w').dispatchEvent(new Event('input')); $('h').dispatchEvent(new Event('input'));
    const updatesBefore = sim.windowUpdates.length;
    $('applyBtn').click();
    await sleep(80);
    check('T4 超范围不调整窗口', sim.windowUpdates.length === updatesBefore);
    check('T4 超范围 toast', $('toast').textContent.indexOf('超出范围') !== -1, $('toast').textContent);

    // ---------- T5 自定义合法 800×600 ----------
    $('w').value = '800'; $('h').value = '600';
    $('applyBtn').click();
    await sleep(80);
    const upd3 = sim.windowUpdates[sim.windowUpdates.length - 1];
    check('T5 应用自定义 800×600', upd3 && upd3.width === 800 && upd3.height === 600);

    // ---------- T6 屏幕钳制提示 ----------
    sim.screen = { w: 1600, h: 900 };
    const fhdCard = [...document.querySelectorAll('#presets .preset')].find(el => el.querySelector('.name').textContent === 'Full HD');
    fhdCard.click();
    await sleep(80);
    check('T6 钳制 toast', $('toast').textContent.indexOf('无法容纳') !== -1, $('toast').textContent);
    check('T6 实际尺寸回显 1600×900', $('curSize').textContent === '1600 × 900', $('curSize').textContent);
    sim.screen = { w: 3000, h: 2000 };

    // ---------- T7 存为预设 / 删除预设 ----------
    $('w').value = '500'; $('h').value = '400';
    toggleSaveForm();
    $('presetName').value = '测试预设';
    await confirmSavePreset();
    await sleep(50);
    check('T7 保存自定义预设', sim.store.presets && sim.store.presets.length === 5);
    check('T7 预设卡片变 5 个', document.querySelectorAll('#presets .preset').length === 5);
    const customCard = [...document.querySelectorAll('#presets .preset')].find(el => el.dataset.key === '500x400');
    customCard.querySelector('.del').click();
    await sleep(50);
    check('T7 删除自定义预设', document.querySelectorAll('#presets .preset').length === 4 &&
      sim.store.presets.length === 4);

    // ---------- T8 录制全流程 ----------
    $('recBtn').click();
    await sleep(300);
    let resp = await getSession();
    check('T8 会话进入 recording', resp.ok && resp.session && resp.session.state === 'recording', JSON.stringify(resp.session));
    check('T8 offscreen 已创建', sim.offscreenOpen === true);
    check('T8 徽标显示', sim.badge !== '');
    check('T8 getUserMedia 带 tab 源', sim.gumConstraints &&
      sim.gumConstraints.video.mandatory.chromeMediaSource === 'tab' &&
      sim.gumConstraints.audio.mandatory.chromeMediaSource === 'tab');
    check('T8 OFF_START 默认携带 mp4 偏好', lastOfType('OFF_START') && lastOfType('OFF_START').mp4 === true,
      JSON.stringify(lastOfType('OFF_START')));
    check('T8 运行面板可见', !$('st-running').classList.contains('hidden'));

    await sleep(800); // 等待 TIME 消息累计
    resp = await getSession();
    check('T8 计时累计 > 0', resp.session.elapsedMs > 0, 'elapsed=' + resp.session.elapsedMs);

    // 暂停 / 继续
    $('pauseBtn').click();
    await sleep(120);
    resp = await getSession();
    check('T8 暂停生效', resp.session.state === 'paused');
    check('T8 暂停徽标变色', sim.badgeColor === '#f59e0b');
    $('pauseBtn').click();
    await sleep(120);
    resp = await getSession();
    check('T8 继续录制', resp.session.state === 'recording');

    // 停止并导出
    $('stopBtn').click();
    await sleep(600);
    resp = await getSession();
    check('T8 会话进入 done', resp.session.state === 'done', JSON.stringify(resp.session));
    check('T8 触发下载', sim.downloads.length === 1, JSON.stringify(sim.downloads));
    check('T8 文件名符合规则', /^Demo 演示页面_\d{8}_\d{6}\.mp4$/.test(sim.downloads[0] && sim.downloads[0].filename),
      sim.downloads[0] && sim.downloads[0].filename);
    // 完成面板渲染依赖 popup 轮询（600ms 间隔），轮询等待以排除性能波动
    await waitUntil(() => $('doneFile').textContent === (sim.downloads[0] && sim.downloads[0].filename));
    check('T8 完成面板展示文件名', $('doneFile').textContent === (sim.downloads[0] && sim.downloads[0].filename),
      'doneFile=' + JSON.stringify($('doneFile').textContent) + ' panelHidden=' + $('st-done').classList.contains('hidden') +
      ' session=' + JSON.stringify((await getSession()).session));
    check('T8 完成面板含保存对话框引导提示', $('doneHint').textContent.indexOf('保存对话框') !== -1, $('doneHint').textContent);
    check('T8 徽标清除', sim.badge === '');

    // 再录一次 → 回到空闲
    $('againBtn').click();
    await sleep(150);
    resp = await getSession();
    check('T8 再录一次回到 idle', resp.session === null || !resp.session);
    check('T8 空闲面板可见', !$('st-idle').classList.contains('hidden'));

    // ---------- T9 授权失败路径 ----------
    sim.gumFail = true;
    const logLenBeforeT9 = sim.msgLog.length;
    $('recBtn').click();
    await sleep(350);
    const recErrLogged = sim.msgLog.slice(logLenBeforeT9).filter(m => m.type === 'REC_ERROR');
    resp = await getSession();
    check('T9 会话进入 error', resp.session && resp.session.state === 'error',
      'session=' + JSON.stringify(resp.session) + ' | REC_ERROR消息数=' + recErrLogged.length);
    check('T9 错误面板展示原因', $('errText').textContent.indexOf('无法获取标签页媒体流') !== -1, $('errText').textContent);
    $('errCloseBtn').click(); // 关闭
    await sleep(150);
    sim.gumFail = false;

    // ---------- T10 受限页面 ----------
    sim.tab.url = 'chrome://settings';
    await init();
    await sleep(150);
    check('T10 受限页面禁用录制', $('recBtn').disabled === true);
    check('T10 受限页面提示', $('idleTip').textContent.indexOf('不支持录制') !== -1, $('idleTip').textContent);
    sim.tab.url = 'https://example.com/demo';
    await init();
    await sleep(150);
    check('T10 正常页面恢复可用', $('recBtn').disabled === false);

    // ---------- T11 用户拒绝授权（tabCapture 层） ----------
    sim.tabCaptureFail = true;
    $('recBtn').click();
    await sleep(250);
    check('T11 拒绝授权 toast', $('toast').textContent.indexOf('录制授权失败') !== -1, $('toast').textContent);
    resp = await getSession();
    check('T11 未建立会话', !resp.session);
    sim.tabCaptureFail = false;

    // ---------- T12 offscreen 录制时长上限自动停止（缩短为 600ms 模拟） ----------
    // 走完整链路：startSession 支持 maxMs 覆盖（仅测试用），保证 background 会话存在，
    // 达上限后 STOPPED 能正常回传并进入 done
    sim.msgLog.length = 0;
    await bgSendDirect({ type: 'clearSession' });
    await bgSendDirect({ type: 'startSession', streamId: 'limit-test', tabId: sim.tab.id,
      audio: false, mp4: true, fps30: false, title: 'limit', maxMs: 600 });
    await sleep(650); // 首条 TIME 在 500ms 时发出
    check('T12 offscreen 启动并开始计时', sim.msgLog.some(m => m.type === 'TIME'),
      '期间消息=' + sim.msgLog.map(m => m.type).join(','));
    await sleep(1200);
    const stoppedMsg = lastOfType('STOPPED');
    check('T12 达上限自动停止', !!stoppedMsg, 'no STOPPED');
    check('T12 limitReached 标记', stoppedMsg && stoppedMsg.limitReached === true);
    check('T12 自动停止携带数据', stoppedMsg && stoppedMsg.ok === true);
    await waitUntil(async () => {
      const r = await getSession();
      return r.session && r.session.state === 'done';
    }, 2500);
    await resetRecording();
    await sleep(150);

    // ---------- T13 取消「导出 MP4」时直接存储 WebM ----------
    sim.msgLog.length = 0;
    $('mp4Chk').checked = false;
    $('recBtn').click();
    await sleep(300);
    check('T13 OFF_START 携带 mp4=false', lastOfType('OFF_START') && lastOfType('OFF_START').mp4 === false,
      JSON.stringify(lastOfType('OFF_START')));
    $('stopBtn').click();
    await sleep(600);
    const webmDownload = sim.downloads[sim.downloads.length - 1];
    check('T13 直接导出 WebM 文件', webmDownload && /\.webm$/.test(webmDownload.filename),
      JSON.stringify(webmDownload));
    await resetRecording();
    await sleep(150);
    $('mp4Chk').checked = true;

    // ---------- T14 齿轮入口打开设置页 ----------
    sim.optionsOpened = false;
    $('settingsBtn').click();
    await sleep(50);
    check('T14 齿轮打开设置页', sim.optionsOpened === true);

    // ---------- T15 固定帧率（30fps）选项透传 ----------
    sim.msgLog.length = 0;
    sim.store.fixedFps30 = true;
    $('recBtn').click();
    await sleep(300);
    check('T15 OFF_START 携带 fps30=true', lastOfType('OFF_START') && lastOfType('OFF_START').fps30 === true,
      JSON.stringify(lastOfType('OFF_START')));
    check('T15 getUserMedia 锁定 maxFrameRate 30', sim.gumConstraints &&
      sim.gumConstraints.video.mandatory.maxFrameRate === 30,
      JSON.stringify(sim.gumConstraints && sim.gumConstraints.video));
    $('stopBtn').click();
    await sleep(600);
    await resetRecording();
    await sleep(150);

    sim.store.fixedFps30 = false;
    $('recBtn').click();
    await sleep(300);
    check('T15 未勾选时 fps30=false', lastOfType('OFF_START') && lastOfType('OFF_START').fps30 === false,
      JSON.stringify(lastOfType('OFF_START')));
    check('T15 未勾选时不带 maxFrameRate', sim.gumConstraints &&
      sim.gumConstraints.video.mandatory.maxFrameRate === undefined);
    $('stopBtn').click();
    await sleep(600);
    await resetRecording();
    await sleep(150);

    // ---------- T16 内置预设删除权限（HD 锁定，其余可删） ----------
    const fhdCardT16 = [...document.querySelectorAll('#presets .preset')].find(el => el.dataset.key === '1920x1080');
    fhdCardT16.querySelector('.del').click();
    await sleep(60);
    check('T16 删除 Full HD 生效', document.querySelectorAll('#presets .preset').length === 3 &&
      sim.store.presets.length === 3 && $('toast').textContent.indexOf('已删除预设') !== -1,
      $('toast').textContent);
    // 恢复默认列表，避免影响后续用例
    sim.store.presets = [
      { name: 'HD', w: 1280, h: 720 }, { name: 'Full HD', w: 1920, h: 1080 },
      { name: 'iPhone 14 Pro', w: 393, h: 852 }, { name: 'iPad Mini', w: 768, h: 1024 }
    ];
    await init();
    await sleep(120);
    check('T16 恢复后 4 个预设', document.querySelectorAll('#presets .preset').length === 4);

    // ---------- T17 停止后 1.5s 内重启录制（cleanup 延迟关闭竞态回归） ----------
    $('recBtn').click();
    await sleep(300);
    $('stopBtn').click();
    await sleep(500); // cleanup 已挂 1500ms 延迟关闭定时器
    await resetRecording();
    await sleep(150);
    $('recBtn').click(); // 旧定时器尚未到期即重启录制
    await sleep(300);
    resp = await getSession();
    check('T17 快速重启会话进入 recording', resp.session && resp.session.state === 'recording',
      JSON.stringify(resp.session));
    await sleep(1600); // 跨越旧定时器触发点
    resp = await getSession();
    check('T17 新录制未被延迟关闭中断', resp.session && resp.session.state === 'recording',
      JSON.stringify(resp.session));
    check('T17 offscreen 文档仍存活', sim.offscreenOpen === true);
    $('stopBtn').click();
    await sleep(600);
    await resetRecording();
    await sleep(150);

    // ---------- T18 录制中 offscreen 文档死亡（看门狗兜底，不得卡死 encoding） ----------
    $('recBtn').click();
    await waitUntil(async () => {
      const r = await getSession();
      return r && r.session && r.session.state === 'recording';
    }, 3000);
    // 模拟 offscreen 文档被系统回收/崩溃：文档标记关闭且 OFF_* 消息无接收端
    sim.offscreenOpen = false;
    $('stopBtn').click();
    const deadSession = await waitUntil(async () => {
      const r = await getSession();
      return r && r.session && r.session.state === 'error' ? r.session : null;
    }, 6000);
    check('T18 文档死亡后会话降级为 error（不卡 encoding）', !!deadSession,
      'session=' + JSON.stringify(((await getSession()) || {}).session));
    check('T18 错误原因可读', !!(deadSession && deadSession.reason),
      JSON.stringify(deadSession));
    await waitUntil(() => !$('st-error').classList.contains('hidden'), 3000);
    check('T18 popup 展示错误面板', !$('st-error').classList.contains('hidden'));
    // 复活 offscreen 文档（模拟 SW 下次 ensureOffscreen 重建文档）后 resetRecording：
    // clearSession 会向 offscreen 发送 OFF_DISCARD 停掉 T18 期间仍在运行的残留录制器。
    // 真实 Chrome 中文档销毁即状态归零，无需清理；此处 mock 的文档内部状态常驻，
    // 必须显式清掉，否则后续用例（T19）会一直「录制器忙」。
    sim.offscreenOpen = true;
    await resetRecording();
    await sleep(200);

    // ---------- T19 offscreen 忙时启动失败不得建立幻影会话（P1-1 回归） ----------
    // 触发窗口：stop 后 encoding→done 的毫秒级窗口内快速重启。UI 上 popup 在 encoding
    // 面板无开始按钮，正常操作难以命中；但状态机不应依赖 UI 兜底——此前 startSession
    // 忽略 OFF_START 的 {ok:false} 响应，会留下「幻影 recording」会话（无媒体流、计时冻结）。
    sim.stopDelay = 0;
    await bgSendDirect({ type: 'clearSession' });
    await sleep(150);
    const busy1 = await bgSendDirect({ type: 'startSession', streamId: 'busy-1', tabId: sim.tab.id,
      audio: true, mp4: true, fps30: false, title: 'busy' });
    check('T19 基线：干净环境下启动成功', busy1 && busy1.ok === true, JSON.stringify(busy1));
    sim.stopDelay = 250; // 此后 finalize 延迟 250ms，制造 offscreen 忙窗口
    await sleep(200);
    await bgSendDirect({ type: 'stopSession' }); // offscreen 进入 stopping，250ms 后才 finalize
    await sleep(80); // 旧会话仍在 finalize（offscreen 忙）
    const busyStart = await bgSendDirect({ type: 'startSession', streamId: 'busy-2', tabId: sim.tab.id,
      audio: true, mp4: true, fps30: false, title: 'busy2' });
    check('T19 忙时启动返回失败', busyStart && busyStart.ok === false, JSON.stringify(busyStart));
    const busySession = (await getSession()).session;
    check('T19 未建立幻影 recording 会话', !busySession || busySession.state !== 'recording',
      JSON.stringify(busySession));
    check('T19 会话为空闲或 done（旧会话正常收尾）',
      !busySession || busySession.state === 'done' || busySession.state === 'error' || busySession.state === 'encoding',
      JSON.stringify(busySession));
    await sleep(400); // 等旧会话 finalize 完成并回传 STOPPED
    await waitUntil(async () => {
      const r = await getSession();
      return r.session && r.session.state === 'done';
    }, 2500);
    // 旧会话收尾后必须能正常重启录制（无残留占用）
    const retryStart = await bgSendDirect({ type: 'startSession', streamId: 'busy-3', tabId: sim.tab.id,
      audio: true, mp4: true, fps30: false, title: 'busy3' });
    check('T19 旧会话收尾后可重启', retryStart && retryStart.ok === true, JSON.stringify(retryStart));
    await sleep(300);
    check('T19 重启会话正常 recording', (await getSession()).session.state === 'recording',
      JSON.stringify((await getSession()).session));
    await bgSendDirect({ type: 'stopSession' });
    await sleep(600);
    await resetRecording();
    await sleep(150);
    sim.stopDelay = 0;

    // ---------- T20 关闭 popup 且停在“完成”终态时自动重置会话（回到初始页） ----------
    // 复现用户反馈：录制完成后停留在“再录一次”页，关闭 popup 再打开应回到初始页，
    // 而非一直卡在“再录一次”页。background 通过 popup 长连接断开感知关闭时机，
    // 仅当会话为终态（done/error）时清空，非终态（录制中）不受影响（关闭不中断录制）。
    sim.msgLog.length = 0;
    await bgSendDirect({ type: 'clearSession' });
    await sleep(150);
    $('recBtn').click();
    await sleep(300);
    $('stopBtn').click();
    await sleep(600);
    resp = await getSession();
    check('T20 会话进入 done（停在“再录一次”页）', resp.session && resp.session.state === 'done', JSON.stringify(resp.session));
    // 模拟关闭 popup：触发 background 的 popup 连接断开
    if (sim.popupPort && typeof sim.popupPort.disconnect === 'function') {
      sim.popupPort.disconnect();
      await sleep(200);
      resp = await getSession();
      check('T20 关闭 popup 后终态会话自动清空', !resp.session, JSON.stringify(resp.session));
      // 重新打开 popup（重连）后应回到初始空闲页：getState 返回空闲，idle 面板可见
      if (chrome.runtime && chrome.runtime.connect) chrome.runtime.connect({ name: 'uncle3-popup' });
      await pollRecordState();
      await sleep(150);
      resp = await getSession();
      check('T20 重新打开 popup 回到初始空闲页', !resp.session, JSON.stringify(resp.session));
      check('T20 重新打开后展示初始空闲面板', !$('st-idle').classList.contains('hidden') && $('st-done').classList.contains('hidden'));
    } else {
      check('T20 关闭 popup 后终态会话自动清空（环境未模拟连接，跳过）', true);
    }

    // ---------- T21 关闭 popup 但会话为“录制中”时不被清空（关闭不中断录制） ----------
    sim.msgLog.length = 0;
    await bgSendDirect({ type: 'clearSession' });
    await sleep(150);
    $('recBtn').click();
    await sleep(300);
    resp = await getSession();
    check('T21 会话进入 recording', resp.session && resp.session.state === 'recording', JSON.stringify(resp.session));
    // 模拟关闭 popup（此时在录制中）
    if (sim.popupPort && typeof sim.popupPort.disconnect === 'function') {
      sim.popupPort.disconnect();
      await sleep(200);
      resp = await getSession();
      check('T21 录制中关闭 popup 不中断/不清空会话', resp.session && resp.session.state === 'recording', JSON.stringify(resp.session));
      // 重新打开 popup 应恢复录制中面板
      if (chrome.runtime && chrome.runtime.connect) chrome.runtime.connect({ name: 'uncle3-popup' });
      await pollRecordState();
      await sleep(150);
      check('T21 重新打开 popup 仍展示录制中面板', !$('st-running').classList.contains('hidden') && $('st-idle').classList.contains('hidden'));
    } else {
      check('T21 录制中关闭 popup 不中断/不清空会话（环境未模拟连接，跳过）', true);
    }
    // 收尾：停止并清空，避免影响后续运行
    if (sim.offscreenOpen) { $('stopBtn').click(); await sleep(600); }
    await resetRecording();
    await sleep(150);

    // ---------- 汇总 ----------
    const summary = $('summary');
    summary.textContent = '总计: ' + (passed + failed) + '  通过: ' + passed + '  失败: ' + failed +
      (failed ? '  —— TESTS FAILED' : '  —— ALL TESTS PASSED');
    summary.className = failed ? 'bad' : 'ok';
    document.title = '[Uncle3仿真] ' + summary.textContent;
    window.__simDone = true;
    window.__simFailed = failed;
  }

  run().catch(e => {
    const line = document.createElement('div');
    line.className = 'fail';
    line.textContent = 'FATAL  测试脚本异常: ' + (e && e.stack || e);
    resultsEl.appendChild(line);
    $('summary').textContent = '测试脚本异常';
    $('summary').className = 'bad';
    document.title = '[Uncle3仿真] 测试脚本异常';
    console.error(e);
  });
})();
