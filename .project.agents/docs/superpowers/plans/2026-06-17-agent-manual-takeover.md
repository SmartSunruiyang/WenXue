# Agent Manual Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the user-facing step limit and add resumable manual takeover for login, captcha,
permission, unavailable pages, and repeated stuck actions.

**Architecture:** `@page-agent/core` owns the resumable execution protocol, takeover request tool,
status transitions, and history events. `MultiPageAgent` owns WenXue-specific stuck detection through
`onAfterStep`. `SidepanelApp` owns the takeover/paused UI and maps user button clicks back into the
core callback.

**Tech Stack:** TypeScript, React 19, WXT MV3 extension, Vitest, workspace packages
`@page-agent/core`, `@page-agent/page-controller`, `@page-agent/ui`.

**Spec:** `../specs/2026-06-17-agent-manual-takeover-design.md`

---

## File Structure

- Modify `.project.agents/docs/context/PRD.md`
  - Add recoverable manual takeover to F3.
  - Keep PRD §7.3 anti-bypass boundary explicit.
- Modify `.project.agents/docs/context/UIUX.md`
  - Remove “最大步数” from options advanced settings.
  - Expand artificial takeover card rules.
- Modify `.project.agents/docs/context/ARCHITECTURE.md`
  - Update core status/event signatures and MultiPageAgent stuck-guard responsibility.
- Modify `.project.agents/docs/context/UPSTREAM.md`
  - Record local changes to `@page-agent/core`.
- Modify `packages/core/src/types.ts`
  - Remove `maxSteps`.
  - Add `waiting_for_user` and `paused`.
  - Add takeover request/resolution/event/activity types.
- Modify `packages/core/src/PageAgentCore.ts`
  - Remove max-step loop checks and remaining-step observations.
  - Add `requestUserTakeover()` and `resume()`.
  - Split execution into initialization plus reusable run loop.
- Modify `packages/core/src/tools/index.ts`
  - Add `request_user_takeover`.
- Modify `packages/core/src/prompts/system_prompt.md`
  - Remove `max_steps` completion rule.
  - Instruct the model to request user takeover for login/captcha/permission/unavailable pages.
- Modify `apps/extension/src/agent/system_prompt.md`
  - Mirror the prompt change used by `MultiPageAgent`.
- Create `apps/extension/src/agent/actionSignature.ts`
  - Stable action signature generation and repeat counting.
- Create `apps/extension/src/agent/actionSignature.test.ts`
  - Vitest coverage for repeated action detection.
- Modify `apps/extension/src/agent/MultiPageAgent.ts`
  - Wire stuck guard through `onAfterStep`.
- Modify `apps/extension/src/agent/useAgent.ts`
  - Expose `resume`, `completeUserTakeover`, and `pauseUserTakeover`.
  - Track current takeover request.
- Modify `apps/extension/src/agent/useAgent.test.ts`
  - Cover paused/resume hook behavior.
- Modify `apps/extension/src/components/conversation.tsx`
  - Render waiting and paused takeover cards with actions.
- Modify `apps/extension/src/entrypoints/sidepanel/App.tsx`
  - Disable new tasks while `waiting_for_user` or `paused`.
  - Wire card actions to hook methods.
- Modify `apps/extension/src/lib/settingsConfig.ts`
  - Remove `maxSteps` from persisted settings config.
- Modify `apps/extension/src/lib/settingsConfig.test.ts`
  - Remove max-step expectations.
- Modify `apps/extension/src/lib/configStorage.ts`
  - Stop reading/writing `maxSteps`.
- Modify `apps/extension/src/lib/configStorage.test.ts`
  - Remove max-step persistence assertions.
- Modify `apps/extension/src/components/SettingsForm.tsx`
  - Remove max-step input.
- Modify `apps/extension/src/lib/i18n.tsx`
  - Remove `maxSteps`; add takeover and paused labels.
- Modify `apps/extension/src/entrypoints/content.ts`
  - Expose paused execution results and resume behavior for page API consumers.
- Modify `apps/extension/src/entrypoints/hub/hub-ws.ts`
  - Return paused state to Hub callers instead of hanging indefinitely.
- Modify `packages/ui/src/panel/types.ts` and `packages/ui/src/panel/Panel.ts`
  - Keep package-level adapter types compatible with new statuses and takeover callback.

## Task 1: Sync Source-of-Truth Docs

**Files:**

- Modify: `.project.agents/docs/context/PRD.md`
- Modify: `.project.agents/docs/context/UIUX.md`
- Modify: `.project.agents/docs/context/ARCHITECTURE.md`
- Modify: `.project.agents/docs/context/UPSTREAM.md`

