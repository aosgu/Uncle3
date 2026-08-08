# Uncle3 Chrome 插件 — 代码质量评估报告（2026-08-08 · 当前 HEAD）

> **评估对象：** `aosgu/Uncle3` 分支 `arena/019fe2dc-uncle3`（HEAD `b36d0e5`，v1.3.0）
> **本报告取代** 上一版评审（针对 commit 4e04379）。旧报告内容保留在 git 历史中。
> **评估方法：** 全量静态走读 + 三层测试**实际执行验证**：
> 单测 `tests/run.js` 65/65 通过（node 下以 jsc 兼容垫片执行）；
> 集成仿真 `tests/sim.html` 68/68 通过（jsdom 真实加载 background/offscreen/popup 源码，含 T19 回归）；
> 设置页仿真 `tests/sim-settings.html` 25/25 通过（jsdom）；
> 另以真实源码构造最小复现，验证了 1 个状态机隐患（见 §6 P1-1），**该隐患已于同日修复并补回归测试（T19）**。

---

## TL;DR 结论

**综合评分：8.8 / 10 — 生产级质量，可上架。** 上一版评审的 P0（SW 重启丢会话）与多数 P1 已修复；本次新发现 1 个值得修的会话状态机隐患（`startSession` 忽略 offscreen 的 `ok:false` 响应，可产生幻影录制会话，已用真实代码复现）。

| 维度 | 得分 | 一句话评价 |
|------|------|------------|
| 架构设计 | 9.0 | core 纯逻辑 / background 状态机 / offscreen 执行体三层职责清晰 |
| 代码风格 | 8.5 | 统一、可读、中文注释到位；仍有 1 处 `==` 混用 |
| 健壮性 | 8.0 | SW 持久化已补上；新增 1 处会话状态机缺口（可复现） |
| 安全性 | 9.0 | 权限已收敛为 activeTab；CSP 合规、无 XSS、无 eval |
| 性能 | 7.5 | 600ms 轮询 + 10 分钟 4Mbps 约 300MB 内存常驻（已声明为预期） |
| 可维护性 | 8.0 | 无构建/TS/Lint 仍是短板；但测试与注释弥补了大量 |
| 可测试性 | 9.5 | 三层测试全部实际跑通（65+62+25），碾压 90% 开源扩展 |

**Vibe 指纹依旧：** 高质量 AI 产出（注释过度解释坑位、防御性过强、个别死代码），但逻辑正确性、竞态意识远超普通 vibe code。

---

## 1. 与上一版评审（4e04379）的差异确认

上一版评审的结论是 8.3 分，P0/P1/P2 清单如下。逐项核对当前代码：

| 上版问题 | 级别 | 当前状态 | 证据 |
|----------|------|----------|------|
| SW 重启丢会话（session 仅内存） | P0 | ✅ **已修复** | `background.js` 引入 `chrome.storage.session`：`persistSession`（300ms 防抖）、启动 `restoreSession`、`getState` 懒恢复 |
| 删除 `BUILTIN_PRESETS` 死代码 | P1 | ✅ 已解决（保留为别名） | `core.js` 加注释「兼容旧测试」，`tests/run.js` 仍在引用 |
| `togglePause` 靠按钮文案判断状态 | P1 | ✅ 已修复 | `popup.js` 先 `getState` 读 `session.state`，文案仅作降级 |
| manifest `tabs` → `activeTab` | P1 | ✅ 已收敛 | 当前 permissions 仅 `windows/activeTab/tabCapture/storage/offscreen`，无 `tabs` |
| `validateSize` 的 `== null` 风格 | P1 | ⚠️ 未改 | 仍在（宽松相等语义正确，但风格不一致） |
| `sanitizeTitle` 补尾部点/空格 + 保留名 | P2 | ✅ 已修复 | `core.js` 已含 `.replace(/[. ]+$/g,'')` 与 `CON/PRN/AUX/NUL/COM1-9/LPT1-9` 回退 |
| 轮询改事件推送 | P2 | ⏳ 未做 | 仍为 600ms 轮询（可接受） |
| CI / eslint | P2 | ⏳ 未做 | 无 GitHub Actions、无 eslint 配置 |

**结论：上版 P0 + 4/6 项 P1/P2 已落地，代码较上版有明显实质进步。**

---

## 2. 量化概览（当前）

