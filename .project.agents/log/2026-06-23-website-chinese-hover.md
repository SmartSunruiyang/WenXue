# 官网中文标题 hover 效果补齐

- **日期**：2026-06-23
- **关联**：WebsiteSite / 官网首屏 VariableProximity 标题 hover
- **会话上下文**：用户要求官网页面中文字也要和英文字一样具备 hover 效果。

## 做了什么
- 在 `apps/website/src/VariableProximity.tsx` 中为逐字邻近计算补充字体无关的 `translateY + scale` transform。
- 保留原有 `fontVariationSettings` 字重/光学尺寸插值，让英文继续使用可变字体效果，中文 fallback 字体也有同强度视觉反馈。

## 提交
- 未提交，工作树已有用户/既有未提交改动，本次只追加当前修复。

## 状态变更
- 架构文档：未改，仍归属 `WebsiteSite`。
- 需求/UI 文档：未改，符合已有 PRD/UIUX 对官网 VariableProximity hover 的描述。
- 测试：`pnpm -F website build` 通过；浏览器 QA 验证页面非空、无框架错误覆盖层、控制台无 error/warn，中文 hover transform 生效；桌面与 390px 移动视口截图无明显布局重叠。

## 下一步
- 若后续继续打磨官网视觉，可把中文/英文邻近效果的强度参数抽成显式组件 prop。