- [ ] **Step 1: Update PRD F3**

  In `PRD.md` §5 F3, replace the existing “用户可随时停止任务” bullet with:

  ```markdown
  - 用户可随时停止任务；遇到登录、验证码、权限确认、不可操作区域或模型连续重复同一动作时，插件展示人工接管提示，用户完成后可继续原任务，也可暂停并保留上下文。
  ```

- [ ] **Step 2: Update UIUX sidepanel rules**

  In `UIUX.md` §6, replace the manual takeover bullet with:

  ```markdown
  - 需人工接管：醒目提示卡，说明原因（登录 / 验证码 / 权限确认 / 不可操作区域 / 模型卡住）、当前目标与卡住动作；按钮为「已完成，继续」或「我已接管，继续」+「暂停」。暂停后保留对话上下文，并在卡片上提供「继续」。
  ```

  In `UIUX.md` §7 options settings paragraph, remove `最大步数、` from the advanced area list.

- [ ] **Step 3: Update architecture module cards**

  In `ARCHITECTURE.md`, update `@page-agent/core`:

  ```markdown
  - 职责：PageAgentCore Agent 循环（系统提示词、工具执行、活动流、ExecutionResult、可恢复人工接管状态）
  - 不负责：不直接操作多标签（MultiPageAgent 的事）；不渲染历史 UI；不决定问学产品层卡住阈值
  ```

  Update `MultiPageAgent`:

  ```markdown
  - 职责：多标签编排、当前标签加载等待、问学产品层卡住检测（连续 3 次重复动作触发人工接管）
  ```

  Update `SidepanelApp`:

  ```markdown
  - 职责：侧边栏对话流、人工接管/暂停/继续 UI、右上角更多菜单、语言快捷入口、任务历史 UI、options 设置页 UI、自定义模型列表与默认模型选择
  ```

- [ ] **Step 4: Record upstream patch**

  Append this entry to `UPSTREAM.md`:

  ```markdown
  ## Local patch: resumable manual takeover

  - Scope: `packages/core`
  - Reason: WenXue removes user-facing step limits and adds recoverable human takeover for login, captcha, permission, unavailable pages, and stuck repeated actions.
  - Upstream sync note: keep the patch isolated to public types, PageAgentCore loop control, tools, and prompts so future alibaba/page-agent syncs can diff it cleanly.
  ```

- [ ] **Step 5: Verify docs formatting**

  Run:

  ```sh
  pnpm format:check .project.agents/docs/context/PRD.md .project.agents/docs/context/UIUX.md .project.agents/docs/context/ARCHITECTURE.md .project.agents/docs/context/UPSTREAM.md
  ```

  Expected: PASS.

## Task 2: Remove Step Limit From Config and Prompt

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/PageAgentCore.ts`
- Modify: `packages/core/src/prompts/system_prompt.md`
- Modify: `apps/extension/src/agent/system_prompt.md`
- Modify: `apps/extension/src/lib/settingsConfig.ts`
- Modify: `apps/extension/src/lib/settingsConfig.test.ts`
- Modify: `apps/extension/src/lib/configStorage.ts`
- Modify: `apps/extension/src/lib/configStorage.test.ts`
- Modify: `apps/extension/src/components/SettingsForm.tsx`
- Modify: `apps/extension/src/lib/i18n.tsx`

- [ ] **Step 1: Remove settings tests for maxSteps**

  Edit `apps/extension/src/lib/settingsConfig.test.ts` and `apps/extension/src/lib/configStorage.test.ts` so no assertion contains `maxSteps`.

  Run:

  ```sh
  pnpm -F extension test apps/extension/src/lib/settingsConfig.test.ts apps/extension/src/lib/configStorage.test.ts
  ```

  Expected: FAIL while implementation still returns or stores `maxSteps`.

- [ ] **Step 2: Remove maxSteps from public config types**

  In `packages/core/src/types.ts`, delete this block:

  ```ts
  /**
   * Maximum number of steps the agent can take per task.
   * @default 40
   */
  maxSteps?: number
  ```

  In `apps/extension/src/agent/useAgent.ts`, remove `maxSteps?: number` from `AdvancedConfig`.

- [ ] **Step 3: Remove maxSteps from PageAgentCore constructor and loop**

  In `packages/core/src/PageAgentCore.ts`, change:

  ```ts
  readonly config: PageAgentCoreConfig & { maxSteps: number }
  ```

  to:

  ```ts
  readonly config: PageAgentCoreConfig
  ```

  Change constructor assignment to:

  ```ts
  this.config = config
  ```

  Delete the loop block:

  ```ts
  if (step > this.config.maxSteps) {
  	taskResult = 'Step count exceeded maximum limit'
  	taskSuccess = false
  	this.#emitActivity({ type: 'error', message: taskResult })
  	this.history.push({ type: 'error', message: taskResult })
  	this.#emitHistoryChange()
  	break
  }
  ```

  In `#handleObservations`, delete the remaining-step warning block.

