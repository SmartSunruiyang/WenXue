# Windows 毛玻璃底板与内嵌内容框适配

- **日期**：2026-09-29
- **关联**：ConsoleUI / MainBootstrap；UIUX §7；`docs/superpowers/plans/2026-09-29-windows-glass-ui.md`
- **用户目标**：恢复 Windows 导航 tabs 毛玻璃，沿用 macOS 白色圆角内容框；顶部容纳右上角三件套、底部减少留白，先交付预览。用户确认目标 Windows 11 22H2 及以上。
- **工作区**：`/Users/outas/.codex/worktrees/windows-glass-ui/WenXue`，分支 `codex/windows-glass-ui`；原目录邮件验证文档和模板未提交改动原样保留。

## 做了什么

- MainBootstrap 为 Windows 设置原生 Acrylic 和透明 WebContents 背景，固定浅色；保留无框、resize / maximize 和 sandbox，不启用整窗 `transparent`。
- ConsoleUI 为 Windows 共享 macOS 的透明导航栏与不透明白色 16px 圆角内容框；顶部 44px、右 / 底 6px、侧栏 72px。
- 三件套移到内容框外的窗口右上角，去掉常态白底和底线；拖动区域避开按钮。头像顶部 48px、底部设置入口 16px，正文上下内边距 32 / 20px。
- 系统减少透明度与强制颜色模式保留可读底色；macOS / Linux、认证与业务契约保持不变。
- UIUX §2 / §7 同步视觉规则；无模块、依赖、IPC 或产品功能变化，不触发 ARCHITECTURE / PRD 修改。

## 提交

未提交。用户要求先看预览，改动保留在独立工作树，尚未同步回原开发目录。

## 验证

- Node / Web TypeScript `--noEmit`：通过。
- `vitest run src/main/MainBootstrap.test.ts`：26 项通过，包括 Windows Acrylic 与 macOS / Linux 隔离。
- `electron-vite build`：main / preload / renderer 生产构建通过。
- 修改的 TS / TSX 文件 ESLint：通过；生产代码 Prettier 与 `git diff --check`：通过。
- 独立只读审查：未发现可操作的布局、平台隔离或窗口配置回归。
- 新增独立脚本 `apps/desktop/scripts/preview-windows-ui.mjs`，复用真实 App 与完整生产 CSS；以 Vite 虚拟模块提供内存示例数据、替换认证/公告/发布信号，不连接真实账号服务。支持四路由、1120×720 / 920×600 与 macOS 对照，外层自适应缩放，不改变内层窗口尺寸。
- 预览脚本 Node 语法、Prettier 与 fixture bridge 独立严格类型检查通过。
- 在内置浏览器确认浏览器、日志、Tokens、设置可导航；搜索筛选与画像更多菜单可用，账号菜单 Escape 关闭后焦点回到触发点。
- 最小窗口实际 DOM 尺寸 920×600，内容框 `(72, 44, 842, 550)`、下边界 594；三件套 `(782, 0, 138, 38)`；无页面横向溢出。Tokens 页头按钮、设置 tabs 与正文未遮挡。
- 1120×720 浏览器页截图：`.project.agents/screenshots/2026-09-29-windows-glass-preview.png`。截图为 renderer + 背景示意，非 Windows 原生材质证据。
- 已打开交互预览 `http://127.0.0.1:5199/`，本地进程 PID 61775；重启命令 `node apps/desktop/scripts/preview-windows-ui.mjs`。

## 验证边界与下一步

- 当前主机为 macOS；Windows 原生 Acrylic、窗口拖动 / resize / maximize 与系统透明度切换仍须 Windows 11 22H2+ 实机验收。浏览器背景材质示意不能替代该结果。
- 接入范围依据 [Electron Background Material](https://www.electronjs.org/docs/latest/api/base-window#winsetbackgroundmaterialmaterial-windows)；当前安装的 Electron 类型检查确认支持对应选项。
- 等待用户查看预览与反馈，按反馈微调后再处理同步与 Windows 原生实机验收。
