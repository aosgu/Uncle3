#!/usr/bin/env node
// test-all.js —— Uncle3 全量自动化测试套件
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let totalPassed = 0;
let totalFailed = 0;

function runUnitTests() {
  console.log('\n========================================');
  console.log('1. 单元测试与静态语法校验 (core.js + run.js)');
  console.log('========================================');

  let uPassed = 0, uFailed = 0;
  const sandbox = {
    console,
    readFile: f => fs.readFileSync(path.resolve(__dirname, 'uncle3/tests', f), 'utf-8'),
    print: msg => {
      if (msg.startsWith('PASS')) { uPassed++; totalPassed++; }
      else if (msg.startsWith('FAIL')) { uFailed++; totalFailed++; }
      console.log(msg);
    },
    quit: c => { if (c !== 0) process.exit(c); },
    load: () => {}
  };

  const context = vm.createContext(sandbox);
  const coreCode = fs.readFileSync(path.resolve(__dirname, 'uncle3/core.js'), 'utf-8');
  const runCode = fs.readFileSync(path.resolve(__dirname, 'uncle3/tests/run.js'), 'utf-8');
  vm.runInContext(coreCode + '\n;' + runCode, context);

  return { passed: uPassed, failed: uFailed };
}

async function runDomSimulation(relPath, title, timeoutMs = 25000) {
  console.log('\n========================================');
  console.log(title + ' (' + relPath + ')');
  console.log('========================================');

  const filePath = path.resolve(__dirname, relPath);
  const html = fs.readFileSync(filePath, 'utf-8');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'file://' + filePath,
    beforeParse(window) {
      window.URL.createObjectURL = () => 'blob:sim-test-url';
      window.URL.revokeObjectURL = () => {};
      if (!window.navigator.mediaDevices) {
        window.navigator.mediaDevices = {};
      }
    }
  });

  return new Promise(resolve => {
    let timeoutTimer;
    let checkTimer;

    const cleanup = () => {
      if (checkTimer) clearInterval(checkTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };

    checkTimer = setInterval(() => {
      const isDone = dom.window.__simDone ||
        (dom.window.document.title && (dom.window.document.title.includes('ALL') || dom.window.document.title.includes('FAILED')));

      if (isDone) {
        cleanup();
        const summary = dom.window.document.getElementById('summary');
        const summaryText = summary ? summary.textContent : dom.window.document.title;
        console.log('\n' + summaryText);
        const fails = dom.window.document.querySelectorAll('#results .fail, #results .bad');
        const failCount = fails.length;
        const passCount = dom.window.document.querySelectorAll('#results .pass, #results .ok').length;
        totalPassed += passCount;
        totalFailed += failCount;
        resolve({ passed: passCount, failed: failCount });
      }
    }, 100);

    timeoutTimer = setTimeout(() => {
      cleanup();
      console.log('\n[TIMEOUT] 测试执行超时 (' + timeoutMs + 'ms)');
      totalFailed += 1;
      resolve({ passed: 0, failed: 1 });
    }, timeoutMs);
  });
}

(async () => {
  try {
    runUnitTests();
    await runDomSimulation('uncle3/tests/sim.html', '2. 端到端集成仿真测试 (sim.html)');
    await runDomSimulation('uncle3/tests/sim-settings.html', '3. 设置页仿真测试 (sim-settings.html)');
    await runDomSimulation('uncle3/tests/manual-offscreen.html', '4. Offscreen 执行体独立测试 (manual-offscreen.html)');

    console.log('\n========================================');
    console.log(`全量测试汇总: 总计 ${totalPassed + totalFailed} 项断言 | 通过: ${totalPassed} | 失败: ${totalFailed}`);
    console.log('========================================\n');

    process.exit(totalFailed > 0 ? 1 : 0);
  } catch (err) {
    console.error('测试运行异常:', err);
    process.exit(1);
  }
})();