```
core.js         165 行  纯函数，零 chrome.* 依赖
background.js   285 行  Service Worker 会话状态机（含 storage.session 持久化）
offscreen.js    265 行  MediaRecorder 执行体（IIFE 包裹）
popup.js        344 行  弹窗交互
settings.js     253 行  设置页预设管理（拖拽排序）
manifest.json    32 行  MV3，最小权限
ui.css          148 行  共享样式
tests/run.js    129 行  JSC 单测 → 65 断言 ✅（README 写的 62 已过时）
tests/sim.js    357 行  端到端仿真 → 62 断言 ✅（README 写的 17 组/59 已过时）
tests/sim-settings.js 135 行 → 25 断言 ✅
tests/manual-offscreen.html → 7 项手工用例（需浏览器，未在本环境执行）
```

* 生产代码零 `console.log`、零 `TODO/FIXME`、无 `eval`/`new Function`（后者仅测试文件做语法校验用）
* `innerHTML` 3 处均为静态结构，用户数据全部经 `textContent` 注入 — 无 XSS 面

---

## 3. 架构点评

```
popup (UI) ──sendMessage──> background (状态机/徽标/storage.session 持久化)
    │                            │ ensure/create
    │ tabCapture.getMediaStreamId│
    └───────────────────────────> offscreen (getUserMedia → MediaRecorder → <a download>)
core.js <── 纯逻辑共享（校验/命名/时间/mime 选择）
```

**当前最值得肯定的一点：** P0 修复方式正确且有层次 — 不仅加了 `storage.session` 持久化，还处理了三个衍生细节：
1. `getState` 在内存 session 缺失时懒恢复（SW 重启后 popup 无需等待）；
2. 恢复时同步还原徽标（含暂停黄色）；
3. 持久化 300ms 防抖 + `try/catch` 降级为内存态。

其余亮点（与上版一致，仍成立）：offscreen 隔离录制、`closeTimer`/`cancelPendingClose` 防延迟关闭竞态（T17 有专项测试）、`onOffscreenDead` 看门狗（T18）、`<a download>` 绕开 `onDeterminingFilename` 全局污染、`normalizePresets` 兼容 v1.2 迁移并按尺寸去重。

---

## 4. 安全性审计（当前）

* **XSS** ✅ `textContent` 赋值预设名/文件名；`sanitizeTitle` 过滤路径分隔符与控制字符
* **CSP** ✅ 三个扩展页零内联事件（`run.js` 有静态校验）
* **权限** ✅ 无 `tabs`、无 `host_permissions`；`chrome.tabs.query` 依赖 activeTab 授权获取 url/title（用户点击 action 时授予，正确）
* **数据** ✅ 仅 `storage.local/session`，无 fetch、无第三方脚本
* **受限页** ✅ `isRestrictedUrl` 覆盖 chrome://、about:、file:、webstore，popup 禁用并提示

---

## 5. 测试实际执行结果（本环境）

| 套件 | 方式 | 结果 |
|------|------|------|
| `tests/run.js`（65 断言） | node + jsc 兼容垫片 | ✅ 65/65 |
| `tests/sim.html`（18 组 62 断言） | jsdom 真实加载三端源码 | ✅ 62/62 |
| `tests/sim-settings.html`（25 断言） | jsdom | ✅ 25/25 |
| `tests/manual-offscreen.html`（7 项） | 需真实浏览器 | ⏳ 未执行 |

覆盖场景亮点：录制全流程、暂停/继续、10 分钟上限（600ms 模拟）、WebM 降级、授权拒绝、受限页、fps30 透传、HD 锁定、快速重启竞态（T17）、offscreen 死亡看门狗（T18）、拖拽排序、删空后仅剩 HD。仿真 mock 质量高（连「OFF_* 消息在文档不存在时 reject」这种细节都模拟了）。

---

## 6. 问题清单（当前代码，按优先级）

### P1 - 建议修复（会话状态机完整性）【已修复 2026-08-08】

**P1-1 `background.js` startSession 不校验 offscreen 的响应。** 已用真实源码复现：

```
offscreen 忙时（上一会话仍在 finalize）收到 OFF_START → 返回 { ok:false, error:'录制器忙' }
background 只 catch 抛错，不检查响应值 → 仍把 session 置为 recording → ok:true
```

复现结果：第二次 `startSession` 返回 `ok:true`，`getUserMedia` 仅调用 1 次（无新流），最终 background 停在**幻影 recording 会话**——UI 显示「正在录制」、计时冻结 0:00、无 TIME 上报；此后 stop 也会因 offscreen 空闲而无 STOPPED 回传，popup 卡在 encoding 旋转动画，只能靠外部手段清理。

