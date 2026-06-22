# 对话续接与上下文压缩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务完成后用户在同一会话续发消息能继承上下文（`followUp`），并用按 token 体积触发的 LLM 摘要 + 全量存储/投影拆分 + `recall_steps` 回退 + FIFO 兜底治理 `agent_history` 无界增长。

**Architecture:** 核心逻辑作为 `packages/core` 的本地补丁（登记 `UPSTREAM.md`），集中在 PageAgentCore 的 loop control、prompt 投影、事件类型与工具；插件域 `apps/extension` 接线（续接路由、近溢出横幅、会话 upsert）。`history` 永久全量（UI/持久化/回退），送 LLM 的是它的压缩投影。

**Tech Stack:** TypeScript、Zod v4、vitest、React、idb（IndexedDB）、`@page-agent/{core,llms}`。

**对应 spec：** [../specs/2026-06-22-conversation-continuation-design.md](../specs/2026-06-22-conversation-continuation-design.md)

## Global Constraints

- **I5（vendor 补丁）**：任何 `packages/*` 改动先登记 `UPSTREAM.md`，保持上游包名/目录/版权头，隔离便于对 alibaba/page-agent diff。
- **I2/I3**：API Key / 对话内容不出本机、不入桌面进程；不引入桌面↔插件通信。
- **文档同 commit**（SELF_CONSTRAINTS B3）：改行为 → `PRD.md`；改模块/依赖/签名 → `ARCHITECTURE.md`；vendor 改动 → `UPSTREAM.md`；视觉/交互 → `UIUX.md`。
- **vendor 补丁必须配套回归测试**（ARCHITECTURE §6）。
- **压缩默认值**：`softTokens = 12_000`、`hardTokens = 28_000`、`keepRecentSteps = 5`、`enabled = true`；摘要模型用 agent 自身 `this.#llm`。
- **触发指标**：软阈值用本地估算的投影 `<agent_history>` token（`chars / 4`）；硬阈值用上一步实测 `usage.promptTokens`。
- **测试命令**：核心 `pnpm -F @page-agent/core test`；插件 `pnpm -F extension build`（esbuild，不做类型检查）+ `pnpm -F extension test`。`pnpm -r test` 在沙箱内因 desktop 缺 Electron 假性失败并跳过 extension，勿用。`apps/extension/src/components/misc.test.ts` 预存 3 个与本任务无关的类型错误，忽略。
- **命名**：事件 `type` 用 snake_case 字符串（`user_message`/`summary`）；方法 camelCase；工具名 snake_case（`recall_steps`）。

---

## File Structure

**Core（`packages/core/src`）**
- `types.ts` — 修改：`HistoricalEvent` 并入 `UserMessageEvent`/`SummaryEvent`；`AgentConfig` 增 `compaction?: CompactionConfig`。
- `PageAgentCore.ts` — 修改：`execute` 写首条 `user_message`；新增 `followUp()`；新增 `#projectHistory()`、`#estimateHistoryTokens()`、`#maybeCompactHistory()`、`#summarizeForCompaction()`、`#evictOldest()`；`#assembleUserPrompt` 改渲染投影。
- `tools/index.ts` — 修改：新增 `recall_steps` 工具。
- `PageAgentCore.test.ts` — 修改：新增续接/投影/压缩/回退/兜底用例。
- `prompts/system_prompt.md` 与 `apps/extension/src/agent/system_prompt.md` — 修改：`<agent_history>` 增 `<summary>`/`<user_message>` 说明 + `recall_steps` 规则。

**Extension（`apps/extension/src`）**
- `lib/db.ts` + `lib/db.test.ts` — 修改：`SessionRecord.conversationId`、`updateSession`、DB 版本与索引。
- `agent/useAgent.ts` + `agent/useAgent.test.ts` — 修改：`followUp`、controller 路由、不清屏。
- `entrypoints/sidepanel/App.tsx` + `entrypoints/sidepanel/App.test.ts` — 修改：发送路由（followUp vs execute）、会话 upsert、横幅挂载。
- `components/ContextBanner.tsx`（新建）+ `components/ContextBanner.test.ts`（新建）— 近溢出横幅。
- `agent/MultiPageAgent.ts` — 修改：透传 `compaction` 配置。

**Docs（`.project.agents/docs/context`）** — `PRD.md`、`UIUX.md`、`ARCHITECTURE.md`、`UPSTREAM.md`。

---

