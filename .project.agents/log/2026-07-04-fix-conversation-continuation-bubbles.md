# 修复侧边栏续接对话用户气泡覆盖问题

- **日期**：2026-07-04
- **关联**：PRD F3 / UIUX §6 续接线程
- **会话上下文**：用户反馈插件内对话记忆正常，但续接发送新消息后不会出现新的用户气泡，而是修改上一条用户气泡。

## 做了什么
- 让 `Conversation` 渲染 `HistoricalEvent` 中的 `user_message` 事件，每一轮用户输入都会成为独立右侧气泡。
- 将 `task` 渲染改为仅在历史尚未同步当前用户消息时的兜底，避免 `currentTask` 与 `user_message` 重复显示。
- 增加组件回归测试，覆盖“第一轮问题 → 过程事件 → 继续追问”的多轮渲染顺序与去重。

## 提交
- 未提交，工作树已有大量用户/既有未提交改动；本次只新增并修改本日志列出的文件。

## 状态变更
- 架构文档：未改；变更仍属插件域 SidepanelApp/Conversation 展示层，不新增模块或依赖。
- 需求/UI 文档：未改；现有 PRD F3 与 UIUX §6 已要求续接时追加新用户气泡。
- 测试：`pnpm -F extension test src/components/conversation.test.ts` 通过；`pnpm -F extension test src/agent/useAgent.test.ts` 通过；`pnpm -F extension test src/entrypoints/sidepanel/App.test.ts` 通过；`pnpm -F extension test src/components/HistoryDetail.test.ts` 通过；`pnpm -F extension test` 通过；`pnpm -F extension build` 通过。

## 下一步
- 如需真机确认，在桌面端启动注入后的 CfT 扩展运行时，完成一次任务后直接发送第二条消息，确认侧边栏保留第一条气泡并追加第二条气泡。