- [ ] **Step 4: Replace prompt step info**

  In `#assembleUserPrompt`, replace:

  ```ts
  prompt += `Step ${stepCount + 1} of ${this.config.maxSteps} max possible steps\n`
  ```

  with:

  ```ts
  prompt += `Step ${stepCount + 1}\n`
  ```

  In both prompt markdown files, remove the rule about reaching final allowed `max_steps`.

- [ ] **Step 5: Remove settings UI**

  In `SettingsForm.tsx`, delete the `maxSteps` state, its synchronization from config, the number input block with `id="max-steps"`, and `maxSteps` from submit dependencies.

  In `settingsConfig.ts` and `configStorage.ts`, remove `maxSteps` from values and storage payloads.

  In `i18n.tsx`, remove `maxSteps` labels.

- [ ] **Step 6: Verify removal**

  Run:

  ```sh
  rg -n "maxSteps|max_steps|Step count exceeded|maximum limit|of \\$\\{this\\.config\\.maxSteps\\}|最大步数" packages apps .project.agents/docs/context
  ```

  Expected: no matches except this plan/spec if they are included in the search.

  Run:

  ```sh
  pnpm -F extension test apps/extension/src/lib/settingsConfig.test.ts apps/extension/src/lib/configStorage.test.ts
  pnpm -F @page-agent/core build
  ```

  Expected: PASS.

