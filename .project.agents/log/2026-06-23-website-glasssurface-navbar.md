# 2026-06-23 官网顶部栏 GlassSurface 材质

- **日期**：2026-06-23
- **关联**：官网域 `apps/website`

## 做了什么

- 集成 React Bits `GlassSurface` 组件到 `apps/website/src/GlassSurface.tsx` 与配套 CSS。
- 将顶部任务栏从普通 `backdrop-filter` 材质替换为 `GlassSurface` SVG displacement 玻璃材质。
- 保留原有贴顶布局、透明 slogan hover、文档/GitHub/语言切换按钮。
- 更新 `PRD.md`、`ARCHITECTURE.md` 与 `design-qa.md`。

## 提交

- 未提交，工作树仍包含官网整体验收改动，等待用户确认后统一提交。

## 状态变更

- 架构文档：WebsiteSite 职责补充 GlassSurface 贴顶玻璃导航。
- 需求文档：官网顶部信息栏材质更新为 React Bits GlassSurface。
- 测试：`pnpm -F website build` 通过。
- 视觉验证：Chromium 实测 `glass-surface--svg` 路径生效，`backdrop-filter` 指向生成的 SVG filter；桌面 `1440x1100` 与移动 `390x844` 顶栏均 y=0，无横向溢出。

## 下一步

- 如继续精修，可根据最终品牌方向微调 GlassSurface 的折射强度、亮度和边缘厚度。
