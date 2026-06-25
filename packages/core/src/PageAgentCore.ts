/**
 * Copyright (C) 2025 Alibaba Group Holding Limited
 * Copyright (C) 2026 SimonLuvRamen
 * All rights reserved.
 */
import { InvokeError, LLM, type Tool } from '@page-agent/llms'
import type { BrowserState, PageController } from '@page-agent/page-controller'
import chalk from 'chalk'
import * as z from 'zod/v4'

import SYSTEM_PROMPT from './prompts/system_prompt.md?raw'
import { tools } from './tools'
import type {
	AgentActivity,
	AgentConfig,
	AgentReflection,
	AgentStatus,
	AgentStepEvent,
	CompactionConfig,
	ExecutionResult,
	HistoricalEvent,
	MacroToolInput,
	MacroToolResult,
	SummaryEvent,
	UserTakeoverEvent,
	UserTakeoverRequest,
	UserTakeoverResolution,
} from './types'
import { assert, fetchLlmsTxt, normalizeResponse, uid, waitFor } from './utils'

export { tool, type PageAgentTool } from './tools'
export type * from './types'

export type PageAgentCoreConfig = AgentConfig & { pageController: PageController }

const MANUAL_TAKEOVER_RULES_PATTERN = /<manual_takeover_rules>[\s\S]*?<\/manual_takeover_rules>\s*/g
const ASK_USER_RULES_PATTERN = /<ask_user_rules>[\s\S]*?<\/ask_user_rules>\s*/g
const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
	enabled: true,
	softTokens: 12_000,
	hardTokens: 28_000,
	keepRecentSteps: 5,
}

function isAgentStatusActive(status: AgentStatus): boolean {
	return status === 'running' || status === 'waiting_for_user' || status === 'paused'
}

/**
 * AI agent for browser automation.
 *
 * @remarks
 * ## Re-act Agent Loop
 * - step
 *    - observe (gather information about current environment and context)
 *    - think (LLM calling)
 *      - reflection (evaluate history, generate memory, short-term planning)
 *      - action (give the action to approach the next goal)
 *    - act (execute the action)
 * - loop
 *
 * ## Event System
 * - `statuschange` - Agent status transitions, including waiting and paused states
 * - `historychange` - History events updated (persistent, part of agent memory)
 * - `activity` - Real-time activity feedback (transient, for UI only)
 * - `dispose` - Agent cleanup triggered
 *
 * ## Information Streams
 * 1. **History Events** (`history` array)
 *    - Persistent event stream that forms agent's memory
 *    - Included in LLM context across steps
 *    - Types: steps, observations, user takeovers, llm errors
 *
 * 2. **Activity Events** (via `activity` event)
 *    - Transient UI feedback during task execution
 *    - NOT included in LLM context
 *    - Types: thinking, executing, executed, retrying, waiting for user, error
 */
export class PageAgentCore extends EventTarget {
	readonly id = uid()
	readonly config: PageAgentCoreConfig
	readonly tools: typeof tools
	/** PageController for DOM operations */
	readonly pageController: PageController

	task = ''
	taskId = ''
	/** History events */
	history: HistoricalEvent[] = []
	/** Whether this agent has been disposed */
	disposed = false

	/**
	 * Called when the agent needs to ask the user questions.
	 * If unset, the `ask_user` tool will be disabled.
	 * Implementations should reject the promise when `signal` aborts.
	 * @example onAskUser: (q) => window.prompt(q) || ''
	 */
	onAskUser?: (question: string, options?: { signal: AbortSignal }) => Promise<string>

	/**
	 * Called when execution requires the user to take over the page.
	 * The callback receives the active task signal and may resolve the task as completed or paused.
	 */
	onUserTakeover?: (
		request: UserTakeoverRequest,
		options?: { signal: AbortSignal },
	) => Promise<UserTakeoverResolution>

