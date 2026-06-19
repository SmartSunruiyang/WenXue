import type { AgentStepEvent, ExecutionResult, HistoricalEvent } from '@page-agent/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAgentRuntimeLifecycle, MultiPageAgent } from './MultiPageAgent'
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
	vi.spyOn(agent, 'status', 'get').mockReturnValue('running')
	return agent
}

async function recordStep(agent: MultiPageAgent, step: AgentStepEvent): Promise<void> {
	await agent.config.onAfterStep?.(agent, [step] as HistoricalEvent[])
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

	it('preserves the count when a paused task resumes', async () => {
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
})
