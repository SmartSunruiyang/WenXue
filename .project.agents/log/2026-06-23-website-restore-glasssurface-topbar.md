# 2026-06-23 Restore Website GlassSurface Topbar

- **日期**：2026-06-23
- **关联**：WebsiteSite / 官网顶部任务栏材质修复

## 做了什么

- 将官网信息栏从悬浮窗恢复为贴顶顶部任务栏。
- 重新强化 React Bits `GlassSurface` 在顶部任务栏里的可见材质：提高 frosted 背景、折射、饱和度和边缘线，并补充 `-webkit-backdrop-filter`。
- 保留透明 slogan、文档入口、GitHub 图标按钮和中英文切换。
- 更新 PRD、ARCHITECTURE 与设计 QA 记录，避免文档仍描述为悬浮窗。

## 提交

- 未提交，工作树已有同一批官网改动正在迭代中。

## 状态变更

- 需求文档：官网顶部信息栏恢复为贴顶 GlassSurface 玻璃任务栏。
- 架构文档：WebsiteSite 职责恢复为 GlassSurface 贴顶玻璃导航。
- 测试：`pnpm -F website build` 通过；`pnpm -F website test` 通过；Chrome Playwright 检查通过，确认 `glass-surface--svg` 与 SVG `backdrop-filter` 生效；桌面和移动端无水平溢出。

## 下一步

- 若后续继续调整，只在 GlassSurface 参数与顶部栏高度内微调，不再改变页面信息密度。
