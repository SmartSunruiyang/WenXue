// @vitest-environment jsdom
import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
	UserTakeoverRequest,
	UserTakeoverResolution,
} from '@page-agent/core'
import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WENXUE_GATEWAY_BASE_URL, WENXUE_GATEWAY_OPENAI_BASE_URL } from '@/agent/constants'
import { saveStoredConfig } from '@/lib/configStorage'
import { WENXUE_USER_SESSION_KEY } from '@/lib/userSession'

const multiPageAgentMockState = vi.hoisted(() => ({
	instances: [] as Array<{
		options: Record<string, unknown>
		status: AgentStatus
		setStatus: (status: AgentStatus) => void
		dispose: ReturnType<typeof vi.fn>
	}>,
}))

vi.mock('./MultiPageAgent', () => {
	class MockMultiPageAgent extends EventTarget {
		status: AgentStatus = 'idle'
		task = ''
		history = []
		onAskUser = undefined
		onUserTakeover = undefined
		execute = vi.fn(async () => ({
			success: true,
			data: 'done',
			history: [],
			state: 'completed',
		}))
		followUp = vi.fn(async () => ({
			success: true,
			data: 'done',
			history: [],
			state: 'completed',
		}))
		restoreConversation = vi.fn()
		resume = vi.fn(async () => ({
			success: true,
			data: 'done',
			history: [],
			state: 'completed',
		}))
		stop = vi.fn()
		dispose = vi.fn()
		pushObservation = vi.fn()

		constructor(readonly options: Record<string, unknown>) {
			super()
			multiPageAgentMockState.instances.push(this)
		}

		setStatus(status: AgentStatus) {
			this.status = status
			this.dispatchEvent(new Event('statuschange'))
		}
	}

	return { MultiPageAgent: MockMultiPageAgent }
})

