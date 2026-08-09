// core.js —— Uncle3 共享纯逻辑（popup / background / offscreen 与测试共用）
// 不依赖任何 chrome.* API，保证可被 jsc 单测直接加载。

const SIZE_MIN = 200;
const SIZE_MAX_W = 7680;
const SIZE_MAX_H = 4320;
const MAX_RECORD_MS = 10 * 60 * 1000; // 单次录制上限 10 分钟

// 默认预设顺序（v1.3 起 HD / Full HD 置顶），作为未自定义排序时的初始列表
const DEFAULT_PRESETS = [
  { name: 'HD', w: 1280, h: 720 },
  { name: 'Full HD', w: 1920, h: 1080 },
  { name: 'iPhone 14 Pro', w: 393, h: 852 },
  { name: 'iPad Mini', w: 768, h: 1024 }
];

// 兼容旧测试：BUILTIN_PRESETS 已合并至 DEFAULT_PRESETS，保留别名避免外部引用报错
const BUILTIN_PRESETS = DEFAULT_PRESETS;

/**
 * 锁定预设：仅 HD 不可删除/重命名（v1.3 需求）
 */
function isLockedPreset(p) {
  return !!p && p.name === 'HD' && p.w === 1280 && p.h === 720;
}

function presetKey(p) { return p.w + 'x' + p.h; }

/**
 * 归一化预设列表（v1.3 起 popup/设置页共用统一列表，顺序即展示顺序）。
 * stored：新键 presets；legacyCustom：旧键 customPresets（v1.2 及以前保存的自定义预设）。
 * 首次使用或键缺失时，以默认顺序初始化并合入旧自定义预设；
 * 合入时按尺寸（presetKey）去重，避免旧版自定义过与内置同尺寸时出现重复条目。
 */
function normalizePresets(stored, legacyCustom) {
  if (Array.isArray(stored) && stored.length > 0) return stored.slice();
  const legacy = Array.isArray(legacyCustom) ? legacyCustom : [];
  const base = DEFAULT_PRESETS.map(p => ({ name: p.name, w: p.w, h: p.h }));
  const seen = base.map(p => presetKey(p));
  const extras = [];
  legacy.forEach(p => {
    const k = presetKey(p);
    if (seen.indexOf(k) < 0) {
      seen.push(k);
      extras.push({ name: p.name, w: p.w, h: p.h });
    }
  });
  return base.concat(extras);
}

function validateSize(w, h) {
  if (w === '' || h === '' || w === null || w === undefined || h === null || h === undefined) {
    return { ok: false, reason: '请输入宽度和高度' };
  }
  const wn = Number(w), hn = Number(h);
  if (!Number.isInteger(wn) || !Number.isInteger(hn)) {
    return { ok: false, reason: '宽高必须为整数' };
  }
  if (wn < SIZE_MIN || wn > SIZE_MAX_W) {
    return { ok: false, reason: `宽度超出范围（${SIZE_MIN}–${SIZE_MAX_W}）` };
  }
  if (hn < SIZE_MIN || hn > SIZE_MAX_H) {
    return { ok: false, reason: `高度超出范围（${SIZE_MIN}–${SIZE_MAX_H}）` };
  }
  return { ok: true, w: wn, h: hn };
}

/**
 * 判断标签页 URL 是否为 tabCapture 不可捕获的受限页面（Chrome 权限与安全策略限制）
 */
function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedSchemes = [
    'chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-untrusted:',
    'edge:', 'about:', 'view-source:', 'devtools:', 'file:'
  ];
  if (restrictedSchemes.some(s => url.startsWith(s))) return true;
  if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url)) return true;
  return false;
}

function sanitizeTitle(title, maxLen) {
  maxLen = maxLen || 50;
  let safe = String(title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .trim();
  // Windows 不允许文件名以空格或点结尾
  safe = safe.replace(/[. ]+$/g, '');
  // 保留名 CON/PRN/AUX/NUL/COM1-9/LPT1-9 按文件系统会冲突，统一回退
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(safe)) safe = '';
  return safe || 'recording';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 生成下载文件名：{页面标题}_{yyyyMMdd_HHmmss}.mp4|webm
 */
function makeFileName(title, mime, date) {
  const d = date || new Date();
  const stamp = '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
    '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  const ext = /mp4/i.test(String(mime || '')) ? 'mp4' : 'webm';
  return sanitizeTitle(title) + '_' + stamp + '.' + ext;
}

function fmtTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

/**
 * 徽标文字：m:ss（Chrome action 徽标最多显示约 4 字符，超 9 分钟不截断直接显示实际分秒）
 */
function fmtBadge(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + pad2(s);
}

/**
 * 按优先级挑选 MediaRecorder mimeType。
 * 现代 Chromium（Chrome 126+）优先使用 MP4 (H.264/AAC) 直出；
 * 环境不支持或用户取消「导出 MP4」时降级为 WebM (VP9/VP8)。
 */
function pickMimeType(isSupportedFn, preferMp4) {
  const webm = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  const candidates = preferMp4 === false ? webm : [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4'
  ].concat(webm);
  for (const c of candidates) {
    try {
      if (isSupportedFn(c)) return c;
    } catch (e) { /* 忽略 */ }
  }
  return '';
}
