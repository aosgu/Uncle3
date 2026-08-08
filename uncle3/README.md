# Uncle3 · Chrome 扩展

窗口尺寸一键调整 + 录制当前页面导出 MP4。

产品需求见仓库根目录 `PRD-Chrome窗口与录制插件.md`。

## 功能

1. **窗口尺寸调整**
   - 4 个内置预设，默认顺序 **HD（1280×720）、Full HD（1920×1080）置顶**，其后 iPhone 14 Pro（393×852）、iPad Mini（768×1024）
   - 自定义宽高（200–7680 × 200–4320，含范围校验与屏幕钳制提示）
   - 预设统一列表（内置+自定义，最多 20 个，本地持久化）：除 **HD 不可删除/改名**外，其余预设均可在弹窗内删除、在设置页改名/删除，顺序可在设置页拖拽调整
   - 实时回显当前窗口尺寸；一键恢复上次尺寸
2. **页面录制导出 MP4**
   - 基于 `chrome.tabCapture` 仅录制当前标签页（可选录制标签页声音，不采集麦克风）
   - 「导出 MP4 格式」选项（与「录制标签页声音」并排，默认勾选）：取消勾选则直接存储 WebM 格式
   - 暂停 / 继续；单次上限 10 分钟自动停止；关闭弹窗不中断；工具栏图标显示录制计时徽标
   - 停止后自动导出并下载：`{页面标题}_{yyyyMMdd_HHmmss}.mp4`
   - chrome:// 等受限页面自动禁用录制并说明原因
3. **设置页**（弹窗右上角齿轮图标进入）
   - 固定帧率（30fps）选项：**默认不勾选**，帧率跟随页面内容；勾选后录制时通过 `maxFrameRate: 30` 锁定
   - 预设尺寸管理：**拖拽排序**（弹窗内同步生效）；除 HD 外均可重命名/删除（HD 显示「内置」标识）

## 安装（开发者模式加载）

1. 打开 Chrome，访问 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录（`uncle3/`）
4. 工具栏出现 Uncle3 图标（建议点击拼图图标固定到工具栏）

> 要求 Chrome 116+（Offscreen API）。勾选「导出 MP4 格式」时，MP4 直出要求较新版本 Chrome（约 126+）；
> 若浏览器不支持 `video/mp4` 录制，会自动降级导出 WebM。取消勾选则始终直接存储 WebM。

## 使用

- **调整窗口**：点击图标 → 点击预设卡片，或输入自定义宽高后点「应用」。
- **录制**：点击图标 → 「开始录制」→ 浏览器弹出授权确认 → 允许后开始计时。
  停止后视频自动导出；若 Chrome 开启了「下载前询问保存位置」，会弹保存对话框（文件名已预填，直接保存即可，插件无法绕过该浏览器设置）。
- **设置**：弹窗右上角齿轮 → 在新标签页打开设置页，可切换固定帧率、管理自定义预设（改名 / 删除）。

## 目录结构

```
uncle3/
├── manifest.json      MV3 清单（权限：windows/activeTab/tabCapture/storage/offscreen）
├── core.js            共享纯逻辑（校验、命名、时间格式化、mimeType 选择）
├── background.js      Service Worker：录制会话状态机、徽标
├── offscreen.html/js  Offscreen Document：getUserMedia + MediaRecorder 录制执行体，并以 <a download> 直接导出
├── popup.html/js      弹窗 UI 与交互（右上角齿轮进入设置页）
├── settings.html/js   设置页（options_page，新标签页打开）：帧率选项 + 预设重命名/删除
├── ui.css             popup 与设置页共享样式
├── icons/             图标（Ruby 脚本生成，见 tools/gen_icons.rb）
└── tests/             测试（见下）
```

## 测试

- **单元测试**（core.js 纯逻辑 + 全部 JS 语法校验 + 扩展 HTML 无内联事件静态校验，62 项）：

  ```bash
  cd uncle3/tests
  /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc run.js
  ```

- **集成仿真**（mock chrome API，真实加载 background/offscreen/popup 三段源码，
  跑完 17 组端到端场景，59 项断言）：用浏览器打开 `uncle3/tests/sim.html`
  （需通过 HTTP 服务访问，如 `ruby -run -e httpd uncle3 -p 8766` 后访问
  `http://localhost:8766/tests/sim.html`）。
- **设置页仿真**（真实加载 core.js + settings.js，覆盖帧率选项持久化、预设重命名/删除、
  HD 锁定、拖拽排序，25 项断言）：`http://localhost:8766/tests/sim-settings.html`。

- **真机验收清单**（需人工在 Chrome 中执行）：
  1. 点击各预设，窗口尺寸生效且 toast 正确；
  2. 在普通 https 页面录制 10 秒，停止后下载的 MP4 可播放、有声音；
  3. 录制中关闭弹窗再打开，计时继续；暂停 5 秒后继续，视频不含暂停段；
  4. chrome://settings 页面录制按钮禁用且有说明；
  5. 拒绝录制授权时弹出 toast 提示且可重试；
  6. 齿轮进入设置页：勾选固定帧率后录制导出正常；拖拽预设调整顺序后重新打开弹窗，卡片顺序同步；重命名/删除非 HD 预设后弹窗同步，HD 无删除/编辑入口。

## 已知限制

- Chrome 设置「下载前询问每个文件的保存位置」开启时，导出会弹保存对话框（文件名已预填）；
  关闭该设置（Chrome 设置 → 下载内容）即可直接下载到默认目录，插件侧无法绕过此浏览器级设置；
- 录制的是浏览器窗口外框内的标签页画面，分辨率与页面实际渲染一致；
- 导出大文件（接近 10 分钟上限）时转存内存峰值较高，属预期行为；
- 未包含 ffmpeg.wasm 二次转码（PRD 方案 B）：现代 Chrome 可 MP4 直出，
  不支持时降级 WebM，后续版本可按需补充。