import {
	createAgentForConfig,
	createAgentSessionController,
	createClearedAgentConversationState,
	createRestoredAgentConversationState,
	createTakeoverRequestController,
	createUserQuestionController,
	hasAgentConversationContent,
	initializeAgentSession,
	isAgentTaskActive,
	useAgent,
	type UseAgentResult,
	type UserQuestionRequest,
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
	onAskUser?: (question: string, options?: { signal: AbortSignal }) => Promise<string>
	onUserTakeover?: (
		request: UserTakeoverRequest,
		options?: { signal: AbortSignal },
	) => Promise<UserTakeoverResolution>
	execute = vi.fn(async () => COMPLETED_RESULT)
	followUp = vi.fn(async () => COMPLETED_RESULT)
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
	pushObservation = vi.fn()

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
		userQuestionRequest: null as UserQuestionRequest | null,
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
		setUserQuestionRequest: (request) => {
			state.userQuestionRequest = request
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

type ChromeStorageChangeListener = (
	changes: Record<string, chrome.storage.StorageChange>,
	areaName: string,
) => void

function createChromeStorageHarness(initial: Record<string, unknown> = {}) {
	const store = { ...initial }
	const listeners = new Set<ChromeStorageChangeListener>()
	const emit = (changes: Record<string, chrome.storage.StorageChange>, areaName = 'local') => {
		for (const listener of listeners) listener(changes, areaName)
	}
	const local = {
		get: vi.fn(async (keys: string | string[]) => {
			const names = Array.isArray(keys) ? keys : [keys]
			return Object.fromEntries(names.map((key) => [key, store[key]]))
		}),
		set: vi.fn(async (values: Record<string, unknown>) => {
			const changes: Record<string, chrome.storage.StorageChange> = {}
			for (const [key, newValue] of Object.entries(values)) {
				changes[key] = {
					oldValue: store[key],
					newValue,
				}
				store[key] = newValue
			}
			emit(changes)
		}),
		remove: vi.fn(async (key: string) => {
			const oldValue = store[key]
			delete store[key]
			emit({
				[key]: {
					oldValue,
					newValue: undefined,
				},
			})
		}),
	}
	const chromeHarness = {
		runtime: {
			sendMessage: vi.fn(async () => ({ ok: true, protocolVersion: 2 })),
			reload: vi.fn(),
		},
		storage: {
			local,
			onChanged: {
				addListener: vi.fn((listener: ChromeStorageChangeListener) => {
					listeners.add(listener)
				}),
				removeListener: vi.fn((listener: ChromeStorageChangeListener) => {
					listeners.delete(listener)
				}),
			},
		},
	}

	return {
		chrome: chromeHarness as unknown as typeof chrome,
		store,
		emit,
		listenerCount: () => listeners.size,
	}
}

function AgentProbe({ onRender }: { onRender: (result: UseAgentResult) => void }) {
	const result = useAgent()
	useEffect(() => {
		onRender(result)
	}, [onRender, result])
	return null
}

async function renderAgentProbe(onRender: (result: UseAgentResult) => void) {
	const container = document.createElement('div')
	document.body.append(container)
	const root: Root = createRoot(container)
	await act(async () => {
		root.render(React.createElement(AgentProbe, { onRender }))
	})
	return {
		unmount: async () => {
			await act(async () => {
				root.unmount()
			})
			container.remove()
		},
	}
}

const USER_ACCESS_TOKEN = 'cloudbase-access-token'

const originalChrome = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome

beforeEach(() => {
	multiPageAgentMockState.instances.length = 0
})

afterEach(() => {
	;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = originalChrome
	document.body.innerHTML = ''
	vi.restoreAllMocks()
})

describe('useAgent user session reload', () => {
	it('preserves live named-tool capability state across agent config copies', async () => {
		const capability = { disabled: false }
		const getNamedToolChoiceDisabled = () => capability.disabled
		const onNamedToolChoiceUnsupported = async () => {
			capability.disabled = true
		}
		const active = {
			baseURL: 'https://api.example.test/v1',
			model: 'shared-model',
			apiKey: 'text-key',
			getNamedToolChoiceDisabled,
			onNamedToolChoiceUnsupported,
		}
		const vision = { ...active, apiKey: 'vision-key' }

		createAgentForConfig(
			{
				...active,
				selectedModelId: 'custom-text',
				visionModelId: 'custom-vision',
				customModels: [
					{ id: 'custom-text', provider: 'custom', ...active },
					{ id: 'custom-vision', provider: 'custom', ...vision },
				],
			},
			{
				active,
				vision,
				questionSolverModels: { text: active, vision },
				chaoxingModels: { text: active, vision },
			},
		)

		const options = multiPageAgentMockState.instances.at(-1)?.options
		const visualModel = options?.visualObservationModel as Record<string, unknown>
		await (options?.onNamedToolChoiceUnsupported as () => Promise<void>)()

		expect((options?.getNamedToolChoiceDisabled as () => boolean)()).toBe(true)
		expect((visualModel.getNamedToolChoiceDisabled as () => boolean)()).toBe(true)
	})

	it('initializes the built-in agent without a token so the first send can show auth errors in chat', async () => {
		const storage = createChromeStorageHarness()
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const renders: UseAgentResult[] = []

		const probe = await renderAgentProbe((result) => {
			renders.push(result)
		})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		expect(multiPageAgentMockState.instances[0].options).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			apiKey: '',
			model: 'qwen3.7-max',
			experimentalIncludeAllTabs: true,
			visualObservationModel: {
				baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
				apiKey: '',
				model: 'qwen3.7-plus',
				requiresApiKey: true,
			},
		})
		expect(renders.at(-1)?.config).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			selectedModelId: 'builtin:qwen3.7-max',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: true,
		})
		expect(storage.chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1)
		expect(storage.listenerCount()).toBe(1)

		await probe.unmount()
		expect(storage.chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1)
		expect(storage.listenerCount()).toBe(0)
	})

	it('removes the deprecated global named-tool setting before creating the agent', async () => {
		const storage = createChromeStorageHarness({
			advancedConfig: { disableNamedToolChoice: true },
		})
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const renders: UseAgentResult[] = []

		const probe = await renderAgentProbe((result) => {
			renders.push(result)
		})

		await vi.waitFor(() => {
			expect(storage.store.advancedConfig).toEqual({
				systemInstruction: undefined,
				experimentalLlmsTxt: false,
				experimentalIncludeAllTabs: true,
				logRetentionDays: undefined,
				logMaxEntries: undefined,
			})
		})
		await vi.waitFor(() => expect(multiPageAgentMockState.instances.length).toBeGreaterThan(0))
		await vi.waitFor(() => expect(renders.at(-1)?.config).not.toBeNull())
		const options = multiPageAgentMockState.instances.at(-1)?.options
		expect(options?.disableNamedToolChoice).not.toBe(true)
		expect(
			(options?.visualObservationModel as Record<string, unknown> | undefined)
				?.disableNamedToolChoice,
		).not.toBe(true)
		expect(renders.at(-1)?.config).not.toHaveProperty('disableNamedToolChoice')

		await probe.unmount()
	})

	it('preserves an explicit request to limit the agent to its managed tab group', async () => {
		const storage = createChromeStorageHarness({
			advancedConfig: { experimentalIncludeAllTabs: false },
		})
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome

		const probe = await renderAgentProbe(() => {})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		expect(multiPageAgentMockState.instances[0].options).toMatchObject({
			experimentalIncludeAllTabs: false,
		})

		await probe.unmount()
	})

	it('keeps the non-visual agent available when the visual background cannot self-refresh', async () => {
		const storage = createChromeStorageHarness({ visualObserveProtocolReloadAttempt: 2 })
		storage.chrome.runtime.sendMessage = vi.fn(async () => ({ error: 'Unknown message type' }))
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const renders: UseAgentResult[] = []

		const probe = await renderAgentProbe((result) => {
			renders.push(result)
		})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		expect(renders.at(-1)?.config).not.toBeNull()
		expect(errorSpy).toHaveBeenCalledWith(
			'[useAgent] Visual observation background is unavailable:',
			expect.any(Error),
		)

		await probe.unmount()
	})

	it('rebuilds the built-in agent after the desktop handoff stores a user session', async () => {
		const storage = createChromeStorageHarness()
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const renders: UseAgentResult[] = []

		const probe = await renderAgentProbe((result) => {
			renders.push(result)
		})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))

		await act(async () => {
			await storage.chrome.storage.local.set({
				[WENXUE_USER_SESSION_KEY]: {
					userId: 'user_123',
					accessToken: USER_ACCESS_TOKEN,
					refreshToken: 'cloudbase-refresh-token',
					expiresAt: 1893456000000,
					gatewayBaseUrl: WENXUE_GATEWAY_BASE_URL,
				},
			})
		})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(2))
		expect(multiPageAgentMockState.instances[1].options).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			apiKey: USER_ACCESS_TOKEN,
			model: 'qwen3.7-max',
			visualObservationModel: {
				baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
				apiKey: USER_ACCESS_TOKEN,
				model: 'qwen3.7-plus',
			},
		})
		expect(renders.at(-1)?.config).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			selectedModelId: 'builtin:qwen3.7-max',
		})

		await probe.unmount()
		expect(storage.chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1)
		expect(storage.listenerCount()).toBe(0)
	})

	it('defers a session reload during an active task and applies it when the task finishes', async () => {
		const storage = createChromeStorageHarness()
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const probe = await renderAgentProbe(() => {})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		const activeAgent = multiPageAgentMockState.instances[0] as unknown as {
			status: AgentStatus
			dispatchEvent: (event: Event) => boolean
			dispose: ReturnType<typeof vi.fn>
		}
		await act(async () => {
			activeAgent.status = 'running'
			activeAgent.dispatchEvent(new Event('statuschange'))
		})

		await act(async () => {
			await storage.chrome.storage.local.set({
				[WENXUE_USER_SESSION_KEY]: {
					userId: 'user_456',
					accessToken: 'replacement-access-token',
					refreshToken: 'replacement-refresh-token',
					expiresAt: 1893456000000,
					gatewayBaseUrl: WENXUE_GATEWAY_BASE_URL,
				},
			})
			await Promise.resolve()
		})
		expect(multiPageAgentMockState.instances).toHaveLength(1)
		expect(activeAgent.dispose).not.toHaveBeenCalled()

		await act(async () => {
			activeAgent.status = 'completed'
			activeAgent.dispatchEvent(new Event('statuschange'))
		})
		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(2))
		expect(multiPageAgentMockState.instances[1].options).toMatchObject({
			apiKey: 'replacement-access-token',
		})
		expect(activeAgent.dispose).toHaveBeenCalledOnce()

		await probe.unmount()
	})

	it('reloads the agent when options changes the selected model', async () => {
		const storage = createChromeStorageHarness({
			customModels: [
				{
					id: 'model-deepseek',
					provider: 'deepseek',
					baseURL: 'https://api.deepseek.com',
					apiKey: 'sk-deepseek',
					model: 'deepseek-chat',
				},
			],
		})
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const renders: UseAgentResult[] = []

		const probe = await renderAgentProbe((result) => {
			renders.push(result)
		})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		await act(async () => {
			await storage.chrome.storage.local.set({ selectedModelId: 'model-deepseek' })
		})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(2))
		expect(multiPageAgentMockState.instances[1].options).toMatchObject({
			baseURL: 'https://api.deepseek.com',
			apiKey: 'sk-deepseek',
			model: 'deepseek-chat',
		})
		expect(renders.at(-1)?.config?.selectedModelId).toBe('model-deepseek')

		await probe.unmount()
	})

	it('applies sidepanel text and vision model changes exactly once', async () => {
		const customModel = {
			id: 'model-qwen-vl',
			provider: 'qwen',
			baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
			apiKey: 'sk-qwen',
			model: 'qwen-vl-max',
		}
		const storage = createChromeStorageHarness({ customModels: [customModel] })
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const renders: UseAgentResult[] = []

		const probe = await renderAgentProbe((result) => {
			renders.push(result)
		})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		await vi.waitFor(() => expect(renders.at(-1)?.config).not.toBeNull())
		await act(async () => {
			const current = renders.at(-1)?.config
			if (!current) throw new Error('Expected loaded config')
			await renders.at(-1)?.configure({
				...current,
				selectedModelId: customModel.id,
				visionModelId: customModel.id,
			})
		})

		expect(multiPageAgentMockState.instances).toHaveLength(2)
		expect(multiPageAgentMockState.instances[1].options).toMatchObject({
			baseURL: customModel.baseURL,
			apiKey: customModel.apiKey,
			model: customModel.model,
			visualObservationModel: {
				baseURL: customModel.baseURL,
				apiKey: customModel.apiKey,
				model: customModel.model,
			},
		})
		expect(storage.store.selectedModelId).toBe(customModel.id)
		expect(storage.store.visionModelId).toBe(customModel.id)

		await probe.unmount()
	})

	it('loads one consistent external model snapshot from an atomic options save', async () => {
		const textModel = {
			id: 'model-text',
			provider: 'deepseek' as const,
			baseURL: 'https://api.deepseek.com',
			apiKey: 'sk-text',
			model: 'deepseek-chat',
		}
		const visionModel = {
			id: 'model-vision',
			provider: 'qwen' as const,
			baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
			apiKey: 'sk-vision',
			model: 'qwen-vl-max',
		}
		const storage = createChromeStorageHarness()
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const renders: UseAgentResult[] = []
		const probe = await renderAgentProbe((result) => renders.push(result))
		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		await vi.waitFor(() => expect(renders.at(-1)?.config).not.toBeNull())

		vi.mocked(storage.chrome.storage.local.set).mockClear()
		await act(async () => {
			const current = renders.at(-1)?.config
			if (!current) throw new Error('Expected loaded config')
			await saveStoredConfig(storage.chrome.storage.local, {
				...current,
				selectedModelId: textModel.id,
				visionModelId: visionModel.id,
				customModels: [textModel, visionModel],
			})
		})

		expect(storage.chrome.storage.local.set).toHaveBeenCalledTimes(1)
		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(2))
		expect(multiPageAgentMockState.instances[1].options).toMatchObject({
			model: textModel.model,
			apiKey: textModel.apiKey,
			visualObservationModel: {
				model: visionModel.model,
				apiKey: visionModel.apiKey,
			},
		})
		expect(renders.at(-1)?.config).toMatchObject({
			selectedModelId: textModel.id,
			visionModelId: visionModel.id,
		})

		await probe.unmount()
	})

	it('does not swallow an external user session change during a local config save', async () => {
		const storage = createChromeStorageHarness()
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const renders: UseAgentResult[] = []
		const probe = await renderAgentProbe((result) => renders.push(result))
		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		await vi.waitFor(() => expect(renders.at(-1)?.config).not.toBeNull())

		const originalSet = storage.chrome.storage.local.set
		vi.mocked(storage.chrome.storage.local.set).mockImplementationOnce(async (values) => {
			await originalSet(values)
			await originalSet({
				[WENXUE_USER_SESSION_KEY]: {
					userId: 'user_789',
					accessToken: 'concurrent-access-token',
					refreshToken: 'concurrent-refresh-token',
					expiresAt: 1893456000000,
					gatewayBaseUrl: WENXUE_GATEWAY_BASE_URL,
				},
			})
		})

		await act(async () => {
			const current = renders.at(-1)?.config
			if (!current) throw new Error('Expected loaded config')
			await renders.at(-1)?.configure({ ...current, visionModelId: 'builtin:qwen3.7-plus' })
		})
		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(3))
		expect(multiPageAgentMockState.instances.at(-1)?.options).toMatchObject({
			apiKey: 'concurrent-access-token',
		})

		await probe.unmount()
	})

	it('defers external model updates until an active task finishes', async () => {
		const customVisionModel = {
			id: 'model-qwen-vl',
			provider: 'qwen',
			baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
			apiKey: 'sk-qwen',
			model: 'qwen-vl-max',
		}
		const storage = createChromeStorageHarness({ customModels: [customVisionModel] })
		;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = storage.chrome
		const probe = await renderAgentProbe(() => {})

		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(1))
		await act(async () => {
			multiPageAgentMockState.instances[0].setStatus('running')
			await storage.chrome.storage.local.set({ visionModelId: customVisionModel.id })
		})
		expect(multiPageAgentMockState.instances).toHaveLength(1)

		await act(async () => {
			multiPageAgentMockState.instances[0].setStatus('completed')
		})
		await vi.waitFor(() => expect(multiPageAgentMockState.instances).toHaveLength(2))
		expect(multiPageAgentMockState.instances[1].options).toMatchObject({
			visualObservationModel: {
				baseURL: customVisionModel.baseURL,
				apiKey: customVisionModel.apiKey,
				model: customVisionModel.model,
			},
		})

		await probe.unmount()
	})
})

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

	it('disposes a replacement when a task starts before initialization can bind it', async () => {
		const agent = new FakeAgent()
		const setConfig = vi.fn()

		await initializeAgentSession({
			signal: new AbortController().signal,
			loadConfig: async () => 'loaded',
			createAgent: async () => agent,
			bindAgent: () => false,
			setConfig,
		})

		expect(agent.dispose).toHaveBeenCalledTimes(1)
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

describe('user question controller', () => {
	it('returns the current answer exactly once and removes its abort listener', async () => {
		const requests: Array<UserQuestionRequest | null> = []
		const abortController = new AbortController()
		const removeListener = vi.spyOn(abortController.signal, 'removeEventListener')
		const controller = createUserQuestionController((request) => requests.push(request))

		const answer = controller.request('Which course should I open?', {
			signal: abortController.signal,
		})
		expect(controller.hasPending()).toBe(true)
		expect(controller.answer('Linear algebra')).toBe(true)
		expect(controller.answer('Calculus')).toBe(false)

		await expect(answer).resolves.toBe('Linear algebra')
		expect(requests[0]).toMatchObject({ question: 'Which course should I open?' })
		expect(requests.at(-1)).toBeNull()
		expect(controller.hasPending()).toBe(false)
		expect(removeListener).toHaveBeenCalledTimes(1)
	})

	it('rejects and clears a question when the task signal aborts', async () => {
		const requests: Array<UserQuestionRequest | null> = []
		const abortController = new AbortController()
		const controller = createUserQuestionController((request) => requests.push(request))
		const reason = new Error('task stopped')

		const answer = controller.request('Which account?', { signal: abortController.signal })
		abortController.abort(reason)

		await expect(answer).rejects.toBe(reason)
		expect(requests.at(-1)).toBeNull()
		expect(controller.hasPending()).toBe(false)
	})

	it('supersedes an earlier question without letting its abort settle the latest one', async () => {
		const requests: Array<UserQuestionRequest | null> = []
		const firstAbortController = new AbortController()
		const controller = createUserQuestionController((request) => requests.push(request))

		const firstAnswer = controller.request('First question?', {
			signal: firstAbortController.signal,
		})
		const secondAnswer = controller.request('Second question?')
		firstAbortController.abort(new Error('stale abort'))
		controller.answer('Second answer')

		await expect(firstAnswer).rejects.toMatchObject({ name: 'AbortError' })
		await expect(secondAnswer).resolves.toBe('Second answer')
		expect(requests.map((request) => request?.question ?? null)).toEqual([
			'First question?',
			null,
			'Second question?',
			null,
		])
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
			userQuestionRequest: null,
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
			userQuestionRequest: null,
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
			userQuestionRequest: null,
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
			userQuestionRequest: null,
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

	it('resets a waiting takeover by disposing the active agent and binding a replacement', async () => {
		const event = { type: 'observation', content: 'Waiting history' } as HistoricalEvent
		const agent = new FakeAgent()
		agent.status = 'waiting_for_user'
		agent.task = 'Waiting task'
		agent.history = [event]
		const replacement = new FakeAgent()
		const { controller, state } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true })
		const resolution = agent.onUserTakeover!(TAKEOVER_REQUEST)

		expect(controller.resetActiveConversation(replacement, { enableUserTakeover: true })).toBe(true)

		await expect(resolution).rejects.toMatchObject({ name: 'AbortError' })
		expect(agent.stop).toHaveBeenCalledTimes(1)
		expect(agent.dispose).toHaveBeenCalledTimes(1)
		expect(agent.onUserTakeover).toBeUndefined()
		expect(replacement.dispose).not.toHaveBeenCalled()
		expect(state).toEqual({
			status: 'idle',
			history: [],
			activity: null,
			currentTask: '',
			takeoverRequest: null,
			userQuestionRequest: null,
		})
	})

	it('routes a clarification answer back to ask_user while the agent remains running', async () => {
		const agent = new FakeAgent()
		agent.status = 'running'
		agent.task = 'Book a meeting'
		const { controller, state } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true, enableUserQuestions: true })
		agent.setActivity({ type: 'thinking' })

		const answer = agent.onAskUser!('Which day works for you?')

		expect(state.userQuestionRequest).toMatchObject({ question: 'Which day works for you?' })
		expect(state.activity).toBeNull()
		expect(state.takeoverRequest).toBeNull()
		await expect(controller.submitActiveTaskMessage('Next Monday')).resolves.toBeUndefined()
		await expect(answer).resolves.toBe('Next Monday')
		expect(state.userQuestionRequest).toBeNull()
		expect(agent.pushObservation).not.toHaveBeenCalled()
		expect(agent.onUserTakeover).toBeDefined()
	})

	it('cancels a pending clarification when the user stops the task', async () => {
		const agent = new FakeAgent()
		agent.status = 'running'
		const { controller, state } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true, enableUserQuestions: true })
		const answer = agent.onAskUser!('Please provide the missing value.')

		controller.stop()

		await expect(answer).rejects.toMatchObject({ name: 'AbortError' })
		expect(agent.stop).toHaveBeenCalledTimes(1)
		expect(state.userQuestionRequest).toBeNull()
	})

	it('submits waiting takeover input to the active task without replacing its memory', async () => {
		const event = { type: 'observation', content: 'Waiting history' } as HistoricalEvent
		const agent = new FakeAgent()
		agent.status = 'waiting_for_user'
		agent.task = 'Waiting task'
		agent.history = [event]
		const { controller, state } = createSessionHarness()
		controller.bind(agent, { enableUserTakeover: true })
		const resolution = agent.onUserTakeover!(TAKEOVER_REQUEST)

		await expect(controller.submitActiveTaskMessage('验证码已经处理好了')).resolves.toBeUndefined()

		await expect(resolution).resolves.toBe('completed')
		expect(agent.pushObservation).toHaveBeenCalledWith(
			expect.stringContaining('验证码已经处理好了'),
		)
		expect(agent.stop).not.toHaveBeenCalled()
		expect(agent.dispose).not.toHaveBeenCalled()
		expect(state.currentTask).toBe('Waiting task')
		expect(state.history).toEqual([event])
	})

	it('leaves interactive user capabilities unset for Hub mode', () => {
		const agent = new FakeAgent()
		agent.onAskUser = vi.fn(async () => 'answer')
		agent.onUserTakeover = vi.fn(async () => 'completed' as const)
		const { controller, state } = createSessionHarness()

		controller.bind(agent, { enableUserTakeover: false, enableUserQuestions: false })

		expect(agent.onAskUser).toBeUndefined()
		expect(agent.onUserTakeover).toBeUndefined()
		expect(state.takeoverRequest).toBeNull()
		expect(state.userQuestionRequest).toBeNull()
	})
})
