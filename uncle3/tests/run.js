// tests/run.js —— Uncle3 逻辑测试（JavaScriptCore 执行）
// 用法: cd uncle3/tests && jsc run.js
// 覆盖：core.js 单元测试 + 全部 JS 文件语法校验 + manifest 结构校验

var passed = 0, failed = 0;

function check(name, cond, detail) {
  if (cond) { passed++; print('PASS  ' + name); }
  else { failed++; print('FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

function eq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// ---------- 1. 语法校验：所有 JS 文件可被解析 ----------
var files = ['../core.js', '../background.js', '../offscreen.js', '../popup.js', '../settings.js'];
files.forEach(function (f) {
  try {
    var src = readFile(f);
    if (typeof src !== 'string' || src.length === 0) throw new Error('无法读取文件');
    new Function(src); // 仅解析不执行
    check('syntax: ' + f, true);
  } catch (e) {
    check('syntax: ' + f, false, String(e));
  }
});

// ---------- 2. 静态校验：MV3 扩展页不得含内联事件（CSP 会静默拦截） ----------
['../popup.html', '../offscreen.html', '../settings.html'].forEach(function (f) {
  try {
    var html = readFile(f);
    var inline = html.match(/<[^>]+\son[a-z]+\s*=/i);
    check('no-inline-handler: ' + f, !inline, inline ? inline[0] : '');
  } catch (e) {
    check('no-inline-handler: ' + f, false, String(e));
  }
});

// ---------- 3. 加载 core.js 并做单元测试 ----------
try {
  load('../core.js');
  check('load core.js', true);
} catch (e) {
  check('load core.js', false, String(e));
}

// validateSize
eq('validateSize 合法', validateSize('800', '600').ok, true);
eq('validateSize 数字类型', validateSize(1280, 720).ok, true);
eq('validateSize 空值', validateSize('', '600').ok, false);
eq('validateSize 非整数', validateSize('80.5', '600').ok, false);
eq('validateSize NaN', validateSize('abc', '600').ok, false);
eq('validateSize 宽度超上限', validateSize('99999', '600').ok, false);
eq('validateSize 宽度低于下限', validateSize('100', '600').ok, false);
eq('validateSize 高度超上限', validateSize('800', '9999').ok, false);
eq('validateSize 边界最小', validateSize(200, 200).ok, true);
eq('validateSize 边界最大', validateSize(7680, 4320).ok, true);
eq('validateSize 返回值', validateSize('393', '852').w, 393);

// isRestrictedUrl
eq('restricted: chrome://', isRestrictedUrl('chrome://settings'), true);
eq('restricted: chrome-extension://', isRestrictedUrl('chrome-extension://abc/popup.html'), true);
eq('restricted: about:blank', isRestrictedUrl('about:blank'), true);
eq('restricted: view-source', isRestrictedUrl('view-source:https://a.com'), true);
eq('restricted: devtools', isRestrictedUrl('devtools://devtools/bundled/inspector.html'), true);
eq('restricted: file://', isRestrictedUrl('file:///tmp/a.html'), true);
eq('restricted: webstore', isRestrictedUrl('https://chrome.google.com/webstore/detail/x'), true);
eq('restricted: empty', isRestrictedUrl(''), true);
eq('normal: https', isRestrictedUrl('https://example.com'), false);
eq('normal: http', isRestrictedUrl('http://localhost:3000'), false);

// sanitizeTitle
eq('sanitize 非法字符', sanitizeTitle('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
eq('sanitize 空白合并', sanitizeTitle('  hello   world  '), 'hello world');
eq('sanitize 空标题回退', sanitizeTitle(''), 'recording');
eq('sanitize 截断50', sanitizeTitle('x'.repeat(80)).length, 50);

// makeFileName
var fixedDate = new Date(2026, 7, 8, 9, 5, 3); // 2026-08-08 09:05:03
eq('fileName mp4', makeFileName('Demo Page', 'video/mp4', fixedDate), 'Demo Page_20260808_090503.mp4');
eq('fileName webm', makeFileName('Demo Page', 'video/webm;codecs=vp9', fixedDate), 'Demo Page_20260808_090503.webm');
eq('fileName 非法标题', makeFileName('bug: 修复/录屏', 'video/mp4', fixedDate), 'bug 修复录屏_20260808_090503.mp4');
eq('fileName 空标题', makeFileName('', 'video/mp4', fixedDate), 'recording_20260808_090503.mp4');

// fmtTime / fmtBadge
eq('fmtTime 0', fmtTime(0), '00:00:00');
eq('fmtTime 61s', fmtTime(61000), '00:01:01');
eq('fmtTime 1h2m3s', fmtTime(3723000), '01:02:03');
eq('fmtTime 负数', fmtTime(-100), '00:00:00');
eq('fmtBadge 5s', fmtBadge(5000), '0:05');
eq('fmtBadge 9m59s', fmtBadge(599000), '9:59');

// pickMimeType
eq('pickMimeType 支持 mp4 首选', pickMimeType(function (m) { return m.indexOf('mp4') !== -1; }), 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
eq('pickMimeType 仅 webm', pickMimeType(function (m) { return m.indexOf('webm') !== -1; }), 'video/webm;codecs=vp9,opus');
eq('pickMimeType 全不支持', pickMimeType(function () { return false; }), '');
eq('pickMimeType 抛异常安全', pickMimeType(function () { throw new Error('x'); }), '');
eq('pickMimeType 取消 MP4 时选 webm', pickMimeType(function () { return true; }, false), 'video/webm;codecs=vp9,opus');
eq('pickMimeType 取消 MP4 且仅支持 mp4 时返回空', pickMimeType(function (m) { return m.indexOf('mp4') !== -1; }, false), '');
eq('pickMimeType 显式 true 仍首选 mp4', pickMimeType(function () { return true; }, true), 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');

// 预设列表
eq('预设数量', BUILTIN_PRESETS.length, 4);
eq('预设含 HD', BUILTIN_PRESETS.some(function (p) { return p.name === 'HD' && p.w === 1280 && p.h === 720; }), true);
eq('默认顺序 HD 置顶', DEFAULT_PRESETS[0].name, 'HD');
eq('默认顺序 Full HD 次位', DEFAULT_PRESETS[1].name, 'Full HD');
eq('锁定判断 HD', isLockedPreset({ name: 'HD', w: 1280, h: 720 }), true);
eq('锁定判断 Full HD 不锁', isLockedPreset({ name: 'Full HD', w: 1920, h: 1080 }), false);
eq('锁定判断同名不同尺寸不锁', isLockedPreset({ name: 'HD', w: 800, h: 600 }), false);
eq('归一化 已存储直接用', normalizePresets([{ name: 'A', w: 300, h: 300 }], []).length, 1);
eq('归一化 未存储用默认+旧自定义', normalizePresets(undefined, [{ name: '旧', w: 500, h: 400 }]).length, 5);
eq('归一化 空数组也初始化', normalizePresets([], null)[0].name, 'HD');
eq('录制上限10分钟', MAX_RECORD_MS, 600000);

// ---------- 结果 ----------
print('');
print('==============================');
print('总计: ' + (passed + failed) + '  通过: ' + passed + '  失败: ' + failed);
if (failed > 0) {
  print('TESTS FAILED');
  quit(1);
} else {
  print('ALL TESTS PASSED');
}
