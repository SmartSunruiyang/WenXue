# 修复登录后首次进入主页的侧栏磨砂效果

- **日期**：2026-09-23
- **关联**：当前 Electron 运行时 ConsoleUI；`docs/context/UIUX.md` §7

## 做了什么

- 定位到 macOS 原生 `under-window` 材质上方的 renderer 底色切换：登录阶段 `body` 不透明，主页挂载后才由 `:has(.app-shell--macos)` 改为透明。
- 让 `body` 从首次绘制起保持透明；登录页继续由 `.auth-shell` 自身的不透明背景覆盖窗口，主页侧栏继续透出原生材质。
- 在 UIUX 窗口外壳规范中固定这一透明底层约束。未改变模块边界或 IPC 契约。

## 提交

- 本日志所在提交：`fix(desktop): preserve sidebar vibrancy from first paint`。

## 状态变更

- 架构文档：无需修改；改动仅涉及 ConsoleUI 的绘制样式。
- 需求/UI 文档：更新 `docs/context/UIUX.md` §7 的窗口外壳描述。
- 验证：`pnpm -F desktop build`、`pnpm -F desktop typecheck`、`pnpm -F desktop exec vitest run src/main/MainBootstrap.test.ts`（26 项）及 `git diff --check` 均通过；运行中的 macOS 开发窗口主页可正常显示。未清除现有账号登录态，因此未执行真实账号的退出后首次登录视觉复测。

## 下一步

- 使用修复后的桌面构建完成一次真实登录，确认首次进入主页时左侧栏立即显示原生磨砂材质。
