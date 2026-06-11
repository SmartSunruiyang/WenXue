# M3 启动链路打通

- **日期**：2026-06-11
- **关联**：ROADMAP Demo M3 / `2026-06-11-m3-startup-chain` spec + plan
- **会话上下文**：从已提交的 M3 spec/plan 开始执行；CodeGraph 未初始化，按项目规则未擅自创建索引。

## 做了什么

- 修复 M3 preflight 阻塞：vendor `@page-agent/*` 四包的 `vite build` 工具链依赖在 pnpm 隔离下缺失，导致 root `pnpm build` 失败；已补齐 build-time devDependencies 并登记 `UPSTREAM.md`。
- 实现 `BrowserSupervisor`：`idle | launching | running | error` 状态机、CfT spawn、stdout/stderr 日志挂接、重复 launch 聚焦、用户请求 shutdown。
- 实现 `DesktopBridge` 主进程 IPC：`browser:launch`、`browser:getStatus`、`browser:status-changed`、`app:getVersions`。
- 替换 preload 暴露面为 `window.wenxue`，移除 `process.versions` 直出，并补 renderer 全局类型。
- 实现 ConsoleUI 最小态：品牌区、状态卡、启动/聚焦/重启按钮、版本 footer。
- 实现 MainBootstrap：安全 BrowserWindow、服务装配、IPC 注册、macOS activate、浏览器运行中关闭 App 的确认对话框。
- 修复 Electron dev 启动崩溃：`@puppeteer/browsers` 是 ESM-only，需从 `externalizeDepsPlugin()` 中排除，避免 CJS `require()`。
- ROADMAP M3 四项已在各自完成提交中勾选。

## 提交

- `eb4482c` build(vendor): declare page-agent build tools
- `8ce2cc0` feat(desktop): BrowserSupervisor 启动状态机
- `c852c8d` feat(desktop): register typed desktop IPC bridge
- `7d56651` build(desktop): add renderer React types
- `9f800ec` feat(desktop): expose minimal preload bridge
- `be583da` feat(desktop): render launch console minimum state
- `a310fa3` feat(desktop): wire Electron startup lifecycle
- `e721a8d` fix(desktop): bundle browser resources for Electron main

## 状态变更

- 架构文档：未改 `ARCHITECTURE.md`；M3 使用已登记模块与依赖方向。
- 需求/UI 文档：未改 `PRD.md` / `UIUX.md`；ConsoleUI 按 `UIUX.md §6/§7/§9` 的紧凑控制台形态实现。
- 供应链文档：已更新 `UPSTREAM.md` P7-P10，登记 vendor build 工具链依赖补丁。
- 路线图：`ROADMAP.md` M3 四个 checkbox 已全部 `[x]`。

## 验证

- `pnpm -r test`：通过。desktop 8 个测试文件 33 个测试；llms 3 个测试文件 58 个测试。
- `pnpm -F desktop exec tsc -p tsconfig.node.json --noEmit`：通过。
- `pnpm -F desktop exec tsc -p tsconfig.web.json --noEmit`：通过。
- `pnpm -F extension build`：通过，产出 `apps/extension/.output/chrome-mv3/manifest.json`；仍有 upstream `es2025` target warning，不阻断。
- `pnpm -F desktop fetch-browser`：通过，确认 mac-arm64 Chrome for Testing `149.0.7827.55`。
- `pnpm build`：通过；vendor dts bundle 仍提示未安装 `@microsoft/api-extractor`，但退出码为 0。
- `pnpm -F desktop dev`：主进程和 preload 构建通过，Electron app 启动不再出现 `@puppeteer/browsers` CJS/ESM 崩溃。
- Runtime launch smoke：真实 `BrowserSupervisor + BrowserResources + ProfileStore` 成功拉起 CfT，进程命令行包含预期 `--user-data-dir=<temp>/profiles/default` 与 `--load-extension=apps/extension/.output/chrome-mv3`。

## 手动限制

- 当前工具环境缺少 macOS Accessibility 权限：`osascript` 无法读取/点击 Electron 窗口。
- 当前显示环境不允许 `screencapture` 截屏。
- 因此，本会话不能可靠完成「点击 Electron 控制台按钮并肉眼确认工具栏插件」这一人工 GUI 验收；已用 dev 启动无崩溃与真实 BrowserSupervisor runtime smoke 覆盖可自动化部分。

## 下一步

- 在有 GUI/Accessibility 权限的本机环境执行人工验收：点击「启动浏览器」、确认 CfT 工具栏出现问学插件、重复点击不新增长期实例、手动关闭 CfT 后 UI 回到「未运行」、关闭 App 时验证两个对话框分支。
- 进入 M4：品牌化、固定插件 ID、默认模型配置、权限审计。