## Task 3: Add Core Takeover Types and Resumable Protocol

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/PageAgentCore.ts`

- [ ] **Step 1: Add type definitions**

  Add to `packages/core/src/types.ts`:

  ```ts
  export type UserTakeoverReason =
  	| 'login'
  	| 'captcha'
  	| 'permission'
  	| 'page_unavailable'
  	| 'stuck'
  	| 'other'

  export interface UserTakeoverRequest {
  	id: string
  	reason: UserTakeoverReason
  	title: string
  	message: string
  	goal?: string
  	lastAction?: {
  		name: string
  		input: unknown
  		output: string
  	}
  }

  export type UserTakeoverResolution = 'completed' | 'paused'
  ```

  Replace `UserTakeoverEvent` with:

  ```ts
  export interface UserTakeoverEvent {
  	type: 'user_takeover'
  	request: UserTakeoverRequest
  	status: 'waiting' | 'completed' | 'paused'
  }
  ```

  Change `AgentStatus` to:

  ```ts
  export type AgentStatus =
  	| 'idle'
  	| 'running'
  	| 'waiting_for_user'
  	| 'paused'
  	| 'completed'
  	| 'error'
  ```

  Add activity variant:

  ```ts
  | { type: 'waiting_for_user'; request: UserTakeoverRequest }
  ```

  Add result state:

  ```ts
  export interface ExecutionResult {
  	success: boolean
  	data: string
  	history: HistoricalEvent[]
  	state?: 'completed' | 'error' | 'paused'
  }
  ```

- [ ] **Step 2: Add PageAgentCore takeover callback**

  In `PageAgentCore`, add:

  ```ts
  onUserTakeover?: (
  	request: UserTakeoverRequest,
  	options?: { signal: AbortSignal }
  ) => Promise<UserTakeoverResolution>
  ```

  Import the new types from `./types`.

- [ ] **Step 3: Add requestUserTakeover method**

  Add this public method to `PageAgentCore`:

  ```ts
  async requestUserTakeover(
  	input: Omit<UserTakeoverRequest, 'id'>,
  	options?: { signal?: AbortSignal }
  ): Promise<UserTakeoverResolution> {
  	if (!this.onUserTakeover) throw new Error('requestUserTakeover requires onUserTakeover callback')

  	const request: UserTakeoverRequest = { ...input, id: uid() }
  	const event: UserTakeoverEvent = { type: 'user_takeover', request, status: 'waiting' }

  	this.history.push(event)
  	this.#setStatus('waiting_for_user')
  	this.#emitActivity({ type: 'waiting_for_user', request })
  	this.#emitHistoryChange()

  	const resolution = await this.onUserTakeover(request, {
  		signal: options?.signal ?? this.#abortController.signal,
  	})

  	event.status = resolution
  	this.#emitHistoryChange()

  	if (resolution === 'completed') {
  		this.pushObservation(
  			'User completed manual takeover. Re-observe the page and continue from the current task.'
  		)
  		this.#setStatus('running')
  	}

  	return resolution
  }
  ```

- [ ] **Step 4: Split execute into init plus run loop**

  Keep `execute(task)` responsible for initialization:

  ```ts
  async execute(task: string): Promise<ExecutionResult> {
  	if (this.disposed) throw new Error('PageAgent has been disposed. Create a new instance.')
  	if (this.#status === 'running' || this.#status === 'waiting_for_user') {
  		throw new Error('A task is already running.')
  	}
  	if (!task) throw new Error('Task is required')

  	this.task = task
  	this.taskId = uid()
  	this.history = []
  	this.#observations = []
  	this.#states = { totalWaitTime: 0, lastURL: '', browserState: null }
  	this.#abortController = new AbortController()
  	this.#setStatus('running')
  	this.#emitHistoryChange()

  	return this.#runTaskLoop({ setupTask: true })
  }
  ```

  Move the existing loop body into:

  ```ts
  async #runTaskLoop({ setupTask }: { setupTask: boolean }): Promise<ExecutionResult> {
  	// Reuse the current execute loop body here.
  }
  ```

  Preserve `onBeforeTask` only when `setupTask` is true.

- [ ] **Step 5: Add pause result handling inside loop**

  After each non-`done` action, if the action result came from `request_user_takeover` and resolution is
  `paused`, return:

  ```ts
  this.#setStatus('paused')
  const result: ExecutionResult = {
  	success: false,
  	data: 'Task paused',
  	history: this.history,
  	state: 'paused',
  }
  await onAfterTask?.(this, result)
  return result
  ```

  Use the same return shape if `requestUserTakeover()` is called by stuck guard and returns `paused`.

- [ ] **Step 6: Add resume**

  Add:

  ```ts
  async resume(): Promise<ExecutionResult> {
  	if (this.disposed) throw new Error('PageAgent has been disposed. Create a new instance.')
  	if (this.#status !== 'paused') throw new Error('Only paused tasks can be resumed.')
  	if (!this.task) throw new Error('No paused task to resume.')

  	this.#abortController = new AbortController()
  	this.pushObservation('User resumed the paused task. Re-observe the page and continue.')
  	this.#setStatus('running')
  	this.#emitHistoryChange()
  	return this.#runTaskLoop({ setupTask: false })
  }
  ```

- [ ] **Step 7: Verify core build**

  Run:

  ```sh
  pnpm -F @page-agent/core build
  ```

  Expected: PASS.

## Task 4: Add LLM-Initiated Takeover Tool and Prompt Rules

**Files:**

- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/prompts/system_prompt.md`
- Modify: `apps/extension/src/agent/system_prompt.md`

- [ ] **Step 1: Add failing build expectation**

  Add an import in `tools/index.ts` for the new types used by the tool. Before implementation,
  run:

  ```sh
  pnpm -F @page-agent/core build
  ```

  Expected: FAIL because `request_user_takeover` is not yet defined.

- [ ] **Step 2: Add `request_user_takeover` tool**

  Insert after `ask_user`:

  ```ts
  tools.set(
  	'request_user_takeover',
  	tool({
  		description:
  			'Ask the user to manually handle login, captcha, permission dialogs, unavailable page areas, or other browser actions that must not be automated.',
  		inputSchema: z.object({
  			reason: z.enum(['login', 'captcha', 'permission', 'page_unavailable', 'other']),
  			title: z.string(),
  			message: z.string(),
  			goal: z.string().optional(),
  		}),
  		execute: async function (this: PageAgentCore, input, { signal }) {
  			const resolution = await this.requestUserTakeover(input, { signal })
  			if (resolution === 'paused') {
  				return 'User paused the task. Stop execution and keep context for resume.'
  			}
  			return 'User completed manual takeover. Continue by re-observing the page.'
  		},
  	}),
  )
  ```

- [ ] **Step 3: Update prompt rules**

  In both prompt markdown files, under browser/capability/task completion rules, add:

  ```markdown
  - Never attempt to bypass login, captcha, slider verification, two-factor verification, permission confirmation, anti-abuse checks, or unavailable page regions.
  - If the task requires one of those actions, call `request_user_takeover` with the reason, the current goal, and a concise message telling the user what to complete.
  - After the user completes manual takeover, re-observe the page before choosing the next action.
  ```

- [ ] **Step 4: Verify prompts and build**

  Run:

  ```sh
  rg -n "request_user_takeover|captcha|login|manual takeover" packages/core/src/prompts apps/extension/src/agent/system_prompt.md packages/core/src/tools/index.ts
  pnpm -F @page-agent/core build
  ```

  Expected: matches exist for the new tool and prompt rules; build PASS.

## Task 5: Implement Repeated Action Stuck Guard

**Files:**

- Create: `apps/extension/src/agent/actionSignature.ts`
- Create: `apps/extension/src/agent/actionSignature.test.ts`
- Modify: `apps/extension/src/agent/MultiPageAgent.ts`

- [ ] **Step 1: Write failing action signature tests**

  Create `apps/extension/src/agent/actionSignature.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest'
  import { StuckActionGuard, createActionSignature } from './actionSignature'

  describe('createActionSignature', () => {
  	it('normalizes url hash and object key order', () => {
  		expect(
  			createActionSignature({
  				url: 'https://example.com/path#section',
  				action: { name: 'click_element_by_index', input: { b: 2, a: 1 }, output: 'ok' },
  			}),
  		).toEqual({
  			url: 'https://example.com/path',
  			name: 'click_element_by_index',
  			input: '{"a":1,"b":2}',
  			output: 'ok',
  		})
  	})

  	it('ignores terminal and takeover actions', () => {
  		expect(
  			createActionSignature({
  				url: 'https://example.com',
  				action: { name: 'done', input: {}, output: 'done' },
  			}),
  		).toBeNull()
  	})
  })

  describe('StuckActionGuard', () => {
  	it('triggers on the third consecutive identical signature', () => {
  		const guard = new StuckActionGuard(3)
  		const signature = {
  			url: 'https://example.com',
  			name: 'click_element_by_index',
  			input: '{"index":1}',
  			output: 'Clicked',
  		}

  		expect(guard.record(signature)).toBe(false)
  		expect(guard.record(signature)).toBe(false)
  		expect(guard.record(signature)).toBe(true)
  	})

  	it('resets when signature changes', () => {
  		const guard = new StuckActionGuard(3)
  		expect(guard.record({ url: 'a', name: 'click', input: '1', output: 'ok' })).toBe(false)
  		expect(guard.record({ url: 'a', name: 'click', input: '2', output: 'ok' })).toBe(false)
  		expect(guard.record({ url: 'a', name: 'click', input: '2', output: 'ok' })).toBe(false)
  	})
  })
  ```

  Run:

  ```sh
  pnpm -F extension test apps/extension/src/agent/actionSignature.test.ts
  ```

  Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement action signature helper**

  Create `apps/extension/src/agent/actionSignature.ts`:

  ```ts
  import type { AgentStepEvent } from '@page-agent/core'

  export interface ActionSignature {
  	url: string
  	name: string
  	input: string
  	output: string
  }

  const IGNORED_ACTIONS = new Set(['done', 'ask_user', 'request_user_takeover'])

  export function createActionSignature({
  	url,
  	action,
  }: {
  	url: string
  	action: AgentStepEvent['action']
  }): ActionSignature | null {
  	if (IGNORED_ACTIONS.has(action.name)) return null

  	return {
  		url: stripHash(url),
  		name: action.name,
  		input: stableStringify(action.input, 160),
  		output: truncate(action.output, 240),
  	}
  }

  export class StuckActionGuard {
  	#lastSignature: string | null = null
  	#count = 0

  	constructor(readonly threshold = 3) {}

  	record(signature: ActionSignature | null): boolean {
  		if (!signature) {
  			this.reset()
  			return false
  		}

  		const current = JSON.stringify(signature)
  		if (current === this.#lastSignature) {
  			this.#count++
  		} else {
  			this.#lastSignature = current
  			this.#count = 1
  		}

  		return this.#count >= this.threshold
  	}

  	reset(): void {
  		this.#lastSignature = null
  		this.#count = 0
  	}
  }

  function stripHash(url: string): string {
  	const hashIndex = url.indexOf('#')
  	return hashIndex === -1 ? url : url.slice(0, hashIndex)
  }

  function stableStringify(value: unknown, maxLength: number): string {
  	return truncate(JSON.stringify(sortValue(value)), maxLength)
  }

  function sortValue(value: unknown): unknown {
  	if (Array.isArray(value)) return value.map(sortValue)
  	if (!value || typeof value !== 'object') return value

  	return Object.fromEntries(
  		Object.entries(value as Record<string, unknown>)
  			.sort(([a], [b]) => a.localeCompare(b))
  			.map(([key, nested]) => [key, sortValue(nested)]),
  	)
  }

  function truncate(value: string, maxLength: number): string {
  	return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
  }
  ```

- [ ] **Step 3: Wire guard into MultiPageAgent**

  In `MultiPageAgent.ts`, create guard before `super()`:

  ```ts
  const stuckGuard = new StuckActionGuard(3)
  ```

  Import:

  ```ts
  import type { AgentStepEvent } from '@page-agent/core'
  import { createActionSignature, StuckActionGuard } from './actionSignature'
  ```

  Add or extend `onAfterStep` in the `super()` config:

  ```ts
  onAfterStep: async (agent, history) => {
  	const lastStep = [...history].reverse().find((event) => event.type === 'step') as
  		| AgentStepEvent
  		| undefined
  	if (!lastStep) return

  	const signature = createActionSignature({
  		url: agent.pageController.currentURL ?? '',
  		action: lastStep.action,
  	})

  	if (!stuckGuard.record(signature)) return

  	stuckGuard.reset()
  	await agent.requestUserTakeover({
  		reason: 'stuck',
  		title: '模型可能遇到无法解决的问题',
  		message: '它连续尝试了 3 次相同操作，可能需要你暂时接管页面。',
  		goal: lastStep.reflection?.next_goal,
  		lastAction: lastStep.action,
  	})
  }
  ```

  If `currentURL` is not available on `pageController`, use the most recent browser state URL already
  observed by core by adding a public readonly getter on `PageAgentCore`:

  ```ts
  get currentURL(): string {
  	return this.#states.browserState?.url || ''
  }
  ```

- [ ] **Step 4: Verify stuck guard**

  Run:

  ```sh
  pnpm -F extension test apps/extension/src/agent/actionSignature.test.ts
  pnpm -F extension build
  ```

  Expected: PASS.

## Task 6: Add Sidepanel Takeover and Resume UI

**Files:**

- Modify: `apps/extension/src/agent/useAgent.ts`
- Modify: `apps/extension/src/agent/useAgent.test.ts`
- Modify: `apps/extension/src/components/conversation.tsx`
- Modify: `apps/extension/src/entrypoints/sidepanel/App.tsx`
- Modify: `apps/extension/src/lib/i18n.tsx`

- [ ] **Step 1: Extend hook result shape**

  In `UseAgentResult`, add:

  ```ts
  takeoverRequest: UserTakeoverRequest | null
  completeUserTakeover: () => void
  pauseUserTakeover: () => void
  resume: () => Promise<ExecutionResult>
  ```

- [ ] **Step 2: Implement takeover callback in useAgent**

  Import the new types and add state:

  ```ts
  const [takeoverRequest, setTakeoverRequest] = useState<UserTakeoverRequest | null>(null)
  const takeoverResolverRef = useRef<((value: UserTakeoverResolution) => void) | null>(null)
  ```

  After creating `agent`, set:

  ```ts
  agent.onUserTakeover = (request, { signal } = {}) => {
  	setTakeoverRequest(request)
  	return new Promise<UserTakeoverResolution>((resolve, reject) => {
  		takeoverResolverRef.current = resolve
  		signal?.addEventListener(
  			'abort',
  			() => {
  				setTakeoverRequest(null)
  				takeoverResolverRef.current = null
  				reject(signal.reason as DOMException)
  			},
  			{ once: true },
  		)
  	})
  }
  ```

  Add actions:

  ```ts
  const resolveTakeover = useCallback((resolution: UserTakeoverResolution) => {
  	const resolver = takeoverResolverRef.current
  	if (!resolver) return
  	takeoverResolverRef.current = null
  	setTakeoverRequest(null)
  	resolver(resolution)
  }, [])

  const completeUserTakeover = useCallback(() => resolveTakeover('completed'), [resolveTakeover])
  const pauseUserTakeover = useCallback(() => resolveTakeover('paused'), [resolveTakeover])

  const resume = useCallback(async () => {
  	const agent = agentRef.current
  	if (!agent) throw new Error('Agent not initialized')
  	return agent.resume()
  }, [])
  ```

- [ ] **Step 3: Render takeover card**

  In `Conversation` props, add:

  ```ts
  takeoverRequest?: UserTakeoverRequest | null
  onCompleteTakeover?: () => void
  onPauseTakeover?: () => void
  onResumePausedTask?: () => void
  status?: AgentStatus
  ```

  Render a `TakeoverPrompt` when `takeoverRequest` exists, and a `PausedPrompt` when status is
  `paused`.

  The prompt component must show `request.title`, `request.message`, `request.goal`, and
  `request.lastAction` if present. Buttons:

  ```tsx
  <button type="button" onClick={onCompleteTakeover}>
  	{request.reason === 'stuck' ? t('takeoverContinueAfterManual') : t('takeoverCompleted')}
  </button>
  <button type="button" onClick={onPauseTakeover}>
  	{t('pauseTask')}
  </button>
  ```

- [ ] **Step 4: Wire sidepanel App**

  Destructure hook values in `App.tsx`:

  ```ts
  const {
  	status,
  	history,
  	activity,
  	currentTask,
  	takeoverRequest,
  	completeUserTakeover,
  	pauseUserTakeover,
  	resume,
  } = agent
  ```

  Block new task submission when status is `running`, `waiting_for_user`, or `paused`:

  ```ts
  if (!normalizedTask || ['running', 'waiting_for_user', 'paused'].includes(status)) return
  ```

  Pass the takeover props into `Conversation`.

- [ ] **Step 5: Add i18n labels**

  Add Chinese and English labels:

  ```ts
  takeoverCompleted: '已完成，继续'
  takeoverContinueAfterManual: '我已接管，继续'
  pauseTask: '暂停'
  resumeTask: '继续'
  takeoverStuckTitle: '模型可能遇到无法解决的问题'
  takeoverNeededTitle: '需要你完成一步'
  ```

- [ ] **Step 6: Test hook behavior**

  Add tests to `useAgent.test.ts` that verify:

  ```ts
  expect(result.current.status).toBe('waiting_for_user')
  act(() => result.current.completeUserTakeover())
  expect(result.current.takeoverRequest).toBeNull()
  ```

  and:

  ```ts
  act(() => result.current.pauseUserTakeover())
  expect(result.current.status).toBe('paused')
  await act(() => result.current.resume())
  expect(result.current.history.length).toBeGreaterThan(0)
  ```

  Run:

  ```sh
  pnpm -F extension test apps/extension/src/agent/useAgent.test.ts
  ```

  Expected: PASS.

## Task 7: Update External Entrypoints and Legacy UI Adapter

**Files:**

- Modify: `apps/extension/src/entrypoints/content.ts`
- Modify: `apps/extension/src/entrypoints/hub/hub-ws.ts`
- Modify: `packages/ui/src/panel/types.ts`
- Modify: `packages/ui/src/panel/Panel.ts`
- Modify: `apps/extension/docs/extension_api.md`

- [ ] **Step 1: Content API result handling**

  In `content.ts`, when `execute()` resolves with `state: 'paused'`, post:

  ```ts
  {
  	channel: 'PAGE_AGENT_EXT_RESPONSE',
  	id,
  	action: 'execute_result',
  	payload: {
  		...result,
  		state: 'paused',
  	},
  }
  ```

  Add a `resume` action case:

  ```ts
  case 'resume': {
  	if (!multiPageAgent || multiPageAgent.status !== 'paused') {
  		throw new Error('No paused task to resume.')
  	}
  	const result = await multiPageAgent.resume()
  	window.postMessage({
  		channel: 'PAGE_AGENT_EXT_RESPONSE',
  		id,
  		action: 'resume_result',
  		payload: result,
  	}, '*')
  	break
  }
  ```

- [ ] **Step 2: Hub paused response**

  In `hub-ws.ts`, return paused state:

  ```ts
  const result = await execute(task)
  return { success: result.success, data: result.data, state: result.state }
  ```

  Expose an `onResume` handler if `HubWs` already supports custom commands. If it only supports
  execute/stop, document paused responses in `extension_api.md` and keep resume sidepanel-only for this
  milestone.

- [ ] **Step 3: Update package UI adapter types**

  In `packages/ui/src/panel/types.ts`, add `waiting_for_user` and `paused` to the status union and
  add optional `onUserTakeover`.

  In `Panel.ts`, map `waiting_for_user` to the existing question-style UI and map `paused` to a
  neutral paused status text. Keep `stop()` as terminal stop.

- [ ] **Step 4: Verify builds**

  Run:

  ```sh
  pnpm -F extension build
  pnpm -F @page-agent/ui build
  ```

  Expected: PASS.

## Task 8: Full Verification and Execution Log

**Files:**

- Create: `.project.agents/log/YYYY-MM-DD-agent-manual-takeover.md`

- [ ] **Step 1: Run focused tests**

  Run:

  ```sh
  pnpm -F extension test apps/extension/src/lib/settingsConfig.test.ts apps/extension/src/lib/configStorage.test.ts apps/extension/src/agent/actionSignature.test.ts apps/extension/src/agent/useAgent.test.ts
  ```

  Expected: PASS.

- [ ] **Step 2: Run package builds**

  Run:

  ```sh
  pnpm -F @page-agent/core build
  pnpm -F @page-agent/ui build
  pnpm -F extension build
  ```

  Expected: PASS.

- [ ] **Step 3: Run repository tests**

  Run:

  ```sh
  pnpm -r test
  ```

  Expected: PASS for packages with test scripts.

- [ ] **Step 4: Manual verification**

  Build and load the extension, then verify:

  - Settings page no longer shows “最大步数”.
  - A task that reaches login/captcha can show manual takeover.
  - `已完成，继续` resumes the same task without clearing history.
  - `暂停` switches to paused state and preserves conversation.
  - `继续` resumes from paused state.
  - Three identical repeated actions show stuck takeover with goal and last action.

- [ ] **Step 5: Write execution log**

  Create `.project.agents/log/YYYY-MM-DD-agent-manual-takeover.md` with:

  ```markdown
  # 完成 Agent 人工接管与暂停继续

  - **日期**：YYYY-MM-DD
  - **关联**：2026-06-17-agent-manual-takeover-design.md / 2026-06-17-agent-manual-takeover.md

  ## 做了什么

  - 删除最大步数用户概念与 prompt 上限。
  - 增加登录 / 验证码 / 权限 / 不可操作页面人工接管。
  - 增加连续 3 次重复动作卡住检测。
  - 增加 paused / resume 执行状态。

  ## 提交

  - 未提交，工作树状态：实现完成后填写实际 commit。

  ## 状态变更

  - 架构文档：已更新 core / MultiPageAgent / SidepanelApp 职责。
  - 需求/UI 文档：已更新 PRD F3 与 UIUX 人工接管规则。
  - 测试：填写实际运行命令与结果。

  ## 下一步

  - 进行真实网页登录 / 验证码人工接管走查。
  ```

- [ ] **Step 6: Commit**

  Stage only files changed for this feature:

  ```sh
  git add .project.agents/docs/context/PRD.md .project.agents/docs/context/UIUX.md .project.agents/docs/context/ARCHITECTURE.md .project.agents/docs/context/UPSTREAM.md packages/core/src/types.ts packages/core/src/PageAgentCore.ts packages/core/src/tools/index.ts packages/core/src/prompts/system_prompt.md apps/extension/src/agent/system_prompt.md apps/extension/src/agent/actionSignature.ts apps/extension/src/agent/actionSignature.test.ts apps/extension/src/agent/MultiPageAgent.ts apps/extension/src/agent/useAgent.ts apps/extension/src/agent/useAgent.test.ts apps/extension/src/components/conversation.tsx apps/extension/src/entrypoints/sidepanel/App.tsx apps/extension/src/lib/settingsConfig.ts apps/extension/src/lib/settingsConfig.test.ts apps/extension/src/lib/configStorage.ts apps/extension/src/lib/configStorage.test.ts apps/extension/src/components/SettingsForm.tsx apps/extension/src/lib/i18n.tsx apps/extension/src/entrypoints/content.ts apps/extension/src/entrypoints/hub/hub-ws.ts packages/ui/src/panel/types.ts packages/ui/src/panel/Panel.ts apps/extension/docs/extension_api.md .project.agents/log/YYYY-MM-DD-agent-manual-takeover.md
  git commit -m "feat(ext): add resumable manual takeover"
  ```

  Expected: commit succeeds without staging unrelated quick-links/newtab changes.

## Self-Review

- Spec coverage: Tasks 1-2 cover removing step limits; Tasks 3-4 cover login/captcha/manual takeover;
  Task 5 covers repeated action detection; Task 6 covers sidepanel UI; Task 7 covers external entrypoints;
  Task 8 covers verification and log.
- Scope: This is one extension-agent behavior change. Desktop domain remains untouched, preserving I3.
- Type consistency: `UserTakeoverRequest`, `UserTakeoverResolution`, `waiting_for_user`, `paused`,
  and `ExecutionResult.state` are introduced in Task 3 and reused with the same names later.
- Product boundary: No bypass behavior, no hidden fuse, no desktop communication, no LLM gateway change.
