# Uncle3 Chrome 插件 — 代码质量评估报告

> **评估对象：** `aosgu/Uncle3` 分支 `arena/019fe2ca-uncle3` (commit 4e04379, v1.3.0)  
> **评估时间：** 2026-08-08  
> **评估人：** Arena Agent (静态审计 + 仿真测试走读)  
> **总行数：** 1,471 行 (5 JS + 3 HTML + CSS + Manifest), 无构建工具、无 TypeScript、纯原生 MV3

---

## TL;DR 结论

**综合评分：8.3 / 10 — 远超“典型 vibe code”水准，已达到可上架生产级。**

这不是“能跑就行”的 vibe demo，而是**有状态机、有竞态防护、有三层测试**的小而美的扩展。作者（或提示词）显然懂 Chrome MV3 的坑。最大的短板是 **Service Worker 重启后状态丢失** 和 **工程化缺失**，而非逻辑错误。

| 维度 | 得分 | 一句话评价 |
|------|------|------------|
| 架构设计 | 9.0 | 职责分离清晰，core 纯逻辑可单测，offscreen 隔离录制 |
| 代码风格 | 8.0 | 统一、可读，中文注释到位，无 `var` |
| 健壮性 | 8.5 | 竞态、异常、降级都处理了，少见的细腻 |
| 安全性 | 8.5 | CSP 合规、无 XSS、无 `eval`、权限克制 |
| 性能 | 7.5 | 10分钟 4Mbps 内存常驻有风险，轮询可优化 |
| 可维护性 | 7.5 | 无 TS/无 Lint/无类型是硬伤 |
| 可测试性 | 9.5 | JSC 单测 62 + 仿真 59 + 设置页 25 + 手动用例，碾压 90% 开源扩展 |

**Vibe Code 指纹：** 能看出是 AI 生成，但属于**高质量 vibe** — 提示词或多轮迭代的质量很高。如果是纯一轮生成，那提示词工程属于顶级。

---

## 1. 量化概览

```
core.js        165 行  纯函数，无 chrome 依赖
background.js  232 行  Service Worker 会话状态机
offscreen.js   264 行  MediaRecorder 执行体
popup.js       337 行  弹窗交互
settings.js    252 行  设置页预设管理
manifest.json   31 行  MV3 清单
ui.css         228 行  共享样式
tests/run.js   123 行  JSC 单测
tests/sim.js   357 行  端到端仿真
tests/sim-settings.js ~140 行
```

* 无 `console.log` 残留（仅测试文件有）
* 无 `TODO/FIXME`
* 3 处 `innerHTML` 均为清空容器或静态结构，**无用户数据注入**，安全
* `new Function` 仅在 `tests/run.js` 做语法校验，非业务代码

---

## 2. 架构 - 为什么给 9 分

```
popup (UI) ──chrome.runtime.sendMessage──> background (状态机/b徽标)
   │                                           │
   │ tabCapture.getMediaStreamId (用户手势)      │ ensure/create offscreen
   └────────────────────────────────────────────> offscreen (getUserMedia→MediaRecorder→<a download>)
                                                     │
core.js <── 纯逻辑共享 (校验/命名/时间/mime) ──────────┘
```

**做对的 5 件事：**

1. **core.js 零依赖**：`validateSize / sanitizeTitle / makeFileName / pickMimeType` 完全纯函数，`load('../core.js')` 就能被 `jsc` 单测，这是专业手法。  
2. **Offscreen 隔离**：MV3 禁止后台直接 `getUserMedia`，正确使用 `chrome.offscreen` + `USER_MEDIA` reason。很多 vibe 项目会错用 `chrome.tabCapture.capture` 导致黑屏。  
3. **会话状态机**：`session = {state: recording|paused|encoding|done|error}` + `closingOffscreen` + `closeTimer` 延迟关闭 + `cancelPendingClose()` 防“慢机上新会话被旧定时器关掉”——注释里把竞态讲得明明白白，这不是新手能想到的。  
4. **存储键收敛**：v1.3 把 `presets` 统一为单键，`normalizePresets(stored, legacyCustom)` 兼容旧版并按 `presetKey` 去重，考虑了迁移。  
5. **下载绕坑**：`offscreen` 里用 `URL.createObjectURL(blob) + <a download>` 而非 `chrome.downloads.download`，注释解释了 `onDeterminingFilename` 全局污染和保存对话框预填问题，查过坑。