## Task 1: 事件类型 + 压缩配置 + execute 记录首条 user_message

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/PageAgentCore.ts:280-305`（`execute`）
- Test: `packages/core/src/PageAgentCore.test.ts`

**Interfaces:**
- Produces: `UserMessageEvent { type:'user_message'; content:string }`、`SummaryEvent { type:'summary'; content:string; coversThroughIndex:number }`、`CompactionConfig { enabled:boolean; softTokens:number; hardTokens:number; keepRecentSteps:number }`，并入 `HistoricalEvent` 与 `AgentConfig.compaction?`。

- [ ] **Step 1: 写失败测试**

```ts
it('records the initial task as a user_message event', async () => {
	const agent = new PageAgentCore(
		createConfig({
			customFetch: async () => createToolCallResponse({ done: { text: 'ok', success: true } }, 1),
		}),
	)
	await agent.execute('出一道物理题')
	expect(agent.history[0]).toEqual({ type: 'user_message', content: '出一道物理题' })
	agent.dispose()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @page-agent/core test -- -t "records the initial task"`
Expected: FAIL（`history[0]` 是 step，不是 user_message）

- [ ] **Step 3: 加类型**（`types.ts`）

```ts
export interface UserMessageEvent {
	type: 'user_message'
	content: string
}

export interface SummaryEvent {
	type: 'summary'
	content: string
	/** history 数组下标：<= 此下标的非 user_message 事件不进投影（含本下标） */
	coversThroughIndex: number
}

export type HistoricalEvent =
	| AgentStepEvent
	| ObservationEvent
	| UserTakeoverEvent
	| RetryEvent
	| AgentErrorEvent
	| UserMessageEvent
	| SummaryEvent

export interface CompactionConfig {
	enabled: boolean
	softTokens: number
	hardTokens: number
	keepRecentSteps: number
}
```

并在 `AgentConfig` 增：`compaction?: CompactionConfig`。

- [ ] **Step 4: execute 写首条 user_message**（`PageAgentCore.ts`，`this.history = []` 之后、`#setStatus('running')` 之前）

```ts
this.history = []
this.history.push({ type: 'user_message', content: task })
this.#observations = []
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm -F @page-agent/core test -- -t "records the initial task"`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/types.ts packages/core/src/PageAgentCore.test.ts
git commit -m "feat(core): add user_message/summary events and compaction config; record initial task"
```

---

## Task 2: followUp() —— 不清空历史的续跑

**Files:**
- Modify: `packages/core/src/PageAgentCore.ts`（`execute` 之后）
- Test: `packages/core/src/PageAgentCore.test.ts`

**Interfaces:**
- Consumes: `#runTaskLoop({ setupTask })`（已存在）、`user_message` 事件（Task 1）。
- Produces: `followUp(task: string): Promise<ExecutionResult>`。

- [ ] **Step 1: 写失败测试**

```ts
it('followUp continues without wiping history', async () => {
	let step = 0
	const agent = new PageAgentCore(
		createConfig({
			customFetch: async () =>
				createToolCallResponse({ done: { text: `r${++step}`, success: true } }, step),
		}),
	)
	await agent.execute('任务A')
	const afterFirst = agent.history.length
	await agent.followUp('任务B')

	const userMsgs = agent.history.filter((e) => e.type === 'user_message')
	expect(userMsgs.map((e) => (e as { content: string }).content)).toEqual(['任务A', '任务B'])
	expect(agent.history.length).toBeGreaterThan(afterFirst) // 历史累加，未清空
	expect(agent.task).toBe('任务B')
	agent.dispose()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @page-agent/core test -- -t "followUp continues"`
Expected: FAIL（`agent.followUp` 不是函数）

- [ ] **Step 3: 实现 followUp**（仿 `execute`，但不清 history/observations/states）

```ts
async followUp(task: string): Promise<ExecutionResult> {
	if (this.disposed) throw new Error('PageAgent has been disposed. Create a new instance.')
	if (this.#runLoopActive) throw new Error('A task is already running.')
	if (this.#status !== 'completed' && this.#status !== 'error') {
		throw new Error('followUp requires a completed or errored task.')
	}
	if (!task) throw new Error('Task is required')

	this.task = task
	this.taskId = uid()
	this.history.push({ type: 'user_message', content: task })
	this.#pauseRequested = false
	this.#abortController = new AbortController()

	this.#setStatus('running')
	this.#emitHistoryChange()

	return this.#runTaskLoop({ setupTask: true })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @page-agent/core test -- -t "followUp continues"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/PageAgentCore.ts packages/core/src/PageAgentCore.test.ts
git commit -m "feat(core): add followUp() to continue a finished task with prior context"
```

---

## Task 3: Prompt 投影 —— 渲染 user_message、跳过被摘要覆盖的旧事件

**Files:**
- Modify: `packages/core/src/PageAgentCore.ts`（新增 `#projectHistory()`；改 `#assembleUserPrompt` 的 `<agent_history>` 段）
- Test: `packages/core/src/PageAgentCore.test.ts`

**Interfaces:**
- Consumes: `SummaryEvent.coversThroughIndex`（Task 1）。
- Produces: `#projectHistory(): HistoricalEvent[]`（投影：最新 summary + 所有 user_message + 未被覆盖的事件，按原序；更早 summary 丢弃）。

- [ ] **Step 1: 写失败测试**（手动注入 summary，断言投影行为）

```ts
it('projection drops covered steps but keeps user_message and summary', async () => {
	const captured: string[] = []
	let step = 0
	const agent = new PageAgentCore(
		createConfig({
			customFetch: async (_url, init) => {
				captured.push(getUserPrompt(init as RequestInit))
				step++
				if (step === 1) return createToolCallResponse({ wait: { seconds: 1 } }, step)
				return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
			},
		}),
	)
	// 注入：覆盖到 index 1 的 summary（覆盖首条 user_message 之后的早期 step）
	agent.history.push({ type: 'user_message', content: '任务A' })
	agent.history.push({
		type: 'step', stepIndex: 0, reflection: { memory: 'SECRET_OLD_STEP' },
		action: { name: 'click_element_by_index', input: {}, output: 'clicked' },
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
	} as never)
	agent.history.push({ type: 'summary', content: 'SUMMARY_HEAD step0: click→clicked', coversThroughIndex: 1 })

	await agent.followUp('任务B')

	const firstPrompt = captured[0]
	expect(firstPrompt).toContain('SUMMARY_HEAD')        // 摘要进投影
	expect(firstPrompt).toContain('任务A')                // user_message 永远保留
	expect(firstPrompt).toContain('任务B')
	expect(firstPrompt).not.toContain('SECRET_OLD_STEP') // 被覆盖的旧 step 不进投影
	agent.dispose()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @page-agent/core test -- -t "projection drops covered steps"`
Expected: FAIL（旧 step 仍出现 / summary 未渲染）

- [ ] **Step 3: 实现 `#projectHistory` 并接入 `#assembleUserPrompt`**

```ts
#projectHistory(): HistoricalEvent[] {
	let latestSummary: SummaryEvent | undefined
	for (let i = this.history.length - 1; i >= 0; i--) {
		const e = this.history[i]
		if (e.type === 'summary') { latestSummary = e; break }
	}
	const floor = latestSummary ? latestSummary.coversThroughIndex : -1

	const projected: HistoricalEvent[] = []
	this.history.forEach((event, index) => {
		if (event.type === 'summary') return // summary 单独处理，丢弃更早的
		if (event === latestSummary) return
		if (index <= floor && event.type !== 'user_message') return
		projected.push(event)
	})
	return latestSummary ? [latestSummary, ...projected] : projected
}
```

`#assembleUserPrompt` 的 `<agent_history>` 改为遍历 `this.#projectHistory()`，并新增分支：

```ts
for (const event of this.#projectHistory()) {
	if (event.type === 'summary') {
		prompt += `<summary>\n${event.content}\n</summary>\n`
	} else if (event.type === 'user_message') {
		prompt += `<user_message>${event.content}</user_message>\n`
	} else if (event.type === 'step') {
		stepIndex++
		prompt += `<step_${stepIndex}>\n`
		prompt += `Evaluation of Previous Step: ${event.reflection.evaluation_previous_goal}\n`
		prompt += `Memory: ${event.reflection.memory}\n`
		prompt += `Next Goal: ${event.reflection.next_goal}\n`
		prompt += `Action Results: ${event.action.output}\n`
		prompt += `</step_${stepIndex}>\n`
	} else if (event.type === 'observation') {
		prompt += `<sys>${event.content}</sys>\n`
	} else if (event.type === 'user_takeover') {
		prompt += `<sys>User took over control and made changes to the page</sys>\n`
	}
}
```

> `stepIndex`（展示用递增）维持原状；步数统计 `stepCount` 改用 `this.#projectHistory().filter(e => e.type === 'step')` 以与投影一致。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @page-agent/core test -- -t "projection drops covered steps"`
Expected: PASS

- [ ] **Step 5: 回归既有 prompt 测试**

Run: `pnpm -F @page-agent/core test`
Expected: PASS（既有用例无 summary 时 floor=-1，行为不变）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/PageAgentCore.ts packages/core/src/PageAgentCore.test.ts
git commit -m "feat(core): render history as compaction projection (summary + user_message + uncovered)"
```

---

## Task 4: 软阈值触发 LLM 摘要压缩

**Files:**
- Modify: `packages/core/src/PageAgentCore.ts`（loop 内调用 + 三个私有方法 + 默认配置）
- Test: `packages/core/src/PageAgentCore.test.ts`

**Interfaces:**
- Consumes: `this.#llm.invoke(messages, tools, signal, { toolChoiceName })`、`#projectHistory()`、`CompactionConfig`。
- Produces: `#compaction: CompactionConfig`（构造时填默认）、`#estimateHistoryTokens(): number`、`#maybeCompactHistory(): Promise<void>`、`#summarizeForCompaction(events): Promise<string>`。

- [ ] **Step 1: 写失败测试**（低 softTokens + 摘要器返回固定串）

```ts
it('compacts older steps into a summary when history exceeds softTokens', async () => {
	const prompts: string[] = []
	let step = 0
	const agent = new PageAgentCore(
		createConfig({
			compaction: { enabled: true, softTokens: 1, hardTokens: 100_000, keepRecentSteps: 1 },
			customFetch: async (url, init) => {
				const body = JSON.parse(String((init as RequestInit).body))
				const isSummary = body.tools?.some((t: any) => t.function?.name === 'submit_summary')
				if (isSummary) {
					return new Response(JSON.stringify({
						choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 's', type: 'function',
							function: { name: 'submit_summary', arguments: JSON.stringify({ summary: 'COMPACTED_DIGEST' }) } }] } }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}), { status: 200, headers: { 'Content-Type': 'application/json' } })
				}
				prompts.push(getUserPrompt(init as RequestInit))
				step++
				if (step < 3) return createToolCallResponse({ wait: { seconds: 1 } }, step)
				return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
			},
		}),
	)
	await agent.execute('长任务')
	expect(agent.history.some((e) => e.type === 'summary')).toBe(true)            // 生成了摘要
	expect(prompts[prompts.length - 1]).toContain('COMPACTED_DIGEST')             // 后续投影带摘要
	agent.dispose()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @page-agent/core test -- -t "compacts older steps"`
Expected: FAIL（无 summary 事件）

- [ ] **Step 3: 构造默认配置**（构造函数内）

```ts
this.#compaction = config.compaction ?? {
	enabled: true, softTokens: 12_000, hardTokens: 28_000, keepRecentSteps: 5,
}
```

声明字段：`#compaction: CompactionConfig`。

- [ ] **Step 4: 实现估算 + 触发 + 摘要器**

```ts
#estimateHistoryTokens(): number {
	let chars = 0
	for (const e of this.#projectHistory()) chars += JSON.stringify(e).length
	return Math.ceil(chars / 4)
}

async #summarizeForCompaction(events: HistoricalEvent[]): Promise<string> {
	const transcript = events
		.map((e, i) => (e.type === 'step'
			? `step ${e.stepIndex}: ${e.action.name} → ${e.action.output} | memory: ${e.reflection.memory ?? ''}`
			: e.type === 'observation' ? `sys: ${e.content}`
			: e.type === 'summary' ? `prior_summary: ${e.content}` : ''))
		.filter(Boolean).join('\n')
	const tool = { submit_summary: {
		description: 'Submit the compacted progress summary.',
		inputSchema: z.object({ summary: z.string() }),
		execute: async (input: { summary: string }) => input.summary,
	} }
	const result = await this.#llm.invoke(
		[
			{ role: 'system', content: 'You compress an autonomous web agent\'s progress. Preserve a step-indexed action log (step N: action → result), current page/state, key findings and unresolved items. Keep it faithful and concise — never drop what step did what (it powers rollback). End with: "Earlier step details are archived; call recall_steps(indices) to fetch verbatim."' },
			{ role: 'user', content: transcript },
		],
		tool,
		this.#abortController.signal,
		{ toolChoiceName: 'submit_summary' },
	)
	return (result.toolResult as { output: string }).output
}

async #maybeCompactHistory(): Promise<void> {
	if (!this.#compaction.enabled) return
	if (this.#estimateHistoryTokens() < this.#compaction.softTokens) return

	const projected = this.#projectHistory()
	const steps = projected.filter((e) => e.type === 'step')
	if (steps.length <= this.#compaction.keepRecentSteps) return
	const keepFrom = steps[steps.length - this.#compaction.keepRecentSteps] as AgentStepEvent
	const keepFromIndex = this.history.indexOf(keepFrom)

	const toSummarize = this.history
		.slice(0, keepFromIndex)
		.filter((e) => e.type === 'step' || e.type === 'observation' || e.type === 'summary')
	if (toSummarize.length === 0) return

	const content = await this.#summarizeForCompaction(toSummarize)
	const coversThroughIndex = keepFromIndex - 1
	this.history.splice(keepFromIndex, 0, { type: 'summary', content, coversThroughIndex })
	this.#emitHistoryChange()
}
```

在 `#runTaskLoopBody` 的 `while (true)` 顶部、`onBeforeStep` 之前调用：

```ts
await this.#maybeCompactHistory()
this.#abortController.signal.throwIfAborted()
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm -F @page-agent/core test -- -t "compacts older steps"`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/PageAgentCore.ts packages/core/src/PageAgentCore.test.ts
git commit -m "feat(core): token-triggered LLM summarization compaction"
```

---

## Task 5: 摘要失败的机械降级

**Files:**
- Modify: `packages/core/src/PageAgentCore.ts`（`#maybeCompactHistory` 包 try/catch）
- Test: `packages/core/src/PageAgentCore.test.ts`

**Interfaces:**
- Consumes: `#summarizeForCompaction`（Task 4）。
- Produces: 摘要异常时插入机械 `summary`（固定占位 content），不抛错。

- [ ] **Step 1: 写失败测试**（摘要 fetch 抛错，任务仍完成且有降级 summary）

```ts
it('falls back to mechanical condense when summarizer fails', async () => {
	let step = 0
	const agent = new PageAgentCore(
		createConfig({
			compaction: { enabled: true, softTokens: 1, hardTokens: 100_000, keepRecentSteps: 1 },
			customFetch: async (url, init) => {
				const body = JSON.parse(String((init as RequestInit).body))
				if (body.tools?.some((t: any) => t.function?.name === 'submit_summary')) {
					throw new Error('summarizer down')
				}
				step++
				if (step < 3) return createToolCallResponse({ wait: { seconds: 1 } }, step)
				return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
			},
		}),
	)
	const result = await agent.execute('长任务')
	expect(result.success).toBe(true) // 任务没崩
	expect(agent.history.some((e) => e.type === 'summary')).toBe(true) // 有降级摘要
	agent.dispose()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @page-agent/core test -- -t "falls back to mechanical"`
Expected: FAIL（摘要器抛错冒泡，任务 error）

- [ ] **Step 3: 包裹降级**（`#maybeCompactHistory` 内 `const content = ...` 改为）

```ts
let content: string
try {
	content = await this.#summarizeForCompaction(toSummarize)
} catch (error) {
	if (this.#isAbortError(error)) throw error
	const dropped = toSummarize.filter((e) => e.type === 'step').length
	content = `[earlier ${dropped} steps condensed; summarizer unavailable. Call recall_steps(indices) for verbatim records.]`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @page-agent/core test -- -t "falls back to mechanical"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/PageAgentCore.ts packages/core/src/PageAgentCore.test.ts
git commit -m "feat(core): mechanical condense fallback when compaction summarizer fails"
```

---

## Task 6: recall_steps 回退取回工具

**Files:**
- Modify: `packages/core/src/tools/index.ts`
- Test: `packages/core/src/PageAgentCore.test.ts`

**Interfaces:**
- Consumes: `this.history`（全量 step 原件）。
- Produces: 工具 `recall_steps`，入参 `{ indices: number[] }`，返回按 `stepIndex` 命中的逐字 step 文本。

- [ ] **Step 1: 写失败测试**（LLM 调 recall_steps，输出含被摘要掉那步的原文）

```ts
it('recall_steps returns the verbatim record of a step by index', async () => {
	let step = 0
	const agent = new PageAgentCore(
		createConfig({
			customFetch: async () => {
				step++
				if (step === 1) return createToolCallResponse({ recall_steps: { indices: [0] } }, step)
				return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
			},
		}),
	)
	agent.history.push({ type: 'user_message', content: '任务A' })
	agent.history.push({
		type: 'step', stepIndex: 0, reflection: { memory: 'm0' },
		action: { name: 'input_text', input: { text: 'VERBATIM_VALUE' }, output: 'typed VERBATIM_VALUE' },
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
	} as never)

	await agent.followUp('回到刚才输入那步')
	const recalled = agent.history.find(
		(e) => e.type === 'step' && e.action.name === 'recall_steps',
	) as AgentStepEvent
	expect(recalled.action.output).toContain('VERBATIM_VALUE')
	agent.dispose()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @page-agent/core test -- -t "recall_steps returns"`
Expected: FAIL（工具不存在 → 校验报错）

- [ ] **Step 3: 实现工具**（`tools/index.ts` 末尾 `tools.set`）

```ts
tools.set(
	'recall_steps',
	tool({
		description:
			'Retrieve the verbatim record of earlier step(s) by their step index, when the summary is not detailed enough (e.g. to roll back or redo a past action). Indices come from the <summary> step log.',
		inputSchema: z.object({ indices: z.array(z.number()).min(1).max(10) }),
		execute: async function (this: PageAgentCore, { indices }) {
			const wanted = new Set(indices)
			const found = this.history.filter(
				(e): e is AgentStepEvent => e.type === 'step' && wanted.has(e.stepIndex),
			)
			if (found.length === 0) return `No archived steps found for indices ${indices.join(', ')}.`
			return found
				.map((e) =>
					`step ${e.stepIndex}: ${e.action.name}\ninput: ${JSON.stringify(e.action.input)}\noutput: ${e.action.output}`,
				)
				.join('\n---\n')
		},
	}),
)
```

> `recall_steps` 加入 `MultiPageAgent` 卡住检测白名单（Task 11 一并处理；core 不做卡住检测）。`AgentStepEvent` 已从 `../types` 导入；若未导入则补 `import type { AgentStepEvent } from '../types'`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @page-agent/core test -- -t "recall_steps returns"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/index.ts packages/core/src/PageAgentCore.test.ts
git commit -m "feat(core): add recall_steps tool to fetch archived step records by index"
```

---

## Task 7: 硬阈值 FIFO 淘汰 + 永不因上下文超限崩溃

**Files:**
- Modify: `packages/core/src/PageAgentCore.ts`（`#maybeCompactHistory` 末尾追加硬阈值处理；`#evictOldest`）
- Test: `packages/core/src/PageAgentCore.test.ts`

**Interfaces:**
- Consumes: 上一步 `usage.promptTokens`（取投影内最近 step）、`hardTokens`。
- Produces: `#evictOldest()` —— 把投影内最早的非 `user_message` step/observation 提升进一个 `summary` 覆盖边界（推进 floor），`user_message` 永不淘汰。

- [ ] **Step 1: 写失败测试**（低 hardTokens；断言最早 step 被挤出投影、user_message 仍在、任务不崩）

```ts
it('evicts oldest steps under hard pressure but keeps user_message and never throws', async () => {
	const prompts: string[] = []
	let step = 0
	const agent = new PageAgentCore(
		createConfig({
			// 关掉软摘要，单测硬阈值 FIFO
			compaction: { enabled: true, softTokens: 100_000, hardTokens: 1, keepRecentSteps: 1 },
			customFetch: async (url, init) => {
				prompts.push(getUserPrompt(init as RequestInit))
				step++
				if (step < 4) return createToolCallResponse({ wait: { seconds: 1 } }, step)
				return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
			},
		}),
	)
	const result = await agent.execute('任务A')
	expect(result.success).toBe(true)
	const last = prompts[prompts.length - 1]
	expect(last).toContain('任务A')               // user_message 不被淘汰
	agent.dispose()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @page-agent/core test -- -t "evicts oldest steps"`
Expected: FAIL（`#evictOldest` 不存在）

- [ ] **Step 3: 实现**（`#maybeCompactHistory` 末尾追加；新增 `#evictOldest`）

```ts
// 在 #maybeCompactHistory 末尾（摘要逻辑之后）：
const lastStep = [...this.#projectHistory()].reverse().find((e) => e.type === 'step') as AgentStepEvent | undefined
if (lastStep && lastStep.usage.promptTokens >= this.#compaction.hardTokens) {
	this.#evictOldest()
}
```

```ts
#evictOldest(): void {
	const projected = this.#projectHistory()
	const firstEvictable = projected.find((e) => e.type === 'step' || e.type === 'observation')
	if (!firstEvictable) return
	const idx = this.history.indexOf(firstEvictable)
	const existing = [...this.history].reverse().find((e) => e.type === 'summary') as SummaryEvent | undefined
	if (existing && existing.coversThroughIndex >= idx) return
	if (existing) {
		existing.coversThroughIndex = idx
	} else {
		this.history.splice(idx + 1, 0, {
			type: 'summary', content: '[oldest steps evicted under context pressure; call recall_steps(indices) for verbatim records.]',
			coversThroughIndex: idx,
		})
	}
	this.#emitHistoryChange()
}
```

> 兜底：投影渲染本身受 `hardTokens` 约束——若淘汰后仍逼近，下一步循环再次淘汰，直至 `done`。`OpenAIClient` 的 `CONTEXT_LENGTH` 仍可能在极端单页面下触发，但那属轴 1（page-controller），不在本任务。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @page-agent/core test -- -t "evicts oldest steps"`
Expected: PASS

- [ ] **Step 5: 全核心回归**

Run: `pnpm -F @page-agent/core test`
Expected: PASS（全绿）

- [ ] **Step 6: 提交 + UPSTREAM 登记 + system prompt**

更新 `apps/extension/src/agent/system_prompt.md` 与 `packages/core/src/prompts/system_prompt.md` 的 `<agent_history>` 段，加：

```
- <summary> 是更早步骤的压缩摘要；其中的 step 索引可配合 recall_steps(indices) 取回逐字原文用于回退。
- <user_message> 是用户在各轮的原始指令，按时间出现；最新一条同时是 <user_request>。
```

`recall_steps` 工具规则加入 `<browser_rules>`：仅在摘要不足以回退/重做某步时调用。

在 `UPSTREAM.md` 追加补丁条目：

```md
## Local patch: conversational continuation + history compaction
- Scope: `packages/core`
- 内容：followUp() 续接；user_message/summary 事件与压缩配置；#assembleUserPrompt 投影；token 触发 LLM 摘要 + 机械降级；recall_steps 工具；硬阈值 FIFO 淘汰；system_prompt 增 <summary>/<user_message>/recall_steps 说明。
- Upstream sync note: 隔离在 public types、PageAgentCore loop control、tools、prompts，便于对 alibaba/page-agent diff。
```

```bash
git add packages/core apps/extension/src/agent/system_prompt.md .project.agents/docs/context/UPSTREAM.md
git commit -m "feat(core): FIFO eviction under hard token pressure; register UPSTREAM patch; prompt docs"
```

---

## Task 8: db —— conversationId + updateSession（每对话一条）

**Files:**
- Modify: `apps/extension/src/lib/db.ts`
- Test: `apps/extension/src/lib/db.test.ts`

**Interfaces:**
- Produces: `SessionRecord` 增 `conversationId: string`、`updatedAt: number`；`updateSession(conversationId, patch)` upsert；`getByConversation(conversationId)`。

- [ ] **Step 1: 写失败测试**

```ts
it('upserts one record per conversationId', async () => {
	const a = await saveSession({ conversationId: 'c1', task: 'A', history: [], status: 'completed' })
	await updateSession('c1', { task: 'B', history: [{ type: 'user_message', content: 'B' } as never], status: 'completed' })
	const all = await listSessions()
	const c1 = all.filter((r) => r.conversationId === 'c1')
	expect(c1).toHaveLength(1)
	expect(c1[0].id).toBe(a.id)
	expect(c1[0].task).toBe('B')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F extension test -- -t "upserts one record"`
Expected: FAIL（`updateSession`/`conversationId` 不存在）

- [ ] **Step 3: 实现**（`db.ts`）

`SessionRecord` 增 `conversationId: string` 与 `updatedAt: number`；DB 版本号 +1 并在 `upgrade` 增 `by-conversation` 索引；`saveSession` 入参带 `conversationId`、写 `updatedAt`；新增：

```ts
export async function updateSession(
	conversationId: string,
	patch: Pick<SessionRecord, 'task' | 'history' | 'status'>,
): Promise<SessionRecord> {
	const db = await getDB()
	const existing = (await db.getAllFromIndex('sessions', 'by-conversation', conversationId))[0]
	if (!existing) {
		return saveSession({ conversationId, ...patch })
	}
	const updated: SessionRecord = { ...existing, ...patch, updatedAt: Date.now() }
	await db.put('sessions', updated)
	return updated
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F extension test -- -t "upserts one record"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/lib/db.ts apps/extension/src/lib/db.test.ts
git commit -m "feat(ext): per-conversation session record with conversationId upsert"
```

---

## Task 9: useAgent —— followUp + 续接不清屏

**Files:**
- Modify: `apps/extension/src/agent/useAgent.ts`
- Test: `apps/extension/src/agent/useAgent.test.ts`

**Interfaces:**
- Consumes: `agent.followUp`（Task 2）。
- Produces: `AgentSessionController.followUp(task)`（不 `setHistory([])`）；`UseAgentResult.followUp`；`AgentSessionAgent` 增 `followUp` 方法签名。

- [ ] **Step 1: 写失败测试**（沿用 useAgent.test 既有 mock agent 模式）

```ts
it('followUp delegates to agent.followUp without clearing history', async () => {
	const { controller, sinks, agent } = makeBoundController() // 复用本文件既有工厂
	await controller.followUp('B')
	expect(agent.followUp).toHaveBeenCalledWith('B')
	expect(sinks.setHistory).not.toHaveBeenCalledWith([])
})
```

> 若本文件尚无 `makeBoundController` 工厂，按既有 `createAgentSessionController` 测试的 bind 模式内联构造（参考同文件 execute 的测试）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F extension test -- -t "followUp delegates"`
Expected: FAIL

- [ ] **Step 3: 实现**

`AgentSessionAgent` 接口增 `followUp: (task: string) => Promise<ExecutionResult>`；`createAgentSessionController` 增：

```ts
async followUp(task) {
	if (configuring) throw new Error('Agent is being configured.')
	const agent = getAgent()
	assertAgentInactive(agent)
	sinks.setCurrentTask(task)
	sinks.setActivity(null)
	return agent.followUp(task)
},
```

`UseAgentResult` 增 `followUp: (task: string) => Promise<ExecutionResult>`；`useAgent` 内 `const followUp = useCallback((task: string) => sessionController.followUp(task), [sessionController])`，并在返回对象加入 `followUp`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F extension test -- -t "followUp delegates"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/agent/useAgent.ts apps/extension/src/agent/useAgent.test.ts
git commit -m "feat(ext): expose followUp from useAgent without clearing conversation"
```

---

## Task 10: SidepanelApp —— 发送路由 + 会话 upsert

**Files:**
- Modify: `apps/extension/src/entrypoints/sidepanel/App.tsx`
- Test: `apps/extension/src/entrypoints/sidepanel/App.test.ts`

**Interfaces:**
- Consumes: `followUp`（Task 9）、`updateSession`（Task 8）、`isAgentTaskActive`、`crypto.randomUUID`。
- Produces: 发送路由：`completed`/`error` 且会话未清 → `followUp`，否则 `execute`；当前 `conversationIdRef`；完成时 `updateSession(conversationId, ...)`。

- [ ] **Step 1: 写失败测试**（断言完成态再发走 followUp）

```ts
it('routes a follow-up message to followUp after completion', () => {
	const decide = pickSendAction({ status: 'completed', hasConversation: true })
	expect(decide).toBe('followUp')
	expect(pickSendAction({ status: 'idle', hasConversation: false })).toBe('execute')
})
```

> 把路由判定抽成纯函数 `pickSendAction({ status, hasConversation }): 'execute' | 'followUp'` 便于单测；App 内调用它。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F extension test -- -t "routes a follow-up"`
Expected: FAIL

- [ ] **Step 3: 实现**

新增纯函数（导出供测试）：

```ts
export function pickSendAction({ status, hasConversation }: { status: AgentStatus; hasConversation: boolean }): 'execute' | 'followUp' {
	return hasConversation && (status === 'completed' || status === 'error') ? 'followUp' : 'execute'
}
```

`runTask` 内：

```ts
const action = pickSendAction({ status, hasConversation: hasVisibleConversation })
const run = action === 'followUp' ? followUp : execute
run(normalizedTask).catch((error) => console.error('[SidePanel] Failed to run task:', error))
```

会话 id：`const conversationIdRef = useRef<string>(crypto.randomUUID())`；`resetConversation` 成功后 `conversationIdRef.current = crypto.randomUUID()`。把保存 `useEffect` 改为 upsert：

```ts
saveSession ➜ updateSession(conversationIdRef.current, { task: currentTask, history, status })
```

`followUp` 从 `useAgent()` 解构加入。

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm -F extension test -- -t "routes a follow-up"` → PASS
Run: `pnpm -F extension build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/entrypoints/sidepanel/App.tsx apps/extension/src/entrypoints/sidepanel/App.test.ts
git commit -m "feat(ext): continue conversation on follow-up; upsert one record per conversation"
```

---

## Task 11: 近溢出横幅 + MultiPageAgent 透传 compaction

**Files:**
- Create: `apps/extension/src/components/ContextBanner.tsx` + `apps/extension/src/components/ContextBanner.test.ts`
- Modify: `apps/extension/src/entrypoints/sidepanel/App.tsx`、`apps/extension/src/agent/MultiPageAgent.ts`、`apps/extension/src/agent/actionSignature.ts`（白名单）
- Test: 同上

**Interfaces:**
- Consumes: 最近 step 的 `usage.promptTokens`（从 `history` 取）、`resetConversation`、压缩 `hardTokens`。
- Produces: `shouldShowContextBanner(history, hardTokens): boolean`（纯函数）；`<ContextBanner onNewConversation onDismiss />`。

- [ ] **Step 1: 写失败测试**

```ts
it('shows the context banner when last step nears hard limit', () => {
	const history = [{ type: 'step', stepIndex: 0, reflection: {}, action: { name: 'x', input: {}, output: '' },
		usage: { promptTokens: 30_000, completionTokens: 0, totalTokens: 30_000 } }] as never[]
	expect(shouldShowContextBanner(history, 28_000)).toBe(true)
	expect(shouldShowContextBanner([], 28_000)).toBe(false)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F extension test -- -t "shows the context banner"`
Expected: FAIL

- [ ] **Step 3: 实现纯函数 + 组件**

```ts
export function shouldShowContextBanner(history: HistoricalEvent[], hardTokens: number): boolean {
	for (let i = history.length - 1; i >= 0; i--) {
		const e = history[i]
		if (e.type === 'step') return e.usage.promptTokens >= hardTokens * 0.85
	}
	return false
}
```

`ContextBanner.tsx`：非模态横幅，文案「上下文已较长，建议开启新会话以获得更好效果」+ 主按钮「新会话」(`onNewConversation`) + 次按钮/关闭「继续当前会话」(`onDismiss`)。样式跟随 UIUX token，不抢输入焦点。

App 内：在对话区顶部、`isTaskLocked` 为假且 `shouldShowContextBanner(history, hardTokens)` 且未被 dismiss 时渲染；点「新会话」走 `handleNewConversation`，点继续设 `bannerDismissed` 状态。`hardTokens` 取自 config（缺省 28_000）。

- [ ] **Step 4: MultiPageAgent 透传 + 卡住白名单**

`MultiPageAgent` 构造把 `compaction`（来自 ExtConfig，可选）透传进 `super(...)`；`createActionSignature`/卡住检测的白名单加入 `recall_steps`（与 `done`/`ask_user`/`request_user_takeover` 并列）。

- [ ] **Step 5: 运行确认通过 + 构建**

Run: `pnpm -F extension test -- -t "shows the context banner"` → PASS
Run: `pnpm -F extension build` → 成功

- [ ] **Step 6: 提交**

```bash
git add apps/extension/src/components/ContextBanner.tsx apps/extension/src/components/ContextBanner.test.ts apps/extension/src/entrypoints/sidepanel/App.tsx apps/extension/src/agent/MultiPageAgent.ts apps/extension/src/agent/actionSignature.ts
git commit -m "feat(ext): near-overflow context banner; pass compaction config; whitelist recall_steps"
```

---

## Task 12: 文档同步 + 全量验证 + 实施日志

**Files:**
- Modify: `.project.agents/docs/context/PRD.md`、`UIUX.md`、`ARCHITECTURE.md`
- Create: `.project.agents/log/2026-06-22-conversation-continuation.md`

- [ ] **Step 1: PRD §F3** 增「完成后同会话续接（带上下文）、按上下文体积自动 LLM 摘要压缩、近溢出建议新会话横幅；新会话为上下文边界」。

- [ ] **Step 2: UIUX §6** 增近溢出横幅形态/文案与续接线程呈现说明。

- [ ] **Step 3: ARCHITECTURE** 更新 `@page-agent/core` 卡片（续接 + 压缩 + recall_steps）、`SidepanelApp` 卡片（续接路由/横幅/会话 upsert）、`MultiPageAgent` 卡片（compaction 透传）；§3 增 `PageAgentCore.followUp(task): Promise<ExecutionResult>` 与压缩配置签名。

- [ ] **Step 4: 全量验证**

Run: `pnpm -F @page-agent/core test`
Expected: PASS
Run: `pnpm -F extension test`
Expected: PASS（除 `misc.test.ts` 3 个预存类型错误外全绿）
Run: `pnpm -F extension build`
Expected: 成功

- [ ] **Step 5: 写实施日志**（按 `.project.agents/log` 模板：完成了什么、提交列表、下一步、验收对照）。

- [ ] **Step 6: 提交**

```bash
git add .project.agents/docs/context/PRD.md .project.agents/docs/context/UIUX.md .project.agents/docs/context/ARCHITECTURE.md .project.agents/log/2026-06-22-conversation-continuation.md
git commit -m "docs: continuation + compaction across PRD/UIUX/ARCHITECTURE; execution log"
```

- [ ] **Step 7: 合并回 main**（约定：fast-forward）

```bash
git checkout main && git merge --ff-only codex/conversation-continuation && git worktree remove .worktrees/conversation-continuation
```

---

## Self-Review

**Spec coverage：**
- 续接（execute 写 user_message + followUp + 投影）→ Task 1/2/3 ✓
- 每对话一条存储 → Task 8/10 ✓
- token 触发 LLM 摘要 + 结构化步骤索引 + 失败降级 → Task 4/5 ✓
- 存储/投影拆分（history 全量、投影压缩）→ Task 3/4 ✓
- recall_steps 回退 → Task 6 ✓
- 不在完成时压（仅体积触发）→ 压缩只在 `#maybeCompactHistory`，由 token 触发，无完成钩子 ✓
- 硬阈值：轮次间横幅 + 用户坚持/长任务内 FIFO + 永不崩 → Task 7（FIFO/不崩）+ Task 11（横幅）✓
- 两条轴：只动 agent_history，不碰 browser_state → 投影仅作用于 history，browser_state 渲染未改 ✓
- 文档/UPSTREAM/测试 → Task 7（UPSTREAM/prompt）+ Task 12 ✓

**Placeholder scan：** 无 TODO/TBD；每个 code step 含真实代码与命令。UI 文案为占位可按 UIUX 语气微调（已注明跟随 token）。

**Type consistency：** `SummaryEvent.coversThroughIndex`（数组下标）在 Task 1 定义、Task 3/4/7 一致使用；`followUp` 签名 Task 2 定义、Task 9/10 一致消费；`CompactionConfig` 字段 Task 1/4/7/11 一致；`updateSession(conversationId, patch)` Task 8 定义、Task 10 消费一致；`pickSendAction`/`shouldShowContextBanner` 纯函数签名一致。

> 一处实现期注意：`#projectHistory()` 每步多次调用（估算 + 渲染 + 取最近 step），长历史下是 O(n) 遍历；若实测有性能问题，在单步内缓存一次投影结果。属优化，不改契约。

---

## Execution Handoff

计划已保存到 [`.project.agents/docs/superpowers/plans/2026-06-22-conversation-continuation.md`](.worktrees/conversation-continuation/.project.agents/docs/superpowers/plans/2026-06-22-conversation-continuation.md)。两种执行方式：

1. **Subagent-Driven（推荐）** —— 每个 Task 派新 subagent 实现，任务间我来 review，迭代快。
2. **Inline Execution** —— 本会话内用 executing-plans 批量执行，设检查点 review。

选哪种?
