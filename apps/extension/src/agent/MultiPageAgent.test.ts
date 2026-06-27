import type {
	AgentStepEvent,
	ExecutionResult,
	HistoricalEvent,
	UserTakeoverRequest,
} from '@page-agent/core'
import type { BrowserState } from '@page-agent/page-controller'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createActionSignature } from './actionSignature'
import { createAgentRuntimeLifecycle, MultiPageAgent } from './MultiPageAgent'
import { RemotePageController } from './RemotePageController'
import { TabsController } from './TabsController'

describe('createAgentRuntimeLifecycle', () => {
	it('starts and stops idempotently, then starts again after pause', async () => {
		const setStorage = vi.fn<(values: Record<string, unknown>) => Promise<void>>(async () => {})
		const setInterval = vi.fn<(callback: () => void, delay: number) => number>(
			(_callback, _delay) => 7,
		)
		const clearInterval = vi.fn()
		const runtime = createAgentRuntimeLifecycle({
			setStorage,
			setInterval,
			clearInterval,
			now: () => 123,
		})

		await runtime.start()
		await runtime.start()

		expect(setInterval).toHaveBeenCalledOnce()
		expect(setStorage).toHaveBeenCalledWith({ isAgentRunning: true })
		expect(setStorage).toHaveBeenCalledTimes(1)

		const heartbeat = setInterval.mock.calls[0]![0]
		heartbeat()
		expect(setStorage).toHaveBeenCalledWith({ agentHeartbeat: 123 })

		await runtime.stop()
		await runtime.stop()

		expect(clearInterval).toHaveBeenCalledOnce()
		expect(clearInterval).toHaveBeenCalledWith(7)
		expect(setStorage).toHaveBeenCalledWith({ isAgentRunning: false })

		await runtime.start()

		expect(setInterval).toHaveBeenCalledTimes(2)
		expect(setStorage.mock.calls.filter(([value]) => value.isAgentRunning === true)).toHaveLength(2)
	})
})

const result: ExecutionResult = {
	success: true,
	data: 'done',
	history: [],
	state: 'completed',
}

function createStep({
	name = 'click_element_by_index',
	input = { index: 1 },
	output = 'Clicked',
	goal = 'Continue the task',
	stepIndex = 0,
}: Partial<AgentStepEvent['action']> & { goal?: string; stepIndex?: number } = {}): AgentStepEvent {
	return {
		type: 'step',
		stepIndex,
		reflection: { next_goal: goal },
		action: { name, input, output },
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
	}
}

function createAgent(
	overrides: Partial<ConstructorParameters<typeof MultiPageAgent>[0]> = {},
): MultiPageAgent {
	const agent = new MultiPageAgent({
		baseURL: 'https://api.example.com/v1',
		model: 'test-model',
		stepDelay: 0,
		...overrides,
	})
	agent.onUserTakeover = async () => 'completed'
	vi.spyOn(agent, 'status', 'get').mockReturnValue('running')
	return agent
}

async function recordStep(agent: MultiPageAgent, step: AgentStepEvent): Promise<void> {
	await agent.config.onAfterStep?.(agent, [step] as HistoricalEvent[])
}