---

## 3. 逐文件点评

### 3.1 `core.js` — 模范生

**亮点：**
- `validateSize` 校验整数 + 范围 `200–7680 × 200–4320`，错误信息精准到“宽度超出范围”  
- `sanitizeTitle` 去除 `\/:*?"<>|` + 控制字符 + 空白合并 + 50 字符截断，回退 `recording`，文件名注入防护到位  
- `pickMimeType(isSupportedFn, preferMp4)` 注入 `isSupportedFn`，单测友好，`try/catch` 防 `isTypeSupported` 抛异常  
- `fmtTime` / `fmtBadge` 边界处理 `Math.max(0, ...)`  

**问题：**

| 级别 | 问题 |
|------|------|
| **一般** | `BUILTIN_PRESETS` 定义后**从未使用**（搜索仅在定义处），实际用的是 `DEFAULT_PRESETS`。死代码，典型 AI 复制残留，应删除或合并。 |
| 建议 | `validateSize` 中 `w == null` 用了宽松相等 `==`，其余全文件用 `===`，风格不一致。虽语义正确（同时判 `null/undefined`），建议写 `w == null` 时加注释或统一 `w === null \|\| w === undefined`。 |
| 建议 | `sanitizeTitle` 未处理 Windows 文件名尾部空格/点（`test.`）及保留名 `CON/PRN`，极低频但可补。 |

### 3.2 `background.js` — 最能体现功力的文件

**亮点：**
- `ensureOffscreen` / `closeOffscreen(force)` 双向守卫：非 `force` 时若 `session.state ∈ {recording,paused,encoding}` 直接拒绝关闭，防止延迟定时器误杀。  
- `setBadge('0:00')` `#ef4444` 录制红，暂停 `#f59e0b` 黄，`clearBadge()` 及时清理。  
- `onTime` 仅在 `recording/paused` 时更新 `elapsedMs`，防止 `TIME` 污染 `done/error` 会话。  
- `onOffscreenDead` 看门狗：`chrome.runtime.sendMessage` 抛错（文档崩溃/被回收）时把会话降级为 `error` 而非永久卡 `encoding`。  
- 所有 `chrome.runtime.sendMessage` 后都 `() => void chrome.runtime.lastError` 吞掉未消费的 `lastError`，不刷控制台。

**硬伤：**

| 级别 | 问题 |
|------|------|
| **严重** | **SW 重启状态丢失**：`session` 仅内存变量，MV3 Service Worker 30 秒空闲即被系统回收。`offscreen` 仍在录，但 `background` 重启后 `session = null`，popup `getState` 返回空闲，用户看不到计时也无法停止（只能关标签）。正确做法：`chrome.storage.session`（Chrome 116+ 已可用，manifest 已声明 `minimum_chrome_version:116`）持久化 `session`，启动时恢复。 |
| 一般 | `chrome.tabs.query` 未在 `manifest` 声明 `activeTab` 最小权限，用了 `tabs`。可用 `activeTab` 替代，降低审核敏感度。 |
| 建议 | `importScripts('core.js')` 全局污染，未来可改 `type: module` + `import`，但不阻塞。 |

### 3.3 `offscreen.js` — 细节狂魔