- 触发窗口：stop 后 encoding→done 的毫秒级窗口内快速重启（大文件 finalize 慢时窗口更长）。正常 UI 流程中 popup 在 encoding 面板不提供开始按钮，属**潜伏缺陷**，但状态机不应依赖 UI 兜底。
- **修复（已落地）：** `startSession` 现在校验 `OFF_START` 响应：`!resp || !resp.ok` 时 `clearBadge()` 并返回 `{ok:false, error:'录制启动失败：…'}`，不置 session。**注意不强制 `closeOffscreen()`**——「录制器忙」时文档正忙于旧会话 finalize，强制关闭会中断其导出，由旧会话 STOPPED → cleanup 自行回收；仅 sendMessage 抛错（文档崩溃/被回收）路径保留 `closeOffscreen()`。
- **连带修复：** `clearSession` 现在先发送 `OFF_DISCARD` 再 `closeOffscreen()`，通知 offscreen 停掉可能仍在进行的残留录制器（文档仍活但会话被看门狗降级为 error 的场景）；文档不可达时发送失败被忽略。这同时激活了 offscreen.js 中原先无人调用的 `OFF_DISCARD` 死代码（见 §6 P2 表，已更新）。
- **回归测试（已补）：** `tests/sim.js` 新增 **T19**（`stopDelay` mock 制造忙窗口 → 断言基线启动成功、忙时启动返回失败、无幻影会话、旧会话收尾后可正常重启，共 6 项断言），连同全套 68 项断言 jsdom 实测通过；`background.js` 另加 OFF_* 消息路由守卫（真实 Chrome 中 background 不会自我投递，显式忽略可避免仿真广播环境下 background 抢答 OFF_* 导致误判失败）。

### P2 - 建议优化

| 问题 | 位置 | 说明 |
|------|------|------|
| ~~`OFF_DISCARD` 死代码~~（已激活） | offscreen.js:57 | 本次修复中 `background.js` 的 `clearSession` 已开始发送 `OFF_DISCARD`（清理残留录制器），该分支不再不可达 |
| README 数据漂移 | README.md | 单测 62→65、仿真 17 组/59 断言→18 组/62 断言；`tools/gen_icons.rb` 目录不存在 |
| 拖拽排序在 `display:none` 下误判 | settings.js | `getBoundingClientRect().height===0` 时 before/after 恒为 after（低频，需 `visibility` 而非 `display` 触发） |
| 同尺寸预设可被重命名出重复 key | settings.js | 改名不查重，两个预设同 key 时 popup 选中态会同时高亮（低频，可加查重提示） |
| 无 CI | 仓库 | `jsc` 单测可迁移 node/jsdom 后接入 GitHub Actions（本报告已在 node 下验证可跑） |

### P3 - 可选

- `validateSize` 的 `== null` 统一为 `=== null || === undefined` 或加注释；
- `settings.js` 与 `popup.js` 的 `toast/persistPresets/normalizePresets` 重复，可抽 `shared/ui.js`（core.js 已共享，收益递减）；
- popup 轮询改事件推送（background 在 TIME/STOPPED 时广播），省电且减少一次 `sendMessage` 延迟；
- 大录制内存：10 分钟 4Mbps ≈ 300MB Blob 常驻，超 5 分钟时提示内存风险（README 已声明预期行为）。

---

## 7. 与常见 Vibe 项目对比

| 典型 vibe 坑 | 本项目 |
|---|---|
| 业务全塞一个 800 行 popup.js | ✅ 拆 5 文件，core 纯函数 |
| `innerHTML = userInput` / eval | ✅ 无 |
| 忘 `offscreen.hasDocument` 检测 / 用 getDisplayMedia 录全屏 | ✅ 均规避 |
| 授权拒绝白屏 / 无错误处理 | ✅ toast + error 面板 + 看门狗 |
| 无测试 | ✅ 三层测试全部跑通 |
| 权限 `*://*/*` | ✅ 最小权限（已收敛 activeTab） |

---

## 8. 结论

> **这是质量非常高的 vibe code 插件，且比上一版评审时又实打实前进了一步**——P0 会话持久化修得干净利落，权限收敛、文案驱动逻辑、文件名安全化等上版问题全部落地。P1-1 状态机漏洞（`startSession` 忽略 offscreen 的 `ok:false`）已在本次修复并补 T19 回归测试。当前插件在「正确性 + 可测试性 + 安全性」三项上均达到可上架水准。若你是面试官：**Hire**；若你是商店审核员：**通过**。

*附：本报告在 Linux 沙箱完成（jsc 不可用，以 node 垫片/jsdom 替代执行全部三层测试）；建议按 README 真机验收清单在真实 Chrome 116+/126+ 上补跑 10 分钟长录制与真机下载路径。*