function createToolCallResponse({
	action,
	step,
	goal = `Goal ${step}`,
}: {
	action: Record<string, unknown>
	step: number
	goal?: string
}): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: 'tool_calls',
					message: {
						tool_calls: [
							{
								id: `call_${step}`,
								type: 'function',
								function: {
									name: 'AgentOutput',
									arguments: JSON.stringify({
										evaluation_previous_goal: `Completed step ${step - 1}`,
										memory: `Reached step ${step}`,
										next_goal: goal,
										action,
									}),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	)
}

function mockExecuteLoop(urls: string[]): void {
	let observationIndex = 0
	vi.mocked(TabsController.prototype.init).mockImplementation(async function () {
		this.currentTabId = 1
	})
	vi.spyOn(TabsController.prototype, 'switchToTab').mockResolvedValue('Switched to tab 1')
	vi.spyOn(RemotePageController.prototype, 'showMask').mockResolvedValue()
	vi.spyOn(RemotePageController.prototype, 'hideMask').mockResolvedValue()
	vi.spyOn(RemotePageController.prototype, 'cleanUpHighlights').mockResolvedValue()
	vi.spyOn(RemotePageController.prototype, 'getBrowserState').mockImplementation(async () => {
		const url = urls[Math.min(observationIndex, urls.length - 1)]!
		observationIndex++
		return {
			url,
			title: 'Task page',
			header: '',
			content: 'Task content',
			footer: '',
		} satisfies BrowserState
	})
}

function createSequenceFetch(actions: Array<{ action: Record<string, unknown>; goal?: string }>) {
	let index = 0
	return vi.fn(async () => {
		const next = actions[index]
		if (!next) throw new Error(`Unexpected LLM request ${index + 1}`)
		index++
		return createToolCallResponse({ ...next, step: index })
	})
}

describe('MultiPageAgent stuck action guard', () => {
	beforeEach(() => {
		vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] })
		vi.stubGlobal('window', {
			setInterval: vi.fn(() => 7),
			clearInterval: vi.fn(),
		})
		vi.stubGlobal('chrome', {
			storage: { local: { set: vi.fn(async () => {}) } },
		})
		vi.spyOn(TabsController.prototype, 'init').mockResolvedValue()
		vi.spyOn(TabsController.prototype, 'waitUntilTabLoaded').mockResolvedValue()
		vi.spyOn(TabsController.prototype, 'dispose').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it('exposes list_frames through the core tool registry', () => {
		const agent = createAgent()

		expect(agent.tools.has('list_frames')).toBe(true)
	})

	it('requests takeover exactly once on the third repeated step using the observed URL', async () => {
		const agent = createAgent()
		let currentURL = 'https://example.com/task#first'
		vi.spyOn(agent, 'currentURL', 'get').mockImplementation(() => currentURL)
		const requestUserTakeover = vi
			.spyOn(agent, 'requestUserTakeover')
			.mockResolvedValue('completed')
		const lastAction = createStep({
			input: { b: 2, a: 1 },
			output: 'Still blocked',
			goal: 'Submit the current form',
		}).action
		const thirdStep = createStep({
			...lastAction,
			goal: 'Submit the current form',
			stepIndex: 2,
		})

		await recordStep(agent, createStep({ ...lastAction, stepIndex: 0 }))
		currentURL = 'https://example.com/task#second'
		await recordStep(agent, createStep({ ...lastAction, stepIndex: 1 }))
		currentURL = 'https://example.com/task#third'
		await recordStep(agent, thirdStep)

		expect(requestUserTakeover).toHaveBeenCalledOnce()
		expect(requestUserTakeover).toHaveBeenCalledWith({
			reason: 'stuck',
			title: '模型可能遇到无法解决的问题',
			message: '它连续尝试了 3 次相同操作，可能需要你暂时接管页面。',
			goal: 'Submit the current form',
			lastAction: thirdStep.action,
		})
		expect(requestUserTakeover.mock.calls[0][0].lastAction).toBe(thirdStep.action)
	})

	it('does not request takeover after only two repeated steps', async () => {
		const agent = createAgent()
		vi.spyOn(agent, 'currentURL', 'get').mockReturnValue('https://example.com/task')
		const requestUserTakeover = vi
			.spyOn(agent, 'requestUserTakeover')
			.mockResolvedValue('completed')
		const step = createStep()

		await recordStep(agent, step)
		await recordStep(agent, step)

		expect(requestUserTakeover).not.toHaveBeenCalled()
	})

	it('resets the count when the action or URL changes', async () => {
		const agent = createAgent()
		let currentURL = 'https://example.com/one'
		vi.spyOn(agent, 'currentURL', 'get').mockImplementation(() => currentURL)
		const requestUserTakeover = vi
			.spyOn(agent, 'requestUserTakeover')
			.mockResolvedValue('completed')
		const first = createStep({ input: { index: 1 } })
		const changed = createStep({ input: { index: 2 } })

		await recordStep(agent, first)
		await recordStep(agent, first)
		await recordStep(agent, changed)
		await recordStep(agent, changed)
		expect(requestUserTakeover).not.toHaveBeenCalled()

		currentURL = 'https://example.com/two'
		await recordStep(agent, changed)
		await recordStep(agent, changed)
		expect(requestUserTakeover).not.toHaveBeenCalled()

		await recordStep(agent, changed)
		expect(requestUserTakeover).toHaveBeenCalledOnce()
	})

	it('resets the count at the start of a new task', async () => {
		const agent = createAgent()
		vi.spyOn(agent, 'currentURL', 'get').mockReturnValue('https://example.com/task')
		const requestUserTakeover = vi
			.spyOn(agent, 'requestUserTakeover')
			.mockResolvedValue('completed')
		const step = createStep()

		await recordStep(agent, step)
		await recordStep(agent, step)
		await agent.config.onBeforeTask?.(agent)
		await recordStep(agent, step)
		expect(requestUserTakeover).not.toHaveBeenCalled()

		await agent.config.onAfterTask?.(agent, result)
	})

	it('composes caller lifecycle hooks with runtime behavior', async () => {
		const onBeforeTask = vi.fn()
		const onAfterTask = vi.fn()
		const onBeforeStep = vi.fn()
		const onAfterStep = vi.fn()
		const onDispose = vi.fn()
		const agent = createAgent({
			onBeforeTask,
			onAfterTask,
			onBeforeStep,
			onAfterStep,
			onDispose,
		})
		vi.spyOn(agent, 'currentURL', 'get').mockReturnValue('https://example.com/task')

		await agent.config.onBeforeTask?.(agent)
		await agent.config.onBeforeStep?.(agent, 4)
		await agent.config.onAfterStep?.(agent, [createStep({ name: 'done' })])
		await agent.config.onAfterTask?.(agent, result)
		agent.dispose()

		expect(onBeforeTask).toHaveBeenCalledWith(agent)
		expect(onBeforeStep).toHaveBeenCalledWith(agent, 4)
		expect(onAfterStep).toHaveBeenCalledWith(agent, expect.any(Array))
		expect(onAfterTask).toHaveBeenCalledWith(agent, result)
		expect(onDispose).toHaveBeenCalledWith(agent, undefined)
		expect(chrome.storage.local.set).toHaveBeenCalledWith({ isAgentRunning: true })
		expect(chrome.storage.local.set).toHaveBeenCalledWith({ isAgentRunning: false })
	})

	it('keeps the guard count across a synthetic paused onAfterTask callback', async () => {
		const agent = createAgent()
		vi.spyOn(agent, 'currentURL', 'get').mockReturnValue('https://example.com/task')
		const requestUserTakeover = vi
			.spyOn(agent, 'requestUserTakeover')
			.mockResolvedValue('completed')
		const step = createStep()

		await recordStep(agent, step)
		await recordStep(agent, step)
		await agent.config.onAfterTask?.(agent, {
			success: false,
			data: 'Task paused',
			history: [],
			state: 'paused',
		})
		await recordStep(agent, step)

		expect(requestUserTakeover).toHaveBeenCalledOnce()
	})
})

describe('MultiPageAgent execute-loop stuck action integration', () => {
	beforeEach(() => {
		vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] })
		vi.stubGlobal('window', {
			setInterval: vi.fn(() => 7),
			clearInterval: vi.fn(),
		})
		vi.stubGlobal('chrome', {
			storage: { local: { set: vi.fn(async () => {}) } },
		})
		vi.spyOn(TabsController.prototype, 'init').mockResolvedValue()
		vi.spyOn(TabsController.prototype, 'waitUntilTabLoaded').mockResolvedValue()
		vi.spyOn(TabsController.prototype, 'dispose').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it('runs beyond three repeated real steps when takeover capability is absent', async () => {
		mockExecuteLoop([
			'https://example.com/task#one',
			'https://example.com/task#two',
			'https://example.com/task#three',
			'https://example.com/task#four',
			'https://example.com/task#done',
		])
		const customFetch = createSequenceFetch([
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { done: { text: 'Finished without takeover support', success: true } } },
		])
		const agent = new MultiPageAgent({
			baseURL: 'https://api.example.com/v1',
			model: 'test-model',
			stepDelay: 0,
			customFetch,
		})

		const execution = await agent.execute('Finish without takeover support')

		expect(execution).toMatchObject({
			success: true,
			data: 'Finished without takeover support',
		})
		expect(customFetch).toHaveBeenCalledTimes(5)
		expect(execution.history.filter((event) => event.type === 'user_takeover')).toHaveLength(0)
	})

	it.each([
		{
			resolution: 'completed' as const,
			expectedState: 'completed',
			expectedFetches: 4,
		},
		{
			resolution: 'paused' as const,
			expectedState: 'paused',
			expectedFetches: 3,
		},
	])(
		'requests one $resolution takeover on the third real repeated step',
		async ({ resolution, expectedState, expectedFetches }) => {
			mockExecuteLoop([
				'https://example.com/task#one',
				'https://example.com/task#two',
				'https://example.com/task#three',
				'https://example.com/task#done',
			])
			const customFetch = createSequenceFetch([
				{ action: { switch_to_tab: { tab_id: 1 } }, goal: 'Try the task again' },
				{ action: { switch_to_tab: { tab_id: 1 } }, goal: 'Try the task again' },
				{ action: { switch_to_tab: { tab_id: 1 } }, goal: 'Ask the user to take over' },
				{ action: { done: { text: 'Finished after takeover', success: true } } },
			])
			let request: UserTakeoverRequest | undefined
			let normalizedURL = ''
			const agent = new MultiPageAgent({
				baseURL: 'https://api.example.com/v1',
				model: 'test-model',
				stepDelay: 0,
				customFetch,
			})
			const onUserTakeover = vi.fn(async (nextRequest: UserTakeoverRequest) => {
				request = nextRequest
				normalizedURL =
					createActionSignature({
						url: agent.currentURL,
						action: nextRequest.lastAction!,
					})?.url ?? ''
				return resolution
			})
			agent.onUserTakeover = onUserTakeover

			const execution = await agent.execute('Finish with takeover support')
			const takeoverEvents = execution.history.filter((event) => event.type === 'user_takeover')

			expect(onUserTakeover).toHaveBeenCalledOnce()
			expect(takeoverEvents).toHaveLength(1)
			expect(request).toMatchObject({
				reason: 'stuck',
				goal: 'Ask the user to take over',
				lastAction: {
					name: 'switch_to_tab',
					input: { tab_id: 1 },
					output: 'Switched to tab 1',
				},
			})
			expect(normalizedURL).toBe('https://example.com/task')
			expect(customFetch).toHaveBeenCalledTimes(expectedFetches)
			if (expectedState === 'paused') {
				expect(execution.state).toBe('paused')
				expect(agent.status).toBe('paused')
			} else {
				expect(execution.success).toBe(true)
				expect(agent.status).toBe('completed')
			}
		},
	)

	it('does not request takeover after only two repeated real steps', async () => {
		mockExecuteLoop([
			'https://example.com/task#one',
			'https://example.com/task#two',
			'https://example.com/task#done',
		])
		const customFetch = createSequenceFetch([
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { done: { text: 'Finished after two attempts', success: true } } },
		])
		const agent = new MultiPageAgent({
			baseURL: 'https://api.example.com/v1',
			model: 'test-model',
			stepDelay: 0,
			customFetch,
		})
		const onUserTakeover = vi.fn(async () => 'completed' as const)
		agent.onUserTakeover = onUserTakeover

		const execution = await agent.execute('Finish after two attempts')

		expect(execution.success).toBe(true)
		expect(onUserTakeover).not.toHaveBeenCalled()
		expect(execution.history.filter((event) => event.type === 'user_takeover')).toHaveLength(0)
	})

	it('does not add a product takeover after the caller hook completes one', async () => {
		mockExecuteLoop([
			'https://example.com/task#one',
			'https://example.com/task#two',
			'https://example.com/task#three',
			'https://example.com/task#done',
		])
		const customFetch = createSequenceFetch([
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { switch_to_tab: { tab_id: 1 } } },
			{ action: { done: { text: 'Finished after caller takeover', success: true } } },
		])
		const callerHook = vi.fn(async (currentAgent: MultiPageAgent, history: HistoricalEvent[]) => {
			const stepCount = history.filter((event) => event.type === 'step').length
			if (stepCount !== 3) return
			await currentAgent.requestUserTakeover({
				reason: 'permission',
				title: 'Caller takeover',
				message: 'Complete the caller-requested action.',
			})
		})
		const agent = new MultiPageAgent({
			baseURL: 'https://api.example.com/v1',
			model: 'test-model',
			stepDelay: 0,
			customFetch,
			onAfterStep: callerHook,
		})
		const onUserTakeover = vi.fn(async () => 'completed' as const)
		agent.onUserTakeover = onUserTakeover

		const execution = await agent.execute('Use the caller takeover')
		const takeoverEvents = execution.history.filter((event) => event.type === 'user_takeover')

		expect(execution.success).toBe(true)
		expect(callerHook).toHaveBeenCalledTimes(4)
		expect(onUserTakeover).toHaveBeenCalledOnce()
		expect(takeoverEvents).toHaveLength(1)
		expect(takeoverEvents[0]?.request.reason).toBe('permission')
	})
})
