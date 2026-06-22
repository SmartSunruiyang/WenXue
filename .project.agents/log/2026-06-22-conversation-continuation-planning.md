# 对话续接与上下文压缩：完成设计与实现计划（未实现）

- **日期**：2026-06-22
- **关联**：spec [`specs/2026-06-22-conversation-continuation-design.md`](../superpowers/specs/2026-06-22-conversation-continuation-design.md)、plan [`plans/2026-06-22-conversation-continuation.md`](../superpowers/plans/2026-06-22-conversation-continuation.md)；起因为「任务完成后续发消息不继承上下文」的机制问题
- **会话上下文**：从求证「为何第二条消息会另起对话、不带上一轮上下文」开始，经 brainstorming 收敛到方案与计划

## 做了什么
- 求证三处机制（均有代码依据）：
  - `execute()` 每次 `this.history = []` 清空、`resume()` 锁死在 `paused` 态 → 完成后续发即丢上下文；
  - 人工托管已沉淀续接基元（`pushObservation` + `setupTask:false` + 实例持有 task/history）；
  - 全程零上下文压缩，`#assembleUserPrompt` 每步全量重放，超限即 `CONTEXT_LENGTH` 报错。
- 厘清「两条轴」：`browser_state`（每步替换、page-controller 已管）vs `agent_history`（累加、零治理，唯一压缩对象）；`memory` 字段是叠加式软笔记、非压缩机制。
- 定方案 C（续接 + 阈值压缩），并由用户敲定压缩策略细节：
  - 触发**仅按实测 token**（软阈值），**不在任务完成时压**（保步级记忆供回退）；
  - **一次 LLM 摘要**提取有效信息（结构化步骤索引 + 关键状态），非「memory 承重」；
  - **存储/投影拆分**：`history`/IndexedDB 全量永久保留，仅压缩送 LLM 的投影；
  - 回退用 `recall_steps(indices)` 按索引取回原件；
  - 硬阈值：轮次间出**横幅**建议新会话，坚持/长任务内 FIFO 淘汰（`user_message` 永不删），永不崩；
  - 会话存储每对话一条（`conversationId` upsert）。
- 产出 spec + 实现计划（12 个 TDD 任务，分核心续接 / 核心压缩 / 回退兜底 / 插件接线 / 收尾五段）。

## 提交
- 本次规划提交：spec + plan + 本日志（仅规划文档，无代码）。

## 状态变更
- ARCHITECTURE / PRD / UIUX：**未动**（计划 Task 12 实现期同步）。
- UPSTREAM：**未登记**（计划 Task 7 实现期登记 `packages/core` 补丁）。
- 测试：**未跑**（无代码改动）。
- 版本控制：新建 worktree `.worktrees/conversation-continuation` + 分支 `codex/conversation-continuation`；本提交在该分支，**未合并回 main**。

## 下一步
- 用户当前指示「先不做」，实现暂缓。
- 恢复时执行计划 **Task 1**（事件类型 + 压缩配置 + `execute` 写首条 `user_message`）起；执行方式二选一：subagent-driven（推荐）/ inline executing-plans。
- 实现期注意：`#projectHistory()` 每步多次调用，长历史可缓存（优化项，不改契约）。
