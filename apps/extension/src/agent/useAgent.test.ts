import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
	UserTakeoverRequest,
	UserTakeoverResolution,
} from '@page-agent/core'
import { describe, expect, it, vi } from 'vitest'

import {
	createAgentSessionController,
	createClearedAgentConversationState,
	createRestoredAgentConversationState,
	createTakeoverRequestController,
	hasAgentConversationContent,
	initializeAgentSession,
	isAgentTaskActive,
} from './useAgent'

const TAKEOVER_REQUEST: UserTakeoverRequest = {
	id: 'takeover-1',
	reason: 'login',
	title: 'Sign in required',
	message: 'Complete sign-in in the page.',
}

const COMPLETED_RESULT: ExecutionResult = {
	success: true,
	data: 'done',
	history: [],
	state: 'completed',
}

class FakeAgent extends EventTarget {
	status: AgentStatus = 'idle'
	task = ''
	history: HistoricalEvent[] = []
	onUserTakeover?: (
		request: UserTakeoverRequest,
		options?: { signal: AbortSignal },
	) => Promise<UserTakeoverResolution>
	execute = vi.fn(async (_task: string) => COMPLETED_RESULT)
	followUp = vi.fn(async (_task: string) => COMPLETED_RESULT)
	restoreConversation = vi.fn(
		(session: { task: string; history: HistoricalEvent[]; status: 'completed' | 'error' }) => {
			this.task = session.task
			this.history = [...session.history]
			this.status = session.status
			this.dispatchEvent(new Event('statuschange'))
			this.dispatchEvent(new Event('historychange'))
		},
	)
	resume = vi.fn(async () => COMPLETED_RESULT)
	stop = vi.fn()
	dispose = vi.fn()

	setStatus(status: AgentStatus) {
		this.status = status
		this.dispatchEvent(new Event('statuschange'))
	}

	setHistory(history: HistoricalEvent[]) {
		this.history = history
		this.dispatchEvent(new Event('historychange'))
	}

	setActivity(activity: AgentActivity) {
		this.dispatchEvent(new CustomEvent('activity', { detail: activity }))
	}
}