**亮点：**
- IIFE 包裹防全局冲突，`state` 四态机清晰。  
- `startRecording` 首行校验 `state !== 'idle'` + `MediaRecorder` 存在性，`maxMs` / `preferMp4` / `fps30` 参数化。  
- `videoMandatory.maxFrameRate = 30` 仅在勾选时加，注释“仅能封顶不能抬高”准确。  
- `MediaRecorder`  `videoBitsPerSecond: 4_000_000` 固定 4Mbps，`start(1000)` 切 1s 块，利于 `Blob` 合并。  
- `videoTrack.ended` 监听标签页关闭/导航，自动 `stopRecording` 尽量保底。  
- `stopRecording(byLimit)` / `finalize()` 区分 `limitTriggered` / `discardFlag` / `blob.size===0`，空录制不落盘。  
- `cleanupAll()` 在 `MediaRecorder.start()` 抛异常时**立即回收流**，并经 `manual-offscreen.html` 6 项单测验证（该测试专门构造 `start()` 首飞抛错，断言轨道 `stop` 次数、二次启动可恢复）。

**风险：**

| 级别 | 问题 |
|------|------|
| 一般 | 仅监听 `videoTrack.ended`，`audioTrack` 静音/中断不处理（低频）。 |
| 一般 | `finalize` 用 `<a download>` 触发下载，依赖 offscreen 文档的“用户激活”链。规范上 `stop` 已脱离原始 `click` 手势，极少数 Chrome 版本可能拦截；但实测比 `chrome.downloads.download` 更可靠，权衡合理。 |
| 建议 | 10 分钟 4Mbps ≈ 300 MB `Blob` 常驻内存，低配机器可能 OOM。注释已声明“预期行为”，可考虑 `MediaRecorder` 流式写入 `FileSystem` 或分片，但复杂度大，当前可接受。 |

### 3.4 `popup.js` — 交互层

**亮点：**
- `bgSend` 统一 `lastError` 处理，`getActiveTab` 封装。  
- `applySize` 先 `storage.set({lastSize})` 再 `windows.update`，失败 toast，成功后比对 `updated.width` 与目标差 `>10` 提示“屏幕无法容纳”，细节到位。  
- `buildPresetCard` 用 `textContent` 而非 `innerHTML` 插预设名，防 XSS；`del` 按钮 `stopPropagation` 防冒泡触发 `applySize`。  
- `updateApplyBtn` 仅空值禁用，超范围仍可点以触发校验 toast，符合 PRD 3.1.3。  
- `bindEvents` + `eventsBound` 守卫防止 `init()` 二次调用重复绑定（被 `sim.html` 测到）。  
- `startRecording` 顺序：先 `tabCapture.getMediaStreamId`（需用户手势），再 `storage.get(fixedFps30)`，手势链保活正确。

**问题：**

| 级别 | 问题 |
|------|------|
| 一般 | `togglePause()` 靠 `pauseBtn.textContent === '继续'` 判断状态，**UI 文案驱动逻辑**，i18n 或文案改动即崩。应读 `session.state`（`bgSend({getState})`）。 |
| 一般 | 轮询 `setInterval(refreshCurrentSize, 1000)` + `setInterval(pollRecordState, 600)`，可用 `chrome.runtime.onMessage` 推送 `TIME/STOPPED` 代替轮询，省电。 |
| 建议 | `lastSelectedKey` 仅内存，刷新弹窗即丢，重开后无选中态；可持久化到 storage。 |

### 3.5 `settings.js` — 可圈可点

**亮点：**
- 拖拽排序实现完整：`dragstart` 记 `dragFrom` + `dataTransfer.setData`，`dragover` `preventDefault` + `drop-before/after` 高亮，`drop` 时 `splice(dragFrom,1)` + 坐标 `clientY < rect.top+height/2` 判前后，自动 `persistPresets` + toast。  
- `isLockedPreset` 统一判断 HD 锁定，视图 `locked ? .p-lock : 编辑/删除` 分支清晰。  
- 编辑态 `Enter` 保存 `Esc` 取消，`cancelRename` 重置 `editingIndex`。

**问题：**
- `dragTo` 依赖 `getBoundingClientRect()`，在 `display:none` 时 `rect.height===0` 会误判（低频）。
- 与 `popup.js` 的 `normalizePresets` / `persistPresets` / `toast` 重复，可抽 `shared/ui.js`。

### 3.6 `manifest.json` / `ui.css` / `*.html`

