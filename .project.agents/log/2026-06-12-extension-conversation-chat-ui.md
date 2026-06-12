# 重构插件对话流为 Claude 式聊天 UI

- **日期**：2026-06-12
- **关联**：SidepanelApp / Conversation / UIUX §6
- **会话上下文**：接手时工作区已有大量未提交改动，用户确认这些改动视为当前基线，在此基础上继续。

## 做了什么
- 将 `Conversation` 打磨为统一的聊天阅读组件：用户任务右对齐气泡；Agent 步骤、观察、重试、停止、错误、最终结果以非卡片的文本流/时间线呈现。
- 为运行中状态补上扫光文字与三点思考动画，并支持 `prefers-reduced-motion` 静态退化。
- 将历史详情页和 Hub 事件流切换为复用 `Conversation`，避免回看与外部会话仍使用旧步骤卡片。
- 补齐对话流所需 i18n 文案键；修正 `extensionPages.test.ts` 的 `chrome.tabs.create` 测试桩返回类型，使 `tsc --noEmit` 通过。
- 更新 `UIUX.md`，明确历史详情与 Hub 复用同一 `Conversation` 对话流。

## 提交
- 未提交，工作树状态：用户确认的基线改动 + 本次 UI 接力改动仍处于未提交状态。

## 状态变更
- 架构文档：未修改；本次不新增模块、不改变依赖方向。
- 需求/UI 文档：更新 `UIUX.md` 侧边栏对话流复用规则。
- 测试：
  - `pnpm -F extension exec tsc --noEmit` 通过。
  - `pnpm -F extension test` 通过（3 files / 11 tests）。
  - `pnpm -F extension build` 通过；保留既有 WXT/Vite 构建警告（`es2025` target warning、React Babel 性能建议、Node `module.register()` deprecation）。

## 下一步
- 在真实扩展环境中手动打开 sidepanel，跑一次真实 Agent 任务，检查用户气泡、思考态、步骤展开、错误态与最终结果的视觉效果。
- 若后续要精调视觉，可继续在 `Conversation` 内微调文本密度和时间线间距，不需要改 Agent 核心。
