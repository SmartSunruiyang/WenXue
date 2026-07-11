# 完成桌面端 macOS / Windows 平台图标适配

- **日期**：2026-07-10
- **关联**：UIUX §11 / ROADMAP 品牌视觉资产并行轨道
- **会话上下文**：用户确认保留工作区既有未提交改动，只处理桌面端图标范围。

## 做了什么

- 保留现有 1254×1254 问学 logo 图形，新增可复现的 Swift 图标生成脚本，不使用生成模型重绘。
- macOS 采用传统 Electron / `.icns` 兼容路径：1024 透明画布、824 可见区、
  superellipse 轮廓与轻量投影，并生成完整 1x/2x ICNS 表示。
- Windows 采用 48 单位设计网格中的 40 单位可见底板，生成 256 PNG 与
  16/20/24/32/40/48/64/256 八帧 ICO。
- Electron 开发态按平台选择 macOS PNG 或 Windows ICO；正式打包态不覆盖系统图标，
  交由 app bundle / executable 使用 electron-builder 配置的原生资产。
- 新增 electron-builder 的 macOS、DMG 与 Windows 图标映射，以及平台选择回归测试。
- 在 `.project.agents/assets/desktop-app-icons.md` 记录生成参数、交付文件和现代
  Icon Composer 与传统 ICNS 路径的差异。

## 提交

- 未提交：用户未要求提交，且工作区已有大量与本任务无关的未提交改动；本次保持它们不动。

## 状态变更

- 架构文档：未改；没有新增运行时模块或依赖边。
- 需求/UI 文档：未改；本次交付既有 UIUX §11 资产要求，参数记录写入派生资产清单。
- 打包配置：新增既有架构目录中已登记的 `apps/desktop/electron-builder.yml` 图标项；
  electron-builder 依赖与完整 M5 打包流水线仍未落地。

## 验证

- `pnpm -F desktop generate-icons`：通过；连续两次输出 SHA-256 一致。
- `iconutil --convert iconset`：ICNS 成功解包为 10 个标准 1x/2x 表示。
- ICO 目录解析：确认 16、20、24、32、40、48、64、256 八个 RGBA PNG 帧。
- 视觉检查：1024 / 256 主图与 macOS / Windows 16px 最小帧均通过；在浅色和深色背景上
  图形完整、无笔画粘连，透明外缘正确。
- `pnpm -F desktop test -- MainBootstrap.test.ts`：10 tests 通过。
- `pnpm -F desktop test`：15 test files、77 tests 全部通过。
- `pnpm -F desktop exec tsc -p tsconfig.node.json --noEmit --pretty false`：通过。
- Prettier check 与 `git diff --check`：通过。
- 会话期间 `launchConfig.ts` / `launchConfig.test.ts` 出现了本任务外的并行未提交改动；
  本次未修改或覆盖它们，最终完整测试在该并行改动完成后通过。

## 下一步

- M5 接入 electron-builder 依赖与 `dist:mac` / `dist:win` 后，在 macOS 与 Windows 原生 runner
  分别检查 app bundle、DMG、EXE、NSIS、Dock 与任务栏的最终系统渲染。