function createSessionHarness() {
	const state = {
		status: 'idle' as AgentStatus,
		history: [] as HistoricalEvent[],
		activity: null as AgentActivity | null,
		currentTask: '',
		takeoverRequest: null as UserTakeoverRequest | null,
	}
	const controller = createAgentSessionController({
		setStatus: (status) => {
			state.status = status
		},
		setHistory: (history) => {
			state.history = history
		},
		setActivity: (activity) => {
			state.activity = activity
		},
		setCurrentTask: (task) => {
			state.currentTask = task
		},
		setTakeoverRequest: (request) => {
			state.takeoverRequest = request
		},
	})

	return { controller, state }
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

describe('agent conversation state helpers', () => {
	it('detects whether the current conversation has visible content', () => {
		const event = { type: 'observation', content: 'Read page' } as HistoricalEvent
		const activity = { type: 'thinking' } as AgentActivity

		expect(
			hasAgentConversationContent({
				currentTask: '',
				history: [],
				activity: null,
			}),
		).toBe(false)
		expect(
			hasAgentConversationContent({
				currentTask: 'Summarize this page',
				history: [],
				activity: null,
			}),
		).toBe(true)
		expect(
			hasAgentConversationContent({
				currentTask: '',
				history: [event],
				activity: null,
			}),
		).toBe(true)
		expect(
			hasAgentConversationContent({
				currentTask: '',
				history: [],
				activity,
			}),
		).toBe(true)
	})

	it('creates an empty visible conversation state for a new conversation', () => {
		expect(createClearedAgentConversationState()).toEqual({
			status: 'idle',
			history: [],
			activity: null,
			currentTask: '',
		})
	})

	it('creates a visible conversation state restored from a saved history session', () => {
		const event = { type: 'observation', content: 'Read page' } as HistoricalEvent
		const history = [event]

		const restored = createRestoredAgentConversationState({
			task: 'Summarize this page',
			history,
			status: 'completed',
		})

		expect(restored).toEqual({
			status: 'completed',
			history: [event],
			activity: null,
			currentTask: 'Summarize this page',
		})
		expect(restored.history).not.toBe(history)
	})

	it.each([
		['running', true],
		['waiting_for_user', true],
		['paused', true],
		['idle', false],
		['completed', false],
		['error', false],
	] as const)('reports whether %s locks the active task', (status, expected) => {
		expect(isAgentTaskActive(status)).toBe(expected)
	})
})

describe('agent session initialization', () => {
	it('does not create or bind an agent when the initial load is aborted', async () => {
		const load = createDeferred<string>()
		const abortController = new AbortController()
		const createAgent = vi.fn(() => new FakeAgent())
		const bindAgent = vi.fn()
		const setConfig = vi.fn()

		const initialization = initializeAgentSession({
			signal: abortController.signal,
			loadConfig: () => load.promise,
			createAgent,
			bindAgent,
			setConfig,
		})
		abortController.abort()
		load.resolve('loaded')
		await initialization

		expect(createAgent).not.toHaveBeenCalled()
		expect(bindAgent).not.toHaveBeenCalled()
		expect(setConfig).not.toHaveBeenCalled()
	})

	it('disposes an agent if initialization is aborted during construction', async () => {
		const abortController = new AbortController()
		const agent = new FakeAgent()
		const bindAgent = vi.fn()
		const setConfig = vi.fn()

		await initializeAgentSession({
			signal: abortController.signal,
			loadConfig: async () => 'loaded',
			createAgent: () => {
				abortController.abort()
				return agent
			},
			bindAgent,
			setConfig,
		})

		expect(agent.dispose).toHaveBeenCalledTimes(1)
		expect(bindAgent).not.toHaveBeenCalled()
		expect(setConfig).not.toHaveBeenCalled()
	})
})

describe('takeover request controller', () => {
	it('completes the active request exactly once and removes its abort listener', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const abortController = new AbortController()
		const removeListener = vi.spyOn(abortController.signal, 'removeEventListener')
		const controller = createTakeoverRequestController((request) => requests.push(request))

		const resolution = controller.request(TAKEOVER_REQUEST, {
			signal: abortController.signal,
		})
		controller.resolve('completed')
		controller.resolve('paused')

		await expect(resolution).resolves.toBe('completed')
		expect(requests).toEqual([TAKEOVER_REQUEST, null])
		expect(removeListener).toHaveBeenCalledTimes(1)
	})

	it('pauses the active request', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const controller = createTakeoverRequestController((request) => requests.push(request))

		const resolution = controller.request(TAKEOVER_REQUEST)
		controller.resolve('paused')

		await expect(resolution).resolves.toBe('paused')
		expect(requests).toEqual([TAKEOVER_REQUEST, null])
	})

	it('rejects and clears the active request when its signal aborts', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const abortController = new AbortController()
		const controller = createTakeoverRequestController((request) => requests.push(request))
		const reason = new Error('task stopped')

		const resolution = controller.request(TAKEOVER_REQUEST, {
			signal: abortController.signal,
		})
		abortController.abort(reason)
		controller.resolve('completed')

		await expect(resolution).rejects.toBe(reason)
		expect(requests).toEqual([TAKEOVER_REQUEST, null])
	})

	it('rejects and clears the active request during cleanup', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const controller = createTakeoverRequestController((request) => requests.push(request))

		const resolution = controller.request(TAKEOVER_REQUEST)
		controller.dispose()
		controller.dispose()

		await expect(resolution).rejects.toMatchObject({ name: 'AbortError' })
		expect(requests).toEqual([TAKEOVER_REQUEST, null])
	})

	it('prevents an earlier request from settling a later request', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const firstAbortController = new AbortController()
		const controller = createTakeoverRequestController((request) => requests.push(request))
		const secondRequest = { ...TAKEOVER_REQUEST, id: 'takeover-2', title: 'Captcha required' }

		const firstResolution = controller.request(TAKEOVER_REQUEST, {
			signal: firstAbortController.signal,
		})
		const secondResolution = controller.request(secondRequest)
		firstAbortController.abort(new Error('stale abort'))
		controller.resolve('completed')

		await expect(firstResolution).rejects.toMatchObject({ name: 'AbortError' })
		await expect(secondResolution).resolves.toBe('completed')
		expect(requests).toEqual([TAKEOVER_REQUEST, null, secondRequest, null])
	})
})