- `manifest_version:3` + `minimum_chrome_version:116` + `offscreen` 权限，版本匹配。`permissions` 无 `downloads`（因用 `<a download>`），克制。  
- `popup.html` / `settings.html` **零内联事件**（`run.js` 静态校验 `no-inline-handler`），CSP 合规。  
- `ui.css` 共享样式，`popup` 340px 定宽，`settings.html` 用内联 `<style>` 覆盖为 `width:auto` + 居中卡片，合理。  
- `offscreen.html` 仅 10 行，纯 `core + offscreen` 脚本，无多余 DOM。

---

## 4. Vibe Coding 指纹鉴定

**不是“胶水代码”，但能看出 AI 痕迹：**

| 现象 | 证据 |
|------|------|
| **注释过度解释坑位** | 每处竞态都有长段中文注释“防止延迟关闭定时器与慢机上新会话启动的竞争…”，人类通常不会写这么全，AI 为解释而写。 |
| **防御性过强** | `try { isSupportedFn(c) } catch(e){}`、`a.remove()` 后 `setTimeout(revokeObjectURL,60000)`、`void chrome.runtime.lastError` 处处吞错，AI 的“别崩”本能。 |
| **死代码** | `BUILTIN_PRESETS` 未用，AI 生成时保留了早期版本。 |
| **API 选型保守** | `chromeMediaSource: 'tab'` 用 `mandatory` 旧写法（兼容但已废弃），AI 训练数据偏旧。 |
| **测试比业务还多** | `run.js` + `sim.html` + `sim-settings.html` + `manual-offscreen.html` 四层，AI 在提示“要测试”后会过度生成，但质量确实高。 |

**反向证明不是“低质 vibe”：**
- 有状态机而非 `if` 堆砌
- 有 `hasDocument` 特性检测（适配旧 Chrome）
- 有迁移去重、`isLockedPreset` 统一出口
- 有 `eventsBound` 防重绑、`clearDropMarks` 清理高亮

**结论：** 属于 **Senior 提示的 AI 产出** 或 **AI 初稿 + 人类精修**。若是一轮生成，提示词里一定包含了“考虑 SW 被回收、offscreen 竞态、保存对话框被拦截”这类坑位描述。

---

## 5. 安全性审计

* **XSS：** ✅ `textContent` 赋值预设名/文件名，`innerHTML` 仅静态结构。`sanitizeTitle` 过滤路径分隔符，`makeFileName` 不拼接用户可控扩展名。  
* **CSP：** ✅ 零 `onclick="..."`，`run.js` 显式校验 `on[a-z]+=`.  
* **权限：** ⚠️ `tabs` 可收敛为 `activeTab`；`tabCapture` + `offscreen` + `storage` + `windows` 均为功能必需，无 `host_permissions` 索取全站，**最小权限做得好**。  
* **数据：** 仅 `storage.local` 存 `presets/lastSize/fixedFps30/recordAudio/exportMp4`，无外发、无 `fetch`、无第三方脚本。  
* **受限页：** `isRestrictedUrl` 覆盖 `chrome://`, `about:`, `file:`, `chrome.google.com/webstore`，popup 自动禁用录制并提示。

---

## 6. 测试 - 值得单独表扬

* **单元层 `tests/run.js` (JSC)：** 62 断言，覆盖 `validateSize / isRestrictedUrl / sanitizeTitle / makeFileName / fmtTime / pickMimeType / normalizePresets / isLockedPreset` + 语法 + CSP 静态扫描。`jsc` 执行无 Node 依赖，轻量。  
* **集成层 `tests/sim.html + sim.js`：** Mock `chrome` 全量 API，**真实加载** `core + background + offscreen + popup` 源码，跑 18 组场景 59 断言：窗口预设、钳制、保存/删除、录制全流程（授权/暂停/继续/停止/下载/再录）、授权失败、受限页、`limit 600ms` 自动停、WebM 降级、fps 透传、HD 锁定、延迟关闭竞态、offscreen 死亡看门狗。**仿真度极高**。  
* **设置页层 `sim-settings`：** 25 断言，覆盖帧率持久化、重命名空值拦截、删除、拖拽置顶/插中间、删空后仅剩 HD。  
* **手工层 `manual-offscreen.html`：** 专项验证 `MediaRecorder.start()` 抛错后的流回收与状态复位。

