# 完成 macOS 桌面磨砂侧栏与内嵌圆角内容区

- **日期**：2026-09-18
- **关联**：ConsoleUI / MainBootstrap；`docs/context/UIUX.md` §7。
- **实施范围**：用户确认仅统一 macOS 主窗口外壳；次级分类与正文包入同一内容卡片；保留现有页面功能，本次不适配深色主题。
- **工作区**：本任务先在 `/private/tmp/wenxue-macos-glass-shell`、分支 `codex/macos-glass-shell` 隔离实施；用户随后明确要求“直接同步”，已将 5 个代码/视觉规范文件和 3 个设计/执行文档同步回 `/Users/outas/WebstormProjects/WenXue`。同步前后逐字节校验原有 `.gitignore`、TECH-INFRA、CloudBase renderer、测试及其日志，均保持不变。

## 改动

- MainBootstrap 在 macOS 使用原生 `sidebar` vibrancy、`followWindow` 与透明背景色，原生主题固定 light；系统红绿灯位置配置为 `(22, 20)`。未启用整窗 `transparent`，保留原生缩放与 resize 能力。
- ConsoleUI 为 macOS 使用固定 96px 导航宽度，使系统红绿灯完整落在侧栏内；去除侧栏贯穿式右边线，让系统磨砂底板透出。
- 所有工作台主页面放入同一不透明内容卡片：16px 圆角，顶部、右侧和底部各露出 8px 底板，采用短阴影与轻轮廓。设置次级分类栏也位于卡片中。
- 账号菜单改为跟随实际侧栏宽度定位；macOS 页头禁止 flex 收缩，修复 920×600 下 Tokens 页按钮被统计区压住的现象。
- Windows / Linux 保持原有窗口选项、侧栏宽度、自绘三键与布局。登录表单与业务逻辑未变。
- 更新视觉规范、方案与实施计划。无新模块、依赖、IPC 或契约变化，ARCHITECTURE 与目标 Chromium 文档无需调整。

## 提交

- 未提交：用户要求同步而未要求 Git 提交；完整代码与文档已回到当前开发工作区，保留原有未提交修复。
- SELF_CONSTRAINTS §A2 的同步确认已由用户“直接同步”明确授权。

## 验证

- TypeScript：直接使用本地 TypeScript 执行 desktop `tsconfig.node.json` 与 `tsconfig.web.json` 的 `--noEmit`，通过。
- 单测：`MainBootstrap.test.ts` 与 `DesktopBridge.test.ts`，共 2 files / 48 tests，通过。窗口选项覆盖 macOS 磨砂与 Windows / Linux 隔离、resize 和 renderer 安全选项。
- 生产构建：直接调用本地 `electron-vite build`，main / preload / renderer 全部通过。
- 代码质量：修改的 TS/TSX/CSS 文件通过 Prettier；修改的 TS/TSX 文件通过 ESLint；`git diff --check` 通过。
- 环境说明：pnpm 自身尝试联网时失败，故使用已经安装的本地工具执行同等验证命令；未更改包管理器或依赖。
- 同步后在原开发工作区复核：Node / Web 类型检查、main / preload / renderer 生产构建、diff 空白检查全部通过；窗口、桥接与原有 CloudBase 修复的单测合计 3 files / 77 tests 通过。同步前后原有 5 个未提交文件 SHA-256 一致。
- 原生环境：macOS 26.5 arm64、Electron 33.4.11。在独立预览 App、临时 userData 和仅限 QA 构建的固定数据中检查真实窗口，未访问或修改用户的账号、画像或运行进程。
- 视觉与交互：1120×720 和 920×600；浏览器、日志、Tokens、设置；账号菜单、末行更多菜单、Escape 关闭与焦点回位；日志滚动暂停跟随；系统窗口拖动 resize。原生截图在会话中展示。
- 最小窗口实测：侧栏 96px；内容卡片 `(96, 8, 816, 584)`，右边界 912、下边界 592、圆角 16px；页面 `scrollWidth = clientWidth = 816`，document 宽 920，无横向溢出。按钮区域处于 no-drag，顶部拖动区截止 y=46，页头起点 y=56。
- 渲染层截图位于 `/private/tmp/wenxue-glass-qa/renderer-preview.png`，使用测试数据，仅包含 renderer，不包含系统红绿灯或原生磨砂层；不能代替原生窗口截图。

## 验证边界与下一步

- 较旧 macOS 未做真机检查；使用现有 Electron 33 支持的材质接口，不依赖 macOS 26 专属 Liquid Glass API。
- Windows / Linux 此次仅做配置隔离检查，未作真机视觉验收；深色模式按用户要求不在范围内。
- 已同步回当前开发工作区；原生窗口选项需在桌面端主进程重启后生效。
