# 桌面应用图标资产

- **母版**：`apps/desktop/resources/icon.png`（现有问学 logo，1254×1254 RGB）
- **生成命令**：`pnpm -F desktop generate-icons`
- **状态**：macOS / Windows 平台资产已交付

## macOS（传统 ICNS 兼容路径）

- 1024×1024 透明画布；现有母版整体缩放到 824×824 并居中。
- 轮廓使用 superellipse 近似旧版 Apple production template，并保留轻量投影。
- `.icns` 包含 16、32、64、128、256、512、1024 的标准 1x/2x 表示。
- 输出：`app-icon-macos-1024.png`、`app-icon-macos.icns`。

824×824 是 Electron / 传统 `.icns` 的兼容处理值，不是现代 Icon Composer 对内部
logo 的强制安全区。未来若迁移到 `.icon`，应使用 1024×1024 full-bleed 不透明背景图层，
不预烘焙 mask、阴影或透明外边距。

## Windows（Win32 / Electron）

- 256×256 透明母版；可见底板按 Microsoft 48 单位设计网格取 40 单位并光学居中。
- `.ico` 包含 16、20、24、32、40、48、64、256 八个 PNG 帧。
- 输出：`app-icon-windows-256.png`、`app-icon-windows.ico`。

40/48 是本品牌为解决当前不透明白底占满画布而采用的光学适配值；Microsoft 没有规定
所有应用图标必须使用统一的安全区百分比。
