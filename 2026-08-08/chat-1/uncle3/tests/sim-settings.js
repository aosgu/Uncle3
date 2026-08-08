// tests/sim-settings.js —— 设置页集成仿真脚本
// 在 mock chrome.storage 环境下驱动真实的 settings.js，覆盖帧率选项与预设编辑/删除

(function () {
  const sim = window.__simS;
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
  const rows = () => document.querySelectorAll('#presetList .p-row');
  const btnByText = (row, text) => [...row.querySelectorAll('button')].find(b => b.textContent === text);
  const rowByName = name => [...rows()].find(r => r.querySelector('.p-name').textContent === name);

  // 模拟 HTML5 拖拽：从源行拖到目标行的前半（before）或后半（after）
  function dragTo(sourceRow, targetRow, before) {
    sourceRow.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    const rect = targetRow.getBoundingClientRect();
    const y = before ? rect.top + 2 : rect.bottom - 2;
    targetRow.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: y }));
    targetRow.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: y }));
    sourceRow.dispatchEvent(new Event('dragend', { bubbles: true }));
  }

  async function run() {
    await sleep(200); // 等待 settings.js init 完成

    // ---------- S1 初始状态（统一列表，HD/Full HD 置顶） ----------
    check('S1 帧率选项默认不勾选', $('fpsChk').checked === false);
    check('S1 渲染 6 条预设', rows().length === 6, 'rows=' + rows().length);
    check('S1 HD 置顶', rows()[0].querySelector('.p-name').textContent === 'HD');
    check('S1 Full HD 次位', rows()[1].querySelector('.p-name').textContent === 'Full HD');
    check('S1 HD 锁定无编辑/删除', !btnByText(rows()[0], '编辑') && !btnByText(rows()[0], '删除'));
    check('S1 HD 内置标识', !!rows()[0].querySelector('.p-lock'));
    check('S1 非锁定预设有编辑/删除', !!btnByText(rows()[1], '编辑') && !!btnByText(rows()[1], '删除'));

    // ---------- S2 帧率选项持久化 ----------
    $('fpsChk').checked = true;
    $('fpsChk').dispatchEvent(new Event('change'));
    await sleep(60);
    check('S2 勾选后持久化 fixedFps30=true', sim.store.fixedFps30 === true);
    $('fpsChk').checked = false;
    $('fpsChk').dispatchEvent(new Event('change'));
    await sleep(60);
    check('S2 取消后持久化 fixedFps30=false', sim.store.fixedFps30 === false);

    // ---------- S3 编辑内置预设名称（Full HD 可改） ----------
    btnByText(rows()[1], '编辑').click();
    await sleep(60);
    const editInput = $('editName');
    check('S3 进入编辑态', !!editInput && editInput.value === 'Full HD');
    editInput.value = '全高清';
    btnByText(rows()[1], '保存').click();
    await sleep(80);
    check('S3 重命名已持久化', sim.store.presets[1].name === '全高清', JSON.stringify(sim.store.presets[1]));
    check('S3 新名称已回显', rows()[1].querySelector('.p-name').textContent === '全高清');

    // ---------- S4 空名称拦截 ----------
    btnByText(rows()[1], '编辑').click();
    await sleep(60);
    $('editName').value = '   ';
    btnByText(rows()[1], '保存').click();
    await sleep(60);
    check('S4 空名称 toast 拦截', $('toast').textContent.indexOf('不能为空') !== -1, $('toast').textContent);
    check('S4 仍停留在编辑态', !!$('editName'));

    // ---------- S5 取消编辑 ----------
    btnByText(rows()[1], '取消').click();
    await sleep(60);
    check('S5 取消退出编辑态', !$('editName'));
    check('S5 名称未变', sim.store.presets[1].name === '全高清');

    // ---------- S6 删除预设（自定义） ----------
    btnByText(rowByName('演示尺寸'), '删除').click();
    await sleep(80);
    check('S6 删除已持久化', sim.store.presets.length === 5,
      JSON.stringify(sim.store.presets.map(p => p.name)));
    check('S6 列表剩 5 条', rows().length === 5);
    check('S6 删除 toast', $('toast').textContent.indexOf('已删除预设') !== -1, $('toast').textContent);

    // ---------- S7 拖拽排序（直播窗口 → 置顶） ----------
    dragTo(rowByName('直播窗口'), rows()[0], true);
    await sleep(80);
    check('S7 拖拽后置顶生效', sim.store.presets[0].name === '直播窗口',
      JSON.stringify(sim.store.presets.map(p => p.name)));
    check('S7 列表顺序同步渲染', rows()[0].querySelector('.p-name').textContent === '直播窗口');
    check('S7 拖拽 toast', $('toast').textContent.indexOf('已调整预设顺序') !== -1, $('toast').textContent);

    // ---------- S8 拖到中间位置（iPad Mini → 第 2 位之后） ----------
    dragTo(rowByName('iPad Mini'), rows()[1], false);
    await sleep(80);
    check('S8 插入位置正确', sim.store.presets[2].name === 'iPad Mini',
      JSON.stringify(sim.store.presets.map(p => p.name)));

    // ---------- S9 删空可删预设后仍有内置 ----------
    while (true) {
      const del = [...rows()].map(r => btnByText(r, '删除')).find(b => b);
      if (!del) break;
      del.click();
      await sleep(60);
    }
    await sleep(80);
    check('S9 仅剩内置 HD', sim.store.presets.length === 1 && sim.store.presets[0].name === 'HD',
      JSON.stringify(sim.store.presets));
    check('S9 HD 无法被删除入口', !btnByText(rows()[0], '删除'));

    // ---------- 汇总 ----------
    const summary = $('summary');
    summary.textContent = '总计: ' + (passed + failed) + '  通过: ' + passed + '  失败: ' + failed +
      (failed ? '  —— TESTS FAILED' : '  —— ALL TESTS PASSED');
    summary.className = failed ? 'bad' : 'ok';
    document.title = '[Uncle3设置页仿真] ' + summary.textContent;
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
    document.title = '[Uncle3设置页仿真] 测试脚本异常';
    console.error(e);
  });
})();
