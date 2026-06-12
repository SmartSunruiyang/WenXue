# 放大 Chrome 插件图标

- **日期**：2026-06-12
- **关联**：插件域 ExtensionEntrypoints / Chrome manifest 图标资源
- **会话上下文**：用户反馈 Chrome 中的“问”图标看起来偏小，需要放大。

## 做了什么
- 用 alpha bounding box 检查确认当前 `page-agent-128.png` 可见内容只占画布约 `68.8%`。
- 将透明 logo 的有效内容放大到约 `94%` 画布，并重生成 `page-agent-{16,32,48,64,128,256}.png`。
- 重新生成 `.project.agents/assets/nobottomlogo.png` 与 `apps/extension/src/assets/page-agent-64.png`，保持源图和插件内资源一致。
- 构建时发现新加的 `apps/extension/src/lib/i18n.ts` 含 JSX 导致 WXT 构建失败，将其改名为 `.tsx` 以恢复构建。

## 提交
- 未提交，工作树已有多处未提交改动；本段只在现有改动上继续完成插件图标放大与构建恢复。

## 状态变更
- 架构文档：未变更；仍归属既有插件域资源与入口装配。
- 需求/UI 文档：未变更；没有新增交互规则。
- 测试：先跑有效内容占比检查并失败；放大后 `16/32/128/256` 图标可见内容占比均约 `93.8%`。
- 构建：`pnpm -F extension build` 成功；仍有既有 pnpm 配置迁移提示、React OXC 性能建议与 esbuild `es2025` target 警告。

## 下一步
- 在 Chrome 扩展管理页重新加载 unpacked extension，确认工具栏图标视觉大小符合预期。