	#status: AgentStatus = 'idle'
	#llm: LLM
	#compaction: CompactionConfig
	/**
	 * Task cancellation primitive: its signal reaches the LLM fetch, tools
	 * (via `ctx.signal`) and async callbacks. Replaced for new and resumed runs,
	 * and aborted without a custom reason for terminal cleanup, `stop`, or `dispose`.
	 */
	#abortController = new AbortController()
	#observations: string[] = []
	#pauseRequested = false
	#runLoopActive = false
	#takeoverActive = false

	/** internal states during a single task execution */
	#states = {
		/** Accumulated wait time in seconds */
		totalWaitTime: 0,
		/** For detecting navigation */
		lastURL: '',
		/** Browser state */
		browserState: null as BrowserState | null,
	}

	constructor(config: PageAgentCoreConfig) {
		super()

		this.config = { ...config }
		this.#compaction = { ...DEFAULT_COMPACTION_CONFIG, ...config.compaction }

		this.#llm = new LLM(this.config)
		this.tools = new Map(tools)
		this.pageController = config.pageController

		this.#llm.addEventListener('retry', (e) => {
			const { attempt, maxAttempts, lastError } = (e as CustomEvent).detail
			this.#emitActivity({ type: 'retrying', attempt, maxAttempts })
			this.history.push({
				type: 'error',
				message: String(lastError),
				rawResponse: (lastError as InvokeError).rawResponse,
			})
			this.history.push({
				type: 'retry',
				message: `LLM retry attempt ${attempt} of ${maxAttempts}`,
				attempt,
				maxAttempts,
			})
			this.#emitHistoryChange()
		})

		if (this.config.customTools) {
			for (const [name, tool] of Object.entries(this.config.customTools)) {
				if (tool === null) {
					this.tools.delete(name)
					continue
				}
				this.tools.set(name, tool)
			}
		}

		if (!this.config.experimentalScriptExecutionTool) {
			this.tools.delete('execute_javascript')
		}
	}

	/** Get current agent status */
	get status(): AgentStatus {
		return this.#status
	}

	/** Get the URL from the latest observed browser state. */
	get currentURL(): string {
		return this.#states.browserState?.url || ''
	}

	/** Emit statuschange event */
	#emitStatusChange(): void {
		this.dispatchEvent(new Event('statuschange'))
	}

	/** Emit historychange event */
	#emitHistoryChange(): void {
		this.dispatchEvent(new Event('historychange'))
	}

	/**
	 * Emit activity event - for transient UI feedback
	 * @param activity - Current agent activity
	 */
	#emitActivity(activity: AgentActivity): void {
		this.dispatchEvent(new CustomEvent('activity', { detail: activity }))
	}

	/** Update status and emit event */
	#setStatus(status: AgentStatus): void {
		if (this.#status !== status) {
			this.#status = status
			this.#emitStatusChange()
		}
	}

	/**
	 * Push an observation message to the history event stream.
	 * This will be visible in <agent_history> and remain persistent in memory across steps.
	 * @experimental @internal
	 * @note history change will be emitted before next step starts
	 */
	pushObservation(content: string): void {
		this.#observations.push(content)
	}

	async requestUserTakeover(
		input: Omit<UserTakeoverRequest, 'id'>,
		options?: { signal?: AbortSignal },
	): Promise<UserTakeoverResolution> {
		if (!this.onUserTakeover) {
			throw new Error('requestUserTakeover requires onUserTakeover callback')
		}
		if (this.#takeoverActive) throw new Error('A user takeover request is already active.')
		if (!this.#runLoopActive || this.#status !== 'running') {
			throw new Error('User takeover requires an active running task.')
		}

		const { signal, dispose } = this.#combineAbortSignals([
			this.#abortController.signal,
			...(options?.signal ? [options.signal] : []),
		])
		this.#takeoverActive = true

		try {
			signal.throwIfAborted()
			await this.pageController.cleanUpHighlights()
			await this.pageController.hideMask()
			signal.throwIfAborted()

			const request: UserTakeoverRequest = { ...input, id: uid() }
			const event: UserTakeoverEvent = { type: 'user_takeover', request, status: 'waiting' }

			this.history.push(event)
			this.#setStatus('waiting_for_user')
			this.#emitActivity({ type: 'waiting_for_user', request })
			this.#emitHistoryChange()

			const resolution = await this.#awaitWithSignal(
				this.onUserTakeover(request, { signal }),
				signal,
			)
			signal.throwIfAborted()

			event.status = resolution
			this.#emitHistoryChange()

			if (resolution === 'completed') {
				await this.pageController.showMask()
				signal.throwIfAborted()
				this.pushObservation(
					'User completed manual takeover. Re-observe the page and continue from the current task.',
				)
				this.#setStatus('running')
			} else {
				this.#pauseRequested = true
			}

			return resolution
		} finally {
			this.#takeoverActive = false
			dispose()
		}
	}

	/** Stop the current task. Agent remains reusable. */
	stop() {
		const wasPaused = this.#status === 'paused'
		if (wasPaused) {
			this.#setStatus('error')
			this.#recordError('Task aborted')
		}

		this.pageController.cleanUpHighlights()
		this.pageController.hideMask()
		this.#abortController.abort()
	}

	async execute(task: string): Promise<ExecutionResult> {
		if (this.disposed) throw new Error('PageAgent has been disposed. Create a new instance.')
		if (this.#runLoopActive) throw new Error('A task is already running.')
		if (
			this.#status === 'running' ||
			this.#status === 'waiting_for_user' ||
			this.#status === 'paused'
		) {
			throw new Error('A task is already running.')
		}
		if (!task) throw new Error('Task is required')

		this.task = task
		this.taskId = uid()

		this.history = []
		this.history.push({ type: 'user_message', content: task })
		this.#observations = []
		this.#pauseRequested = false
		this.#states = { totalWaitTime: 0, lastURL: '', browserState: null }
		this.#abortController = new AbortController()

		this.#setStatus('running')
		this.#emitHistoryChange()

		return this.#runTaskLoop({ setupTask: true })
	}

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

	restoreConversation({
		task,
		history,
		status,
	}: {
		task: string
		history: HistoricalEvent[]
		status: Extract<AgentStatus, 'completed' | 'error'>
	}): void {
		if (this.disposed) throw new Error('PageAgent has been disposed. Create a new instance.')
		if (this.#runLoopActive || isAgentStatusActive(this.#status)) {
			throw new Error('Cannot restore a conversation while a task is active.')
		}
		if (!task) throw new Error('Task is required')

		this.task = task
		this.taskId = uid()
		this.history = [...history]
		this.#observations = []
		this.#pauseRequested = false
		this.#states = { totalWaitTime: 0, lastURL: '', browserState: null }
		this.#abortController = new AbortController()
		this.#setStatus(status)
		this.#emitHistoryChange()
	}

	async resume(): Promise<ExecutionResult> {
		if (this.disposed) throw new Error('PageAgent has been disposed. Create a new instance.')
		if (this.#status !== 'paused') throw new Error('Only paused tasks can be resumed.')
		if (this.#runLoopActive) throw new Error('Paused task is still settling.')
		if (!this.task) throw new Error('No paused task to resume.')

		this.#abortController = new AbortController()
		this.#pauseRequested = false
		this.pushObservation('User resumed the paused task. Re-observe the page and continue.')
		this.#setStatus('running')
		this.#emitHistoryChange()

		return this.#runTaskLoop({ setupTask: false })
	}

	async #runTaskLoop({ setupTask }: { setupTask: boolean }): Promise<ExecutionResult> {
		if (this.#runLoopActive) throw new Error('A task is already running.')
		this.#runLoopActive = true

		try {
			return await this.#runTaskLoopBody({ setupTask })
		} finally {
			this.#runLoopActive = false
		}
	}

	async #runTaskLoopBody({ setupTask }: { setupTask: boolean }): Promise<ExecutionResult> {
		const onBeforeStep = this.config.onBeforeStep
		const onAfterStep = this.config.onAfterStep
		const onBeforeTask = this.config.onBeforeTask
		const onAfterTask = this.config.onAfterTask

		if (setupTask) {
			try {
				await onBeforeTask?.(this)
				this.#abortController.signal.throwIfAborted()
			} catch (error) {
				if (this.#isAbortError(error)) {
					const taskResult = this.#handleTaskError(error)
					return this.#finalizeTerminalExecution(false, taskResult, onAfterTask, 'error')
				}
				this.#setStatus('error')
				throw error
			}
			if (this.#pauseRequested) return this.#settlePausedExecution(onAfterTask)
		}

		try {
			await this.pageController.showMask()
		} catch (error) {
			if (this.#isAbortError(error)) {
				const taskResult = this.#handleTaskError(error)
				return this.#finalizeTerminalExecution(false, taskResult, onAfterTask, 'error')
			}
			this.#setStatus('error')
			throw error
		}

		let step = this.history.reduce((nextStep, event) => {
			return event.type === 'step' ? Math.max(nextStep, event.stepIndex + 1) : nextStep
		}, 0)
		let taskSuccess: boolean
		let taskResult: string

		while (true) {
			console.group(`step: ${step}`)

			try {
				await this.#maybeCompactHistory()
				this.#abortController.signal.throwIfAborted()
				await onBeforeStep?.(this, step)
				this.#abortController.signal.throwIfAborted()
			} catch (error: unknown) {
				console.groupEnd()
				taskResult = this.#handleTaskError(error)
				taskSuccess = false
				break
			}

			if (this.#pauseRequested) {
				console.groupEnd()
				return this.#settlePausedExecution(onAfterTask)
			}

			let actionName = ''
			let action: AgentStepEvent['action']

			try {
				// observe
				console.log(chalk.blue.bold('👀 Observing...'))

				this.#states.browserState = await this.pageController.getBrowserState()
				await this.#handleObservations()

				// assemble prompts

				const availableTools = this.#getAvailableTools()
				const messages = [
					{
						role: 'system' as const,
						content: this.#getSystemPrompt(availableTools),
					},
					{ role: 'user' as const, content: await this.#assembleUserPrompt() },
				]

				const macroTool = { AgentOutput: this.#packMacroTool(availableTools) }

				// invoke LLM

				console.log(chalk.blue.bold('🧠 Thinking...'))
				this.#emitActivity({ type: 'thinking' })

				const result = await this.#llm.invoke(messages, macroTool, this.#abortController.signal, {
					toolChoiceName: 'AgentOutput',
					normalizeResponse: (res) => normalizeResponse(res, availableTools),
				})

				// assemble history

				const macroResult = result.toolResult as MacroToolResult
				const input = macroResult.input
				const output = macroResult.output
				const reflection: Partial<AgentReflection> = {
					evaluation_previous_goal: input.evaluation_previous_goal,
					memory: input.memory,
					next_goal: input.next_goal,
				}
				actionName = Object.keys(input.action)[0]
				action = {
					name: actionName,
					input: input.action[actionName],
					output: output,
				}

				this.history.push({
					type: 'step',
					stepIndex: step,
					reflection,
					action,
					usage: result.usage,
					rawResponse: result.rawResponse,
					rawRequest: result.rawRequest,
				} as AgentStepEvent)
				this.#emitHistoryChange()

				await onAfterStep?.(this, this.history)
				this.#abortController.signal.throwIfAborted()
			} catch (error: unknown) {
				console.groupEnd()
				taskResult = this.#handleTaskError(error)
				taskSuccess = false
				break
			}

			console.groupEnd()

			if (this.#pauseRequested) return this.#settlePausedExecution(onAfterTask)

			if (actionName === 'done') {
				taskSuccess = action.input?.success ?? false
				taskResult = action.input?.text || 'no text provided'
				console.log(chalk.green.bold('Task completed'), taskSuccess, taskResult)
				break
			}

			step++
			await waitFor(this.config.stepDelay ?? 0.4)
		}

		return this.#finalizeTerminalExecution(taskSuccess, taskResult, onAfterTask)
	}

	async #finalizeTerminalExecution(
		success: boolean,
		data: string,
		onAfterTask: PageAgentCoreConfig['onAfterTask'],
		state?: ExecutionResult['state'],
	): Promise<ExecutionResult> {
		this.#onDone(success)
		const result: ExecutionResult = {
			success,
			data,
			history: this.history,
			...(state ? { state } : {}),
		}
		await onAfterTask?.(this, result)
		return result
	}

	async #settlePausedExecution(
		onAfterTask: PageAgentCoreConfig['onAfterTask'],
	): Promise<ExecutionResult> {
		this.#pauseRequested = false
		const result: ExecutionResult = {
			success: false,
			data: 'Task paused',
			history: this.history,
			state: 'paused',
		}

		this.#setStatus('paused')
		await onAfterTask?.(this, result)

		if (this.#status === 'error') {
			result.data = 'Task aborted'
			result.state = 'error'
		}

		return result
	}

	#handleTaskError(error: unknown): string {
		const isAbortError = this.#isAbortError(error)
		if (!isAbortError) console.error('Task failed', error)
		const taskResult = isAbortError ? 'Task aborted' : String(error)
		this.#recordError(taskResult, error)
		return taskResult
	}

	#isAbortError(error: unknown): boolean {
		return (error as any)?.name === 'AbortError'
	}

	#recordError(message: string, rawResponse?: unknown): void {
		this.#emitActivity({ type: 'error', message })
		this.history.push({ type: 'error', message, rawResponse })
		this.#emitHistoryChange()
	}

	#combineAbortSignals(signals: AbortSignal[]): {
		signal: AbortSignal
		dispose: () => void
	} {
		const uniqueSignals = [...new Set(signals)]
		if (uniqueSignals.length === 1) {
			return { signal: uniqueSignals[0], dispose: () => {} }
		}

		const controller = new AbortController()
		const listeners = new Map<AbortSignal, () => void>()
		const abortFrom = (signal: AbortSignal) => {
			if (!controller.signal.aborted) controller.abort(signal.reason)
		}

		for (const signal of uniqueSignals) {
			if (signal.aborted) {
				abortFrom(signal)
				break
			}

			const listener = () => abortFrom(signal)
			listeners.set(signal, listener)
			signal.addEventListener('abort', listener, { once: true })
		}

		return {
			signal: controller.signal,
			dispose: () => {
				for (const [signal, listener] of listeners) {
					signal.removeEventListener('abort', listener)
				}
			},
		}
	}

	async #awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
		signal.throwIfAborted()

		let handleAbort: (() => void) | undefined
		const aborted = new Promise<never>((_, reject) => {
			handleAbort = () => reject(signal.reason)
			signal.addEventListener('abort', handleAbort, { once: true })
		})

		try {
			return await Promise.race([promise, aborted])
		} finally {
			if (handleAbort) signal.removeEventListener('abort', handleAbort)
		}
	}

	/**
	 * Merge all tools into a single MacroTool with the following input:
	 * - thinking: string
	 * - evaluation_previous_goal: string
	 * - memory: string
	 * - next_goal: string
	 * - action: { toolName: toolInput }
	 * where action must be selected from the tools enabled for the current request
	 */
	#packMacroTool(tools: typeof this.tools): Tool<MacroToolInput, MacroToolResult> {
		const actionSchemas = Array.from(tools.entries()).map(([toolName, tool]) => {
			return z.object({ [toolName]: tool.inputSchema }).describe(tool.description)
		})

		const actionSchema = z.union(actionSchemas as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])

		const macroToolSchema = z.object({
			// thinking: z.string().optional(),
			evaluation_previous_goal: z.string().optional(),
			memory: z.string().optional(),
			next_goal: z.string().optional(),
			action: actionSchema,
		})

		return {
			description: 'You MUST call this tool every step!',
			inputSchema: macroToolSchema as z.ZodType<MacroToolInput>,
			execute: async (input: MacroToolInput): Promise<MacroToolResult> => {
				const signal = this.#abortController.signal
				signal.throwIfAborted()

				console.log(chalk.blue.bold('MacroTool input'), input)
				const action = input.action

				const toolName = Object.keys(action)[0]
				const toolInput = action[toolName]

				// Build reflection text, only include non-empty fields
				const reflectionLines: string[] = []
				if (input.evaluation_previous_goal)
					reflectionLines.push(`✅: ${input.evaluation_previous_goal}`)
				if (input.memory) reflectionLines.push(`💾: ${input.memory}`)
				if (input.next_goal) reflectionLines.push(`🎯: ${input.next_goal}`)

				const reflectionText = reflectionLines.length > 0 ? reflectionLines.join('\n') : ''

				if (reflectionText) {
					console.log(reflectionText)
				}

				// Find the corresponding tool
				const tool = tools.get(toolName)
				assert(tool, `Tool ${toolName} not found`)

				console.log(chalk.blue.bold(`Executing tool: ${toolName}`), toolInput)

				// Emit executing activity
				this.#emitActivity({ type: 'executing', tool: toolName, input: toolInput })

				const startTime = Date.now()

				const result = await tool.execute.bind(this)(toolInput, { signal })
				// Enforce abort even if the tool ignored the signal and resolved normally.
				signal.throwIfAborted()

				const duration = Date.now() - startTime
				console.log(chalk.green.bold(`Tool (${toolName}) executed for ${duration}ms`), result)

				// Emit executed activity
				this.#emitActivity({
					type: 'executed',
					tool: toolName,
					input: toolInput,
					output: result,
					duration,
				})

				// counting wait time
				if (toolName === 'wait') {
					this.#states.totalWaitTime += toolInput?.seconds || 0
				} else {
					this.#states.totalWaitTime = 0
				}

				// Return structured result
				return {
					input,
					output: result,
				}
			},
		}
	}

	/**
	 * Get system prompt, dynamically replace language settings based on configured language
	 */
	#getSystemPrompt(availableTools: typeof this.tools): string {
		const basePrompt = this.config.customSystemPrompt
			? this.config.customSystemPrompt
			: SYSTEM_PROMPT.replace(
					/Default working language: \*\*.*?\*\*/,
					`Default working language: **${this.config.language === 'zh-CN' ? '中文' : 'English'}**`,
				)

		let prompt = basePrompt
		if (!availableTools.has('request_user_takeover')) {
			prompt = prompt.replace(MANUAL_TAKEOVER_RULES_PATTERN, '')
		}
		if (!availableTools.has('ask_user')) {
			prompt = prompt.replace(ASK_USER_RULES_PATTERN, '')
		}
		return prompt
	}

	#getAvailableTools(): typeof this.tools {
		const availableTools = new Map(this.tools)
		if (!this.onUserTakeover) availableTools.delete('request_user_takeover')
		if (!this.onAskUser) availableTools.delete('ask_user')
		return availableTools
	}

	/**
	 * Get instructions from config
	 */
	async #getInstructions(): Promise<string> {
		const { instructions, experimentalLlmsTxt } = this.config

		const systemInstructions = instructions?.system?.trim()
		let pageInstructions: string | undefined

		const url = this.#states.browserState?.url || ''
		if (instructions?.getPageInstructions && url) {
			try {
				pageInstructions = instructions.getPageInstructions(url)?.trim()
			} catch (error) {
				console.error(
					chalk.red('[PageAgent] Failed to execute getPageInstructions callback:'),
					error,
				)
			}
		}

		const llmsTxt = experimentalLlmsTxt && url ? await fetchLlmsTxt(url) : undefined

		if (!systemInstructions && !pageInstructions && !llmsTxt) return ''

		let result = '<instructions>\n'

		if (systemInstructions) {
			result += `<system_instructions>\n${systemInstructions}\n</system_instructions>\n`
		}

		if (pageInstructions) {
			result += `<page_instructions>\n${pageInstructions}\n</page_instructions>\n`
		}

		if (llmsTxt) {
			result += `<llms_txt>\n${llmsTxt}\n</llms_txt>\n`
		}

		result += '</instructions>\n\n'

		return result
	}

	/**
	 * Generate system observations before each step
	 * @todo loop detection
	 * @todo console error
	 */
	async #handleObservations(): Promise<void> {
		// Accumulated wait time warning
		if (this.#states.totalWaitTime >= 3) {
			this.pushObservation(
				`You have waited ${this.#states.totalWaitTime} seconds accumulatively. ` +
					`DO NOT wait any longer unless you have a good reason.`,
			)
		}

		// Detect URL change
		const currentURL = this.#states.browserState?.url || ''
		if (currentURL !== this.#states.lastURL) {
			this.pushObservation(`Page navigated to → ${currentURL}`)
			this.#states.lastURL = currentURL
			await waitFor(0.5) // wait for page to stabilize
		}

		// Push observations to history and emit
		if (this.#observations.length > 0) {
			for (const content of this.#observations) {
				this.history.push({ type: 'observation', content })
				console.log(chalk.cyan('Observation:'), content)
			}
			this.#observations = []
			this.#emitHistoryChange()
		}
	}

	#estimateHistoryTokens(): number {
		let chars = 0
		for (const event of this.#projectHistory()) {
			if (event.type === 'summary') {
				chars += event.content.length
			} else if (event.type === 'user_message') {
				chars += event.content.length
			} else if (event.type === 'step') {
				chars += (event.reflection.evaluation_previous_goal ?? '').length
				chars += (event.reflection.memory ?? '').length
				chars += (event.reflection.next_goal ?? '').length
				chars += event.action.output.length
			} else if (event.type === 'observation') {
				chars += event.content.length
			} else if (event.type === 'user_takeover') {
				chars += 'User took over control and made changes to the page'.length
			}
		}
		return Math.ceil(chars / 4)
	}

	async #maybeCompactHistory(): Promise<void> {
		if (!this.#compaction.enabled) return
		if (this.#estimateHistoryTokens() >= this.#compaction.softTokens) {
			await this.#compactProjectedHistory()
		}
		this.#evictOldestIfHardPressure()
	}

	async #compactProjectedHistory(): Promise<void> {
		const projected = this.#projectHistory()
		const steps = projected.filter((event): event is AgentStepEvent => event.type === 'step')
		if (steps.length <= this.#compaction.keepRecentSteps) return

		const keepFrom = steps[steps.length - this.#compaction.keepRecentSteps]
		const keepFromIndex = this.history.indexOf(keepFrom)
		if (keepFromIndex <= 0) return

		const toSummarize = this.history
			.slice(0, keepFromIndex)
			.filter(
				(event) =>
					event.type === 'step' || event.type === 'observation' || event.type === 'summary',
			)
		if (toSummarize.length === 0) return

		let content: string
		try {
			content = await this.#summarizeForCompaction(toSummarize)
		} catch (error) {
			if (this.#isAbortError(error)) throw error
			const dropped = toSummarize.filter((event) => event.type === 'step').length
			content = `[earlier ${dropped} steps condensed; summarizer unavailable. Call recall_steps(indices) for verbatim records.]`
		}
		this.history.splice(keepFromIndex, 0, {
			type: 'summary',
			content,
			coversThroughIndex: keepFromIndex - 1,
		})
		this.#emitHistoryChange()
	}

	#evictOldestIfHardPressure(): void {
		const lastStep = [...this.#projectHistory()]
			.reverse()
			.find((event): event is AgentStepEvent => event.type === 'step')
		if (!lastStep || lastStep.usage.promptTokens < this.#compaction.hardTokens) return
		this.#evictOldest()
	}

	#evictOldest(): void {
		const projected = this.#projectHistory()
		const firstEvictable = projected.find(
			(event) => event.type === 'step' || event.type === 'observation',
		)
		if (!firstEvictable) return

		const index = this.history.indexOf(firstEvictable)
		if (index < 0) return

		const latestSummary = [...this.history]
			.reverse()
			.find((event): event is SummaryEvent => event.type === 'summary')
		if (latestSummary && latestSummary.coversThroughIndex >= index) return

		if (latestSummary) {
			latestSummary.coversThroughIndex = index
		} else {
			this.history.splice(index + 1, 0, {
				type: 'summary',
				content:
					'[oldest steps evicted under context pressure; call recall_steps(indices) for verbatim records.]',
				coversThroughIndex: index,
			})
		}
		this.#emitHistoryChange()
	}

	async #summarizeForCompaction(events: HistoricalEvent[]): Promise<string> {
		const transcript = events
			.map((event) => {
				if (event.type === 'step') {
					return (
						`step ${event.stepIndex}: ${event.action.name} -> ${event.action.output}` +
						` | memory: ${event.reflection.memory ?? ''}`
					)
				}
				if (event.type === 'observation') return `sys: ${event.content}`
				if (event.type === 'summary') return `prior_summary: ${event.content}`
				return ''
			})
			.filter(Boolean)
			.join('\n')

		const result = await this.#llm.invoke(
			[
				{
					role: 'system',
					content:
						'You compress an autonomous web agent progress log. Preserve a ' +
						'step-indexed action log (step N: action -> result), current page/state, ' +
						'key findings, and unresolved items. Keep it faithful and concise. End with: ' +
						'"Earlier step details are archived; call recall_steps(indices) to fetch verbatim."',
				},
				{ role: 'user', content: transcript },
			],
			{
				submit_summary: {
					description: 'Submit the compacted progress summary.',
					inputSchema: z.object({ summary: z.string() }),
					execute: async (input: { summary: string }) => input.summary,
				},
			},
			this.#abortController.signal,
			{ toolChoiceName: 'submit_summary' },
		)

		return String(result.toolResult)
	}

	#projectHistory(): HistoricalEvent[] {
		let latestSummary: SummaryEvent | undefined
		for (let i = this.history.length - 1; i >= 0; i--) {
			const event = this.history[i]
			if (event.type === 'summary') {
				latestSummary = event
				break
			}
		}

		const floor = latestSummary?.coversThroughIndex ?? -1
		const projected: HistoricalEvent[] = []

		this.history.forEach((event, index) => {
			if (event.type === 'summary') return
			if (index <= floor && event.type !== 'user_message') return
			projected.push(event)
		})

		return latestSummary ? [latestSummary, ...projected] : projected
	}

	async #assembleUserPrompt(): Promise<string> {
		const browserState = this.#states.browserState!

		let prompt = ''

		// <instructions> (optional)

		prompt += await this.#getInstructions()

		// <agent_state>
		//  - <user_request>
		//  - <step_info>
		// <agent_state>

		const projectedHistory = this.#projectHistory()
		const stepCount = projectedHistory.filter((e) => e.type === 'step').length

		prompt += '<agent_state>\n'
		prompt += '<user_request>\n'
		prompt += `${this.task}\n`
		prompt += '</user_request>\n'
		prompt += '<step_info>\n'
		prompt += `Step ${stepCount + 1}\n`
		prompt += `Current time: ${new Date().toLocaleString()}\n`
		prompt += '</step_info>\n'
		prompt += '</agent_state>\n\n'

		// <agent_history>
		//  - <step_N> for steps
		//  - <sys> for observations and system messages

		prompt += '<agent_history>\n'

		let stepIndex = 0
		for (const event of projectedHistory) {
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
			} else if (event.type === 'error') {
				// Error events are mainly for panel rendering, not included in LLM context
				// to avoid polluting the agent's reasoning with transient errors
			}
		}

		prompt += '</agent_history>\n\n'

		// <browser_state>

		let pageContent = browserState.content
		if (this.config.transformPageContent) {
			pageContent = await this.config.transformPageContent(pageContent)
		}

		prompt += '<browser_state>\n'
		prompt += browserState.header + '\n'
		prompt += pageContent + '\n'
		prompt += browserState.footer + '\n\n'
		prompt += '</browser_state>\n\n'

		return prompt
	}

	#onDone(success = true) {
		this.pageController.cleanUpHighlights()
		this.pageController.hideMask() // No await - fire and forget
		this.#setStatus(success ? 'completed' : 'error')
		this.#abortController.abort()
	}

	dispose() {
		console.log('Disposing PageAgent...')
		this.disposed = true
		this.pageController.dispose()
		// this.history = []
		this.#abortController.abort()

		// Emit dispose event for UI cleanup
		this.dispatchEvent(new Event('dispose'))

		this.config.onDispose?.(this)
	}
}
