# Windows 毛玻璃外壳与内容框适配

上游：`../../context/UIUX.md` §7；`../../context/ARCHITECTURE.md` 的 ConsoleUI 与 MainBootstrap。

## 目标与边界

恢复 Windows 导航 tabs 与外壳底板的系统毛玻璃，正文沿用 macOS 的不透明白色、16px 圆角内容框。
Windows 顶部保留 44px 空间，右上角三件套位于内容框外；右侧与底部露底 6px，侧栏维持 72px。
macOS / Linux、认证和业务逻辑保持原契约，无新依赖、模块或 IPC。

主进程使用现有 Electron 的 Acrylic 背景材质并保持浅色；不启用会影响 resize 的整窗透明模式。
原生接口支持 Windows 11 22H2 及以上；旧系统和系统关闭透明效果时保留可读的浅色外壳。
当前主机是 macOS，浏览器预览复用真实 renderer 与隔离 fixture，并明确标注系统材质为示意。

## 实施与验证

- [x] MainBootstrap：Windows Acrylic、透明 WebContents 背景；更新平台窗口选项回归测试。
- [x] ConsoleUI：平台样式、顶部独立拖动区与窗口按钮、底板透明、内嵌白色内容框。
- [x] 提供独立本地预览，覆盖浏览器、日志、Tokens、设置及最小窗口，不连接真实账号或浏览器。
- [x] 同步 UIUX 并记录执行日志；类型检查、相关单测、构建、格式与 diff 检查。
- [x] 展示预览；Windows 原生材质与窗口操作明确留待实机验证。

工作在独立工作树 `codex/windows-glass-ui`，原目录未提交的邮件相关改动保留。
