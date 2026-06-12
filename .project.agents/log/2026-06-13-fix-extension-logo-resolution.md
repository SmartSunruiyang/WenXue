# 修复插件透明 Logo 清晰度

- **日期**：2026-06-13
- **关联**：SidepanelApp / options 设置页视觉资产
- **会话上下文**：接手时工作区已有扩展重品牌、设置页与图标相关未提交改动；本次只补透明「问」字 logo 清晰度。

## 做了什么
- 将共享 `Logo` 组件从 256px 旧图切换到 1254px 透明源图 `wenxue-logo-1254.png`，覆盖侧栏空状态与 options 设置页页头。
- 用同一高清透明源图重新导出插件 manifest/favicons 的 16/32/48/64/128/256 PNG，避免工具栏与页面 favicon 继续使用旧低清图。
- 增加 `Logo` 资源回归测试，锁定 UI 使用高清透明资产且源图尺寸不低于 1024px。

## 提交
- 未提交，工作树仍包含本会话前已有的大量未提交变更；本次改动保持在扩展 logo 资源与直接测试范围内。

## 状态变更
- 架构文档：未变更；改动仍归属 `SidepanelApp` 展示层与视觉资产。
- 需求/UI 文档：未变更；符合 `UIUX.md` 中插件空状态与 options 设置页品牌 logo 要求。
- 测试：
  - `pnpm -F extension test -- src/components/misc.test.ts` 通过
  - `pnpm -F extension test` 通过（4 files / 13 tests）
  - `pnpm -F extension build` 通过；产物包含 `assets/wenxue-logo-1254.png`
  - Browser 预览检查 options 页头 logo：32×32 显示，1254×1254 源图，无当前预览错误
  - Browser 预览检查 sidepanel 空状态 logo：80×80 显示，1254×1254 源图，无当前预览错误

## 下一步
- 在真实扩展上下文（Chrome/CfT 加载 `.output/chrome-mv3`）再人工看一眼工具栏图标与 options 页 favicon 的系统级缩放效果。
