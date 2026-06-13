# 重做桌面启动器 UI

- **日期**：2026-06-13
- **关联**：ConsoleUI / `UIUX.md` 桌面主窗口规范 / `.project.agents/assets/` 设计输入
- **会话上下文**：用户要求不用 `uiuxpromax`，改用现有设计与前端能力重做 Electron 启动器。

## 做了什么

- 将桌面启动器从简易状态卡重做为“小窗高能控制台”：品牌 logo + 字标、状态胶囊、Liquid Glass 状态面板、启动序列、首次使用 checklist、版本三元组。
- 保持 ConsoleUI 边界：渲染层只消费 `BrowserStatus` / `AppVersions`，只发送 `browser.launch()` 意图，不新增 IPC，不接触插件域数据。
- 复用 `.project.agents/assets/` 中的无底 logo / slogan 资产到桌面 renderer public 目录。
- 给 `desktop` 声明已有仓库图标库 `lucide-react`，与插件端图标体系对齐。
- 为 error 态补充真实的「查看日志」二级动作，经 `app:openLogs` 打开本机日志目录。
- 将默认控制台窗口调整为约 `500×440`，最小约 `480×400`。
- 同步更新 `ARCHITECTURE.md` / `CONVENTIONS.md` / `UIUX.md` 中 IPC 与桌面启动器规范。

## 提交

- 未提交，工作树状态：本次 UI 改动仍在当前工作区，等待用户确认后再提交。

## 状态变更

- 架构文档：更新 DesktopBridge IPC 契约，新增 `app:openLogs`，未新增模块或跨域依赖边。
- 需求/UI 文档：更新 `.project.agents/docs/context/UIUX.md` 桌面启动器相关段落。
- 测试：
  - `pnpm -F desktop build` 通过。
  - `pnpm -F desktop test` 通过，8 个测试文件 / 34 个测试全绿。
  - Browser 插件通过临时静态 bundle harness 验证首屏 DOM、主按钮交互、运行态切换和当前页 console health；Browser 截图接口本轮 `Page.captureScreenshot` 超时，未用系统全屏截图替代。

## 下一步

- 用户视觉确认后，可提交本次桌面启动器重做。
- 若需要更完整视觉 QA，可在真实 Electron 窗口中人工走查浅色 / 深色与退出确认对话框。
