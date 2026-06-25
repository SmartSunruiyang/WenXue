# 官网 DotField 背景视觉增强

- **日期**：2026-06-24
- **关联**：官网 WebsiteSite / DotField 首屏背景

## 做了什么
- 增强首页 DotField 点阵可见度：提高点大小与黑灰透明度，并在首页显式传入背景参数。
- 将鼠标 hover 光晕改为灰色并增大半径/透明度。
- 将首页 bulge strength 提升到 132，并开启 sparkle 点。
- 为 DotField 补充 `sparkle`、`waveAmplitude`、`gradientFrom`、`gradientTo`、`glowColor` 配置。

## 提交
- 未提交，工作树状态：`apps/website` 当前仍是未跟踪目录，本次只在其现有文件内继续小范围修改。

## 状态变更
- 架构文档：未变更，改动仍属于既有 `WebsiteSite` 模块。
- 需求/UI 文档：未变更，符合既有官网首屏 DotField 背景方向。
- 测试：`pnpm -F website build` 通过；`pnpm -F website test` 通过。
- 渲染验证：复用 `http://127.0.0.1:5175/`，Browser 验证桌面 1280×720 与移动 390×844 首屏；页面非空、无框架错误覆盖、控制台无 error/warn。

## 下一步
- 若继续微调视觉，可围绕 `apps/website/src/App.tsx` 中的 DotField 参数微调点密度、光晕半径和 bulge strength。
