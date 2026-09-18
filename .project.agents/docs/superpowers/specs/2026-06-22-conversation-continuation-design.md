# 对话续接与上下文压缩 Spec

> 2026-09-18 后续调整：浏览器内插件侧栏的新会话反馈恢复上一版约 520ms 收拢动效；以 [UIUX §10](../../context/UIUX.md#10-侧边栏对话与历史) 为准。

> 派生设计文档。上游行为依据：`PRD.md` §F3（侧边栏对话与 Agent，新建对话、任务历史、回到会话上下文）；
> 交互依据：`UIUX.md` §6（侧边栏状态系统、新建对话、完成态、历史）；架构边界依据：
> `ARCHITECTURE.md` §2（`@page-agent/core`、`SidepanelApp`、`MultiPageAgent` 卡片）、§3（PageAgentCore 签名）；
> vendor 改动登记 `UPSTREAM.md`（不变量 I5）。

## 1. 背景与问题

当前项目把每条用户消息建模为一个**自包含、跑完即弃的「任务」**：

- `PageAgentCore.execute()` 每次都 `this.history = []` 清空历史、重置 `taskId`，从零起跑（`packages/core/src/PageAgentCore.ts`）。
- 唯一不清空的续跑入口 `resume()` 被 `status === 'paused'` 守卫锁住，`completed` / `error` 态进不去。
- `#assembleUserPrompt` 每步**全量重放**整个 `history`，无截断 / 摘要 / token 预算；上下文超限时 `OpenAIClient` 直接抛 `CONTEXT_LENGTH` 报错终止，无降级。

后果：用户在一个任务完成后追加「不要自己生成，去知乎找一道」这类**纠错 / 续做**指令时，`execute` 会丢弃上一轮上下文，LLM 答「我不知道你要找什么」。

人工托管功能已经沉淀了可复用的续接基元：`pushObservation()`（向记忆流注入消息）、`#runTaskLoop({ setupTask:false })`（不重置地续跑）、agent 实例天然持有 `task` / `history`。本设计在此之上把「带上下文续跑」从 `paused` 推广到 `completed`，并补上唯一缺失的上下文治理能力。

## 2. 目标

1. **对话续接**：任务完成后，用户在同一会话继续发消息，默认视为上一任务的延续（带完整上下文）；「新会话」是唯一的显式上下文边界。
2. **上下文压缩**：按**实测 token** 体积触发的 LLM 摘要压缩，根治单任务与多轮续接下 `agent_history` 的无界增长，同时**不丢回退能力**。
3. **会话持久化**：一段多轮对话在历史库中存为**一条**记录（累加）。

## 3. 非目标

- 不动 `browser_state`（轴 1）：页面内容由 `@page-agent/page-controller` 的视口 + 属性截断管理，每步整块替换、不累积，不在本设计压缩范围内。
- 不引入桌面域 ↔ 插件域通信；保持 Demo 阶段不变量 I3、I2（API Key / 对话内容不出本机、不入桌面进程）。
- 不改变 LLM 供应商接入边界（仍 OpenAI-compatible HTTP）。
- 不实现任何登录 / 验证码 / 反爬绕过。
- 不为「上下文恰好不够」做向后兼容 shim。

## 4. 名词与两条轴

| 名词                 | 含义                                                          |
| -------------------- | ------------------------------------------------------------- |
| 轮（turn）           | 用户一条指令 + Agent 对它的一次执行（到 `done` 或 `error`）。 |
| 会话（conversation） | 用户未点「新会话」前的连续多轮，对应历史库一条记录。          |
| 投影（projection）   | 真正送进 LLM 的 `<agent_history>`，是 `history` 的压缩视图。  |

**轴 1 `browser_state`**：每步替换、不累积，不治理。
**轴 2 `agent_history`**：跨步 / 跨轮累加，是本设计唯一的压缩对象。

## 5. 状态与存储模型

### 5.1 续接进入条件

`followUp(task)` 仅在 `completed` | `error` 态可用（且未 disposed / 非 running）。`paused` | `waiting_for_user` 仍分别走 `resume()` / 人工托管，不变。

### 5.2 会话持久化（每对话一条）

- `SessionRecord` 增加 `conversationId: string`（会话内多轮稳定不变）。
- 每轮完成（`completed` / `error` 且有内容）时 **upsert 同一条** `conversationId` 记录，`history` 累加为该会话全量、`task` 记最新一轮指令、`updatedAt` 刷新。
- 「新会话」开一个新的 `conversationId`。
- `db.ts` 增 `updateSession`（按 `conversationId` upsert）；历史列表按会话展示一整段。

## 6. 事件与类型

### 6.1 新增历史事件

```ts
// 用户在某一轮的原始指令（execute 的首条与每次 followUp 都写一条）
export interface UserMessageEvent {
	type: 'user_message'
	content: string
}

// 压缩产物：覆盖边界之前的旧步骤的结构化摘要（prompt-only）
export interface SummaryEvent {
	type: 'summary'
	// 带步骤索引的操作日志 + 关键状态/结论，供 LLM 直接引用与定位回退
	content: string
	// 该摘要覆盖到的最大 stepIndex（含）；投影时跳过 <= 此值的 step/observation
	coversThroughStepIndex: number
}
```

`HistoricalEvent` 并入上述两型。`user_message` 永久参与投影（神圣不可删 / 不可压）；`summary` 仅用于投影，UI 默认不渲染（`toFlowItems` 不识别即跳过，原始步骤照常显示）。

### 6.2 压缩配置（`AgentConfig`）

```ts
export interface CompactionConfig {
	enabled: boolean // 默认 true
	softTokens: number // 软阈值：history 估算 token，达到即摘要。默认 12_000
	hardTokens: number // 硬阈值：实测 promptTokens，逼近即提示/淘汰。默认按窗口 ~80%，缺省 28_000
	keepRecentSteps: number // 摘要后保留逐字的最近步数。默认 5
}
```

触发指标：软阈值用**本地估算的投影内 `<agent_history>` token**（拼装时按 `chars/4` 估），只盯可压的 history，不被大页面误触发；硬阈值用上一步实测 `usage.promptTokens`（`packages/core/src/types.ts` 已有该字段）作为「逼近上限」警报。

## 7. Core 行为（`@page-agent/core` 本地补丁）

### 7.1 对话续接 `followUp()`

```ts
followUp(task: string): Promise<ExecutionResult>
```

- 不清空 `history` / 内部状态；`this.task = task`；生成新 `taskId` 与新 `AbortController`。
- 向 `history` push 一条 `{ type:'user_message', content: task }`。
- 状态置 `running`，跑 `#runTaskLoop({ setupTask: true })`（`setupTask:true` 以重启 runtime/心跳、重置 tabs，因为上一轮已结束；它本身不清 history，清空只发生在 `execute`）。

`execute()` 同步小改：保留原有清空语义，但在清空后、起跑前 push 一条 `{ type:'user_message', content: task }`，使原始指令在后续轮次 `this.task` 变化后仍留在 history。

### 7.2 Prompt 多轮重构（投影）

`#assembleUserPrompt` 改为渲染**投影**而非全量：

- `<user_request>` = `this.task`（当前轮指令）。
- `<agent_history>` 按时间顺序渲染：
  - 跳过 `coversThroughStepIndex` 覆盖的旧 `step` / `observation`；
  - 渲染**最新 `summary`**（若有）置于历史开头；
  - 渲染所有 `user_message`（以清晰分隔，如 `<user_message_k>`），使上一轮的「用户问 A → 步骤 → done 结果」读起来是已完成的一轮；
  - 渲染摘要边界之后的 `step` / `observation`（含上一轮的 `done` 结果，标注为「上一轮回答」）。

效果：LLM 读到「先前要 A、产出 R，现在要 B」，且只承担「最新 summary + 最近窗口」的体积。

### 7.3 压缩（软阈值 → 一次 LLM 摘要）

每步起始 `#maybeCompactHistory()`：

1. 估算当前投影内 history token。`< softTokens` → 不动。
2. `>= softTokens` → 取「摘要边界之后、最近 `keepRecentSteps` 步之前」的 `step` / `observation`，连同上一条 `summary`，调用**一次** LLM 摘要，产出新的结构化 `SummaryEvent`（步骤索引 + 一句话 + 关键状态/结论），push 进 `history` 并更新 `coversThroughStepIndex` 到「保留窗口之前」。原始事件**留在 `history`**（供 UI 与回退），仅被投影跳过。
3. 可重复：history 再涨过线，就把「旧 summary + 新增步骤」重压成新 summary。

**摘要提示词约束**：必须保留可定位的**动作序列**（`step N: 动作 → 结果` 骨架）+ 当前页面/状态 + 关键结论，**不得**退化成无法回退的散文；并附一句告知「更早步骤详情已归档，需要时用 `recall_steps` 取回」。摘要模型默认 agent 自身文本模型。

**失败兜底**：摘要 LLM 调用失败 → 机械降级（保留 `user_message` + 最近 `keepRecentSteps` 步，其余移出投影并留 `<sys>earlier steps condensed</sys>` 标记），任务不中断。

### 7.4 回退取回工具 `recall_steps`

```ts
tools.set(
	'recall_steps',
	tool({
		description:
			'Retrieve the verbatim record of earlier step(s) by their step index, when the summary is not detailed enough (e.g. to roll back or redo a past action).',
		inputSchema: z.object({ indices: z.array(z.number()).min(1).max(10) }),
		execute: async function (this: PageAgentCore, { indices }) {
			// 从全量 history 按 stepIndex 取原始 step，逐字返回
		},
	}),
)
```

- 取回内容作为该步 `action.output` 进入 history → 自然出现在后续投影窗口（亦受后续压缩约束）。
- 工具按宿主能力常开（无外部依赖）；`done` / `ask_user` / `request_user_takeover` / `recall_steps` 不参与卡住检测（与既有约定一致）。

### 7.5 硬阈值（快爆）：提示 → FIFO 淘汰

- **实测 `promptTokens >= hardTokens`** 时进入近溢出处理：
  - **轮次之间**（用户正要发下一条）→ 不自动续，先经宿主提示「建议开启新会话」（见 §8）。用户仍坚持发 → 继续并执行 FIFO 淘汰。
  - **单个长任务内**（无轮次可打断）→ 不阻塞等待用户：先 §7.3 摘要；仍不够 → **FIFO 淘汰投影内最早的 `step` / `observation`**（推进「投影地板」指针，原件留存储、可 `recall_steps`）。
- `user_message` 与最新 `summary` **永不淘汰**。
- 最终兜底：即使淘汰后仍逼近上限，按最近窗口机械截断，**绝不抛错终止任务**。

> Core 仅暴露「近溢出」信号与 FIFO 能力；「是否提示用户、用何种 UI」由宿主决定（§8）。无人工交互的宿主（如 Hub）走自动摘要 + FIFO，不提示。

## 8. 用户体验（SidepanelApp）

### 8.1 续接线程

任务完成后对话**留屏不清**；用户继续发消息 → 走 `followUp`，对话以线程式累加（`[用户A][结果][用户B][结果]…`）。`sessionController.execute` 当前的 `setHistory([])` 仅在「新会话」后的首条 `execute` 生效；`followUp` 路径不清屏。

提交路由：SidepanelApp 的发送入口根据状态选择——`completed`/`error` 且会话未清 → `followUp`；否则 `execute`。

### 8.2 新会话与近溢出横幅

- 「+ 新会话」（`resetConversation`）仍是唯一硬重置；呈现遵循 [统一 UIUX §10](../../context/UIUX.md#10-侧边栏对话与历史) 的用户确认例外，恢复约 520ms 收拢到历史动效后开启新 `conversationId`。
- **近溢出提示采用横幅（banner）**，非模态、非 toast：当会话逼近 `hardTokens`、用户正要继续时，于侧边栏对话区顶部 / 输入框上方展示一条横幅：
  - 文案：上下文已较长，建议开启新会话以获得更好效果；
  - 主操作：`新会话`（= `resetConversation`）；次操作：`继续当前会话`（关闭横幅并允许继续，后续走 FIFO 淘汰）。
  - 可关闭；运行中不打断当前任务。

### 8.3 回退

回退由 LLM 经 `recall_steps` 完成，UI 无需新增控件；历史详情/对话流仍渲染**全量** `history`（含被摘要/淘汰出投影的原始步骤），用户始终能看到完整轨迹。

## 9. 文档影响（实施时同 commit 同步）

- `PRD.md` §F3：新增「完成后同会话续接、按上下文体积自动压缩、近溢出建议新会话」；明确「新会话」为上下文边界。
- `UIUX.md` §6：新增近溢出横幅形态与文案；续接线程的呈现说明。
- `ARCHITECTURE.md`：更新 `@page-agent/core` 卡片（续接 + 上下文压缩 + `recall_steps`）、`SidepanelApp` 卡片（续接路由、近溢出横幅、会话 upsert）、`MultiPageAgent` 卡片（摘要模型注入）；§3 增补 `PageAgentCore.followUp()` 签名与压缩配置。
- `UPSTREAM.md`：登记新本地补丁「conversational continuation + history compaction」（scope `packages/core`：loop control、prompt 投影、`user_message`/`summary` 类型、`recall_steps` 工具、压缩配置），隔离便于对上游 diff。
- vendor 补丁配套回归测试（ARCHITECTURE §6 要求 `pnpm -r test` 必绿）。

## 10. 验收标准

- 任务完成后在同一会话发消息，Agent 带着上一轮上下文继续（不再答「不知道你要找什么」）。
- 「+ 新会话」后首条消息从零开始，旧上下文不带入。
- 历史库中一段多轮对话为**一条**记录（`conversationId` 累加），历史列表按会话展示。
- 当 `<agent_history>` 估算 token 达 `softTokens`：触发一次 LLM 摘要，旧步骤移出投影、`history` 仍保留原件；可多次触发。
- 摘要内容含步骤索引与一句话；`recall_steps(indices)` 能按索引取回某步原文并供 Agent 据此回退/重做。
- `promptTokens` 逼近 `hardTokens`：轮次间出现「建议新会话」**横幅**；用户选择继续则按 FIFO 淘汰最早步骤，`user_message` 不被淘汰；长任务内自动摘要→FIFO，任务**不因上下文超限而崩**。
- `browser_state` 渲染逻辑不变（仍当前视口快照、每步替换）。
- `resume()` / 人工托管 / `stop()` 行为不回归。
- `pnpm -F extension test` 与 vendor 回归测试通过。
