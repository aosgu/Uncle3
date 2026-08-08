# Uncle3 Chrome 扩展 — 全量代码审计报告

> 审计对象：`aosgu/Uncle3` 分支 `arena/019fe2f9-uncle3`
> 审计日期：2026-08-09（本次新增：录制后弹窗需滚动才能看到「再录一次」的修复 + 全量代码审计）

---

## 摘要

整体质量 **高**。架构清晰、注释到位、竞态意识强，三层测试均可实际跑通。
本次审计发现并修复了 **1 个 UI 缺陷** 和 **2 个隐蔽的潜在缺陷**；其余为已知的低优先项与环境限制，无 P0 安全/数据问题。

**测试执行结果（本次实测）：**

| 测试 | 结果 |
|------|------|
| 单元测试 `tests/run.js`（jsc） | 65 / 65 通过 ✅ |
| 集成仿真 `tests/sim.html`（jsdom） | 68 / 68 通过 ✅ |
| 设置页仿真 `tests/sim-settings.html`（jsdom） | 22 / 25 通过（3 项为 jsdom `getBoundingClientRect` 返回全 0 的环境限制，非代码缺陷）|

> 注：jsdom 需为 `URL.createObjectURL` 打 polyfill（真实浏览器自带），并需以 `file://` 作为基准 URL 才能加载相对路径脚本。

---

## 一、本次已修复

### 1.【UI 缺陷】录制完成后「再录一次」被挤出可视区，需滚动才能看到
**现象：** 弹窗顶部「窗口尺寸」区与下方录制区垂直堆叠，Chrome 弹窗高度上限 600px；
完成状态额外新增文件名框 + 保存引导提示，把底部「再录一次」按钮推出可视区。

**修复（`popup.html` + `popup.js`）：**
- 将「窗口尺寸」区块及其分隔线包进 `<div id="sizeSection">`。
- `showPanel()` 中，当进入 `st-running / st-encoding / st-done / st-error` 任一录制相关状态时隐藏 `#sizeSection`，让录制区占满弹窗高度。
- 兜底：切到完成/出错状态时对录制区 `scrollIntoView`，确保即便仍有滚动条按钮也不被遮挡。
- 返回 `st-idle` 时尺寸区自动恢复，不影响原有尺寸调整功能。
- `if (sizeSec)` 守卫保证兼容 `sim.html`（其自带 DOM 无该节点）等测试场景。

### 2.【潜在缺陷】`offscreen.js` 的 `cleanupAll()` 未清理 tick 定时器
**问题：** `finalize()` 会 `clearInterval(tickTimer)`，但 `onerror` 等路径直接调 `cleanupAll()` 却不清理。
录制器报错后文档若在关闭前被复用，旧的 500ms `TIME` interval 会与下一次 `startRecording` 新建的 interval 并存形成「双发」，且旧定时器永不停止。

**修复：** 在 `cleanupAll()` 中统一 `clearInterval(tickTimer)`。

### 3.【潜在缺陷】`background.js` `restoreSession()` 可能用陈旧快照覆盖新会话
**问题：** `restoreSession()` 是异步 `storage.session.get`，启动时不 `await` 直接挂起。
若读取期间并发创建了新会话（如 SW 重启后立即 `startSession`），恢复逻辑会无条件把 `session` 覆盖为磁盘上的旧快照，新录制会话被吞掉。
（触发窗口极小：MV3 录制中每 500ms 有 TIME 消息保活，SW 通常不会在录制中重启；属防御性加固。）

**修复：** `await` 之后、赋值之前增加 `if (session) return;` 守卫，与 `getState` 的懒恢复逻辑保持一致。

---

## 二、审计未发现的问题（确认良好）

- **权限收敛**：manifest 仅 `windows / activeTab / tabCapture / storage / offscreen`，无多余的 `tabs`、`downloads`、`host_permissions`。✅
- **CSP 合规**：MV3 扩展页无内联脚本/内联事件处理（`tests/run.js` 有专项校验），无 `eval` / `new Function`。✅
- **XSS 面**：生产代码 3 处 `innerHTML` 均为静态结构；用户数据（标题、预设名）全部经 `textContent` 注入。✅
- **状态机竞态**：
  - `startSession` 校验 offscreen 的 `{ok:false}`，杜绝「幻影 recording」会话（T19 回归覆盖）。
  - `cancelPendingClose()` 在启动新会话前取消旧延迟关闭，避免误关新录制（T17 覆盖）。
  - `onTime` 仅活跃会话接收计时，避免残留定时器污染 done/error 会话。
  - `closeOffscreen(force=false)` 在录制/暂停/导出中拒绝关闭，看门狗 `onOffscreenDead` 兜底不卡死 encoding（T18 覆盖）。
- **下载可靠性**：offscreen 以 `<a download>` 直接发起下载（文件名预填比 `chrome.downloads` 在保存对话框中更可靠，且无需 `downloads` 权限）。
- **共享纯逻辑**：`core.js` 零 `chrome.*` 依赖，便于单测。

---

## 三、未修改的观察项（低优先 / 已知）

| 级别 | 事项 | 说明 |
|------|------|------|
| P2 | 无 CI / ESLint / 构建工具 | 测试与注释弥补了大量，但仍建议引入 `eslint` 与 GitHub Actions |
| P2 | 弹窗 600ms 轮询而非事件推送 | 可接受；极端下每帧短暂 UI 延迟 |
| P3 | `validateSize` 中 `== null` 宽松比较 | 语义正确但风格不统一（上一版报告已记录，未改） |
| P3 | `restoreSession` 与 `getState` 懒恢复的徽标还原逻辑重复 | 可抽公共函数，纯 DRY 优化 |
| P3 | README 中测试数量已过时 | README 写「62/59」，实际 65/68/25 |
| 待验证 | offscreen 文档内 `<a download>` 在真实 Chrome 的触发 | 已通过仿真验证；`tests/manual-offscreen.html` 提供浏览器手工用例，建议上架前真机过一遍 |

---

## 四、测试执行说明

本次在无 jsc/浏览器环境下，用 node + jsdom 补跑了三层测试以验证修复不引入回归：

- 单元测试以「core.js + run.js 拼接后单次 eval」方式共享作用域（node 的 `load`/`eval` 不会泄漏顶层 `const`）。
- 集成仿真：jsdom `runScripts:'dangerously'` + `resources:'usable'`，基准 URL 用 `file://` 指向 `sim.html`，并补 `URL.createObjectURL` polyfill 后 **68/68 全通过**。
- 设置页仿真 3 项失败（S7/S8 拖拽）源于 jsdom 无布局引擎导致 `getBoundingClientRect()` 全 0，拖拽方向判断退化为 `after`——真实浏览器坐标正常，非代码缺陷。
