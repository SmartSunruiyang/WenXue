# macOS 紧凑磨砂侧栏细化

## 用户反馈与范围

用户要求左侧 Tab 栏更窄，磨砂必须透出窗口后方背景；必要时可以缩小红绿灯。
沿用此前“直接同步”的授权，在原工作区继续修改 MainBootstrap / ConsoleUI；不新增模块、依赖或 IPC。
本轮尺寸与材质规范替代首版日志中的 96px / sidebar / followWindow 设计，继续仅适配浅色。

## 变更

- macOS 左栏从 96px 收窄至 72px，原生红绿灯位置从 `(22, 20)` 调整为 `(10, 20)`；72px 能容纳系统按钮，无需缩小按钮或点击区域。
- 移除 renderer 底板上 16% 不透明度的浅色覆层。html、body、root、app-shell 与 sidebar 的背景均透明，主内容卡片保持不透明。
- 原生材质改为 `vibrancy: under-window`、`visualEffectState: active`，使用窗口后的原生模糊采样，失焦时继续保持 active 材质；保留系统“减少透明度”行为。
- 保留 16px 内容圆角、顶/右/底 8px 露底边距及原生 resize；未启用整窗 `transparent` 模式。
- 更新 UIUX、派生设计与计划及已有窗口选项测试。

## 验证

- macOS 26.5 arm64、项目自带 Electron 33.4.11；隔离预览直接构建自原工作区源码，使用临时账号与画像数据，没有操作用户正在运行的真实浏览器。
- 两份 TypeScript 配置检查通过；MainBootstrap 13 项、DesktopBridge 35 项测试通过；生产构建、相关 TypeScript ESLint、Prettier 与 `git diff --check` 通过。
- 原生窗口读取到红绿灯位置 `(10, 20)`，系统 `prefersReducedTransparency = false`；1120×720 与 920×600 窗口均能完整容纳原生按钮，支持拖边缩放。
- 最小窗口实测左栏 72px，内容卡片 `(72, 8, 840, 584)`、圆角 16px，页面 `scrollWidth = clientWidth = 840`，document / viewport 均为 920px，无横向溢出。
- 原生 UI 检查浏览器页、Tokens 页、设置页及账号菜单，菜单出现在栏外且不被内容圆角裁切，Escape 可关闭。
- computed style 确认五层 renderer 背景均为 `rgba(0, 0, 0, 0)`；renderer PNG 中侧栏空白点的 alpha 为 0，内容卡片 alpha 为 255，确认没有 Web 遮罩阻挡原生材质。
- 验证边界：当前 CUA 单窗口采集显示材质底色，不能确认另一个窗口的颜色是否被纳入最终截图；没有据此声称已量化验证桌面背景的实际透出与模糊强度。系统整屏截屏工具在本环境未能产生可用截图。
- 原工作区已有 `.gitignore`、TECH-INFRA、CloudBase 实现/测试及对应日志的 SHA-256 与首版同步前快照一致。

## 参考与后续

- [Electron 33.4.11 原生窗口实现](https://github.com/electron/electron/blob/v33.4.11/shell/browser/native_window_mac.mm)：`SetVibrancy` 使用 `NSVisualEffectBlendingModeBehindWindow`，材质与 active 状态通过现有 API 提供。
- 原生材质与红绿灯配置在新建窗口时生效，已有问学进程需要重新启动后查看。

## 提交

未提交。用户要求直接同步代码，没有要求提交；原工作区另有需保留的未提交修复。