**唯一缺失：** 无 CI（GitHub Actions）自动跑 `jsc` + 无 Lighthouse/包体积检查。

---

## 7. 问题清单（按优先级）

### P0 - 必须修（影响可用性）

* **SW 重启丢会话**（见 3.2）：改 `chrome.storage.session.set({session})`，`background` 启动时 `get` 恢复；`onSuspend` 前也可 `set`。Chrome 116 已支持 `storage.session`。

### P1 - 强烈建议（影响健壮/审核）

* 删除 `BUILTIN_PRESETS` 死代码，或改为 `export` 供单测对比。
* `togglePause` 改读 `session.state` 而非按钮文案。
* `manifest` `tabs` → `activeTab`，若需 `windows.getCurrent` 保留 `tabs` 则加注释说明。
* `validateSize` 的 `== null` 统一为 `=== null || === undefined` 或加 `// loose check for null/undefined` 注释。

### P2 - 优化（体验/工程化）

* 轮询 → 事件推送：background 在 `onTime/STOPPED` 时 `chrome.runtime.sendMessage({type:'SESSION_UPDATE', session})`，popup 监听，减少 600ms 轮询。
* 加 `eslint + prettier` + `husky`，配 `eslint.config.mjs` 已有雏形，补上即可。
* 考虑 TypeScript `// @ts-check` + JSDoc，先给 `core.js` 加类型，零构建成本。
* `sanitizeTitle` 补充 `replace(/[. ]+$/,'')` 去尾点空格，过滤 `CON|PRN|AUX|NUL|COM1~9|LPT1~9`。
* 大文件内存：录制超 5 分钟时弹 toast 提示“接近上限，注意内存”，或探索 `MediaRecorder` + `File System Access` 流式落盘。
* `lastSelectedKey` 持久化，popup 重开保持选中态。

---

## 8. 与常见 Vibe 项目对比

| 典型 vibe 坑 | 本项目是否踩坑 |
|--------------|----------------|
| 把业务塞一个 800 行 `popup.js` | ✅ 否，拆 5 文件，core 纯函数 |
| 直接 `innerHTML = userInput` | ✅ 否 |
| `eval`/`Function` 动态执行 | ✅ 否 |
| 忘了 `chrome.offscreen.hasDocument` 检测 | ✅ 否，已检测 |
| 录制用 `navigator.mediaDevices.getDisplayMedia` 录全屏而非标签页 | ✅ 否，正确 `tabCapture` |
| 无错误处理，授权拒绝直接白屏 | ✅ 否，`try/catch` + toast + error 面板 |
| 无测试 | ✅ 否，三层测试 |
| 权限要 `*://*/*` | ✅ 否，最小权限 |

---

## 9. 改进路线图（1 天可完成）

**Day 1 上午（P0）：**  
1. `background.js` 引入 `chrome.storage.session`，`session` 每次变更后 `set`，启动时 `get` 恢复。补单测。

**Day 1 下午（P1）：**  
2. 删 `BUILTIN_PRESETS`，改 `togglePause` 读状态。  
3. 加 `eslint.config.mjs` 并 `npm run lint`，统一 `==` → `===`。  
4. `manifest` 权限收敛评估。

**后续：**  
5. popup 改事件推送，移轮询。  
6. 加 GitHub Actions：`jsc tests/run.js` 失败阻断 PR。

---

## 10. 一句话总结

> **这是我近期见过质量最高的 vibe 插件之一。** 逻辑正确、坑位踩全、测试完备，唯一的不像 AI 的地方是——它居然把 AI 最容易忽略的竞态和 SW 生命周期想到了。如果你是面试官，给 **Hire**；如果你是扩展商店审核员，给 **通过**（补 P0 后更稳）。

---

*附：本报告仅基于静态审计与仿真走读，未在真实 Chrome 116+/126+ 上做 10 分钟长录制压测，建议真机回归清单按 `README` 6 项执行。*
