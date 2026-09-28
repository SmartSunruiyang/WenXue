# 桌面应用图标资产

- **macOS 母版**：`apps/desktop/resources/icon.png`（现有问学 logo，1254×1254 RGB）
- **Windows 标志源**：`.project.agents/assets/nobottomlogo.png`（同一问字的透明源）；向导品牌区只搭配既有 `nobottomslogen.png` slogan 图片，保持 3:1 比例，不额外排版 WenXue 等拼音文字。
- **生成命令**（macOS / Swift + AppKit）：`pnpm -F desktop generate-icons` 生成两平台；`pnpm -F desktop generate-icons:win` 仅更新 Windows。
- **状态**：macOS / Windows 素材已交付；Windows 安装向导资源已接线，实际 Windows 安装显示仍需实机验收。

## macOS（传统 ICNS 兼容路径）

- 1024×1024 透明画布；现有母版整体缩放到 824×824 并居中。
- 轮廓使用 superellipse 近似旧版 Apple production template，并保留轻量投影。
- `.icns` 包含 16、32、64、128、256、512、1024 的标准 1x/2x 表示。
- 输出：`app-icon-macos-1024.png`、`app-icon-macos.icns`。

824×824 是 Electron / 传统 `.icns` 的兼容处理值，不是现代 Icon Composer 对内部
logo 的强制安全区。未来若迁移到 `.icon`，应使用 1024×1024 full-bleed 不透明背景图层，
不预烘焙 mask、阴影或透明外边距。

## Windows（Win32 / Electron）

- 保留现有黑色问字，裁去源图透明外留白后放大主体。平面白色底板、小圆角、细中性灰边与透明外边距，使浅色 / 深色桌面均有明确轮廓；不使用 macOS superellipse 或烘焙阴影。
- `.ico` 包含 **16、20、24、30、32、36、40、48、60、64、72、80、96、128、256** 共 15 个 32-bit PNG 帧。16–96 覆盖 Windows 常见标题栏、任务栏与缩放倍率；128 为额外 Explorer 尺寸，256 用于大图标。
- 每个尺寸从原始标志独立绘制，像素对齐；小帧不从 256 成品反复缩小，也不嵌入品牌文字。
- 输出：`apps/desktop/resources/app-icon-windows.ico` 和每帧 `app-icon-windows-{size}.png`；256 PNG 可作独立预览母版。
- 应用 EXE、安装器和卸载器显式使用同一个 ICO。保留 `win.signExecutable: false`，关闭签名的同时继续嵌入图标与应用元数据。

底板形状、透明留白与视觉占比属于本品牌的光学适配，**不是 Microsoft 强制的统一百分比**。
本项目目标为 Win32 / Electron NSIS，不套用 MSIX / Microsoft Store 的磁贴命名或留白要求。

## Windows 安装 / 卸载向导

| 素材（均位于 `apps/desktop/resources/`） | 规格                    | 使用位置                      |
| ---------------------------------------- | ----------------------- | ----------------------------- |
| `installer-header-150x57.bmp`            | 150×57、24-bit RGB BMP  | assisted 向导右上角品牌区     |
| `installer-sidebar-164x314.bmp`          | 164×314、24-bit RGB BMP | 安装完成页、卸载欢迎 / 完成页 |

向导配图的品牌内容只使用既有问字与 slogan 源图片；每张 header / sidebar 仅放置一份 slogan 图片，
不另加 WenXue 等拼音文字，也不重复叠放第二份 slogan，不含版本号、安装进度或按钮文案。BMP 为不透明原生位图，
避免 NSIS 对 alpha 的支持差异。现有 `oneClick: false` 流程保持不变，不为展示素材额外插入安装欢迎页；
`installerHeaderIcon` 仅属于 one-click 模式，本配置不使用。`uninstallerSidebar` 显式复用安装侧栏。

资源生成依赖 macOS，但所有产物提交入库，Windows CI 打包不运行 Swift。

## 规范依据与验收

交付预览：[明暗背景与原始像素尺寸联系表](windows-installer-assets-preview.png)。

- [Microsoft：应用图标构建与尺寸](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)
- [Microsoft：应用图标设计](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design)
- [Microsoft：Win32 图标资源](https://learn.microsoft.com/en-us/windows/win32/menurc/about-icons)
- [electron-builder：NSIS 资源配置](https://www.electron.build/v26/docs/nsis/)
- [NSIS Modern UI：向导位图尺寸](https://nsis.sourceforge.io/Docs/Modern%20UI/Readme.html)

维护时检查 ICO 目录 / PNG 帧尺寸与透明角、BMP 位深和行填充、配置引用、重复生成一致性以及明暗背景下的小尺寸可读性。
真实 Windows EXE、开始菜单、桌面快捷方式、任务栏与安装 / 卸载向导显示，需要在 Windows 机器上验收；
macOS 素材检查不能代替实机结论。