describe('agent session controller', () => {
	it('synchronizes replacement state and live agent events', () => {
		const event = { type: 'observation', content: 'Existing history' } as HistoricalEvent
		const agent = new FakeAgent()
		agent.status = 'completed'
		agent.task = 'Existing task'
		agent.history = [event]
		const { controller, state } = createSessionHarness()

		controller.bind(agent, { enableUserTakeover: true })

		expect(state).toEqual({
			status: 'completed',
			history: [event],
			activity: null,
			currentTask: 'Existing task',
			takeoverRequest: null,
		})
		expect(state.history).not.toBe(agent.history)

		const nextEvent = { type: 'observation', content: 'New history' } as HistoricalEvent
		const activity = { type: 'thinking' } as AgentActivity
		agent.setStatus('running')
		agent.setHistory([nextEvent])
		agent.setActivity(activity)

		expect(state.status).toBe('running')
		expect(state.history).toEqual([nextEvent])
		expect(state.activity).toBe(activity)

		agent.setStatus('paused')
		expect(state.activity).toBeNull()
	})

	it.each(['running', 'waiting_for_user', 'paused'] as const)(
		'rejects execute while %s without mutating visible or takeover state',
		async (status) => {
			const event = { type: 'observation', content: 'Keep me' } as HistoricalEvent
			const activity = { type: 'thinking' } as AgentActivity
			const agent = new FakeAgent()
			agent.status = status
			agent.task = 'Current task'
			agent.history = [event]
			const { controller, state } = createSessionHarness()
			controller.bind(agent, { enableUserTakeover: true })
			agent.setActivity(activity)
			const resolution = agent.onUserTakeover!(TAKEOVER_REQUEST)
			const snapshot = {
				...state,
				history: state.history,
			}

			await expect(controller.execute('New task')).rejects.toThrow('Agent task is active.')

			expect(agent.execute).not.toHaveBeenCalled()
			expect(state).toEqual(snapshot)
			controller.completeUserTakeover()
			await expect(resolution).resolves.toBe('completed')
		},
	)

	it('starts an allowed execute with clean takeover and conversation state', async () => {
		const agent = new FakeAgent()
		agent.status = 'completed'
		agent.task = 'Old task'
		agent.history = [{ type: 'observation', content: 'Old history' }]
		const { controller, state } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true })
		agent.setActivity({ type: 'thinking' })
		const resolution = agent.onUserTakeover!(TAKEOVER_REQUEST)

		await expect(controller.execute('New task')).resolves.toBe(COMPLETED_RESULT)

		await expect(resolution).rejects.toMatchObject({ name: 'AbortError' })
		expect(agent.execute).toHaveBeenCalledWith('New task')
		expect(state).toEqual({
			status: 'completed',
			history: [],
			activity: null,
			currentTask: 'New task',
			takeoverRequest: null,
		})
	})

	it('followUp delegates to agent.followUp without clearing history', async () => {
		const event = { type: 'observation', content: 'Existing history' } as HistoricalEvent
		const agent = new FakeAgent()
		agent.status = 'completed'
		agent.task = 'Existing task'
		agent.history = [event]
		const { controller, state } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true })

		await expect(controller.followUp('Follow-up task')).resolves.toBe(COMPLETED_RESULT)

		expect(agent.followUp).toHaveBeenCalledWith('Follow-up task')
		expect(state.currentTask).toBe('Follow-up task')
		expect(state.history).toEqual([event])
	})

	it('restores a saved conversation into the bound agent before follow-up', async () => {
		const event = { type: 'user_message', content: '任务A' } as HistoricalEvent
		const agent = new FakeAgent()
		const { controller, state } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true })

		expect(
			controller.restoreConversation({
				task: '任务A',
				history: [event],
				status: 'completed',
			}),
		).toBe(true)
		await controller.followUp('任务B')

		expect(agent.restoreConversation).toHaveBeenCalledWith({
			task: '任务A',
			history: [event],
			status: 'completed',
		})
		expect(agent.followUp).toHaveBeenCalledWith('任务B')
		expect(state.status).toBe('completed')
		expect(state.history).toEqual([event])
		expect(state.currentTask).toBe('任务B')
	})

	it.each(['running', 'waiting_for_user', 'paused'] as const)(
		'rejects reconfiguration while %s before saving and preserves the resolver',
		async (status) => {
			const agent = new FakeAgent()
			agent.status = status
			agent.task = 'Current task'
			const { controller, state } = createSessionHarness()
			controller.bind(agent, { enableUserTakeover: true })
			const resolution = agent.onUserTakeover!(TAKEOVER_REQUEST)
			const save = vi.fn(async (value: string) => value)
			const apply = vi.fn()
			const snapshot = { ...state }

			await expect(controller.configure('next', save, apply)).rejects.toThrow(
				'Agent task is active.',
			)

			expect(save).not.toHaveBeenCalled()
			expect(apply).not.toHaveBeenCalled()
			expect(state).toEqual(snapshot)
			controller.pauseUserTakeover()
			await expect(resolution).resolves.toBe('paused')
		},
	)

	it('saves and applies configuration when the task is inactive', async () => {
		const agent = new FakeAgent()
		agent.status = 'completed'
		const { controller } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true })
		const save = vi.fn(async (value: string) => `${value}-saved`)
		const apply = vi.fn()

		await controller.configure('next', save, apply)

		expect(save).toHaveBeenCalledWith('next')
		expect(apply).toHaveBeenCalledWith('next-saved')
	})

	it('keeps configure pending through async replacement and rejects execute during the transaction', async () => {
		const oldAgent = new FakeAgent()
		oldAgent.status = 'completed'
		const { controller } = createSessionHarness()
		controller.bind(oldAgent, { enableUserTakeover: true })
		const replacement = createDeferred<void>()
		const apply = vi.fn(async () => replacement.promise)
		let configured = false

		const configurePromise = controller
			.configure('next', async (value) => value, apply)
			.then(() => {
				configured = true
			})
		await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1))

		expect(configured).toBe(false)
		await expect(controller.execute('Must wait')).rejects.toThrow('Agent is being configured.')
		expect(oldAgent.execute).not.toHaveBeenCalled()

		replacement.resolve()
		await configurePromise
		expect(configured).toBe(true)
	})

	it('runs the Hub configure-then-execute sequence on the replacement agent', async () => {
		const oldAgent = new FakeAgent()
		oldAgent.status = 'completed'
		oldAgent.task = 'Old task'
		const replacement = new FakeAgent()
		replacement.execute.mockResolvedValue({
			...COMPLETED_RESULT,
			data: 'replacement result',
		})
		const { controller, state } = createSessionHarness()
		controller.bind(oldAgent, { enableUserTakeover: false })

		await controller.configure(
			'next',
			async (value) => value,
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 0))
				controller.bind(replacement, { enableUserTakeover: false })
			},
		)
		const result = await controller.execute('Hub task')

		expect(result.data).toBe('replacement result')
		expect(oldAgent.execute).not.toHaveBeenCalled()
		expect(replacement.execute).toHaveBeenCalledWith('Hub task')
		expect(oldAgent.dispose).toHaveBeenCalledTimes(1)
		expect(state).toEqual({
			status: 'idle',
			history: [],
			activity: null,
			currentTask: 'Hub task',
			takeoverRequest: null,
		})
	})

	it('cleans the old resolver once and resets stale UI during allowed reconfiguration', async () => {
		const oldAgent = new FakeAgent()
		oldAgent.status = 'completed'
		oldAgent.task = 'Old task'
		oldAgent.history = [{ type: 'observation', content: 'Old history' }]
		const replacement = new FakeAgent()
		const { controller, state } = createSessionHarness()
		controller.bind(oldAgent, { enableUserTakeover: true })
		const resolution = oldAgent.onUserTakeover!(TAKEOVER_REQUEST)

		await controller.configure(
			'next',
			async (value) => value,
			() => controller.bind(replacement, { enableUserTakeover: true }),
		)
		controller.unbind(oldAgent)

		await expect(resolution).rejects.toMatchObject({ name: 'AbortError' })
		expect(oldAgent.dispose).toHaveBeenCalledTimes(1)
		expect(oldAgent.onUserTakeover).toBeUndefined()
		expect(state).toEqual({
			status: 'idle',
			history: [],
			activity: null,
			currentTask: '',
			takeoverRequest: null,
		})

		oldAgent.setStatus('error')
		expect(state.status).toBe('idle')
	})

	it('resumes without clearing the paused task or history', async () => {
		const event = { type: 'observation', content: 'Paused history' } as HistoricalEvent
		const agent = new FakeAgent()
		agent.status = 'paused'
		agent.task = 'Paused task'
		agent.history = [event]
		const { controller, state } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true })

		await expect(controller.resume()).resolves.toBe(COMPLETED_RESULT)

		expect(agent.resume).toHaveBeenCalledTimes(1)
		expect(state.currentTask).toBe('Paused task')
		expect(state.history).toEqual([event])
	})

	it('leaves takeover capability unset for Hub mode', () => {
		const agent = new FakeAgent()
		agent.onUserTakeover = vi.fn(async () => 'completed' as const)
		const { controller, state } = createSessionHarness()

		controller.bind(agent, { enableUserTakeover: false })

		expect(agent.onUserTakeover).toBeUndefined()
		expect(state.takeoverRequest).toBeNull()
	})
})
