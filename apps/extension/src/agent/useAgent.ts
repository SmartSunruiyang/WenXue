/**
 * React hook for using AgentController
 */
import type {
	AgentActivity,
	AgentStatus,
	CompactionConfig,
	ExecutionResult,
	HistoricalEvent,
	SupportedLanguage,
	UserTakeoverRequest,
	UserTakeoverResolution,
} from '@page-agent/core'
import type { LLMConfig } from '@page-agent/llms'
import { useCallback, useEffect, useRef, useState } from 'react'

import { loadStoredConfig, saveStoredConfig } from '@/lib/configStorage'
import type { UILanguage } from '@/lib/i18n'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_VISION_MODEL_ID,
	type CustomModelConfig,
	normalizeVisionModelId,
	resolveSelectedLLMConfig,
	resolveVisionLLMConfig,
} from '@/lib/modelConfig'
import { loadRuntimeAgentModels, type RuntimeAgentModels } from '@/lib/runtimeModelConfig'
import { WENXUE_USER_SESSION_KEY } from '@/lib/userSession'
import { MultiPageAgent } from './MultiPageAgent'
import { ensureVisualObserveBackgroundReady } from './visualObserve'

/** Language preference: undefined means follow system */
export type LanguagePreference = SupportedLanguage | undefined

export interface AdvancedConfig {
	systemInstruction?: string
	experimentalLlmsTxt?: boolean
	experimentalIncludeAllTabs?: boolean
	compaction?: ExtensionCompactionConfig
	logRetentionDays?: number
	logMaxEntries?: number
}

export type ExtensionCompactionConfig = CompactionConfig

export interface ExtConfig extends LLMConfig, AdvancedConfig {
	language?: LanguagePreference
	uiLanguage?: UILanguage
	selectedModelId?: string
	customModels?: CustomModelConfig[]
	/** 系统级「视觉/多模态」模型 id；未设置 → 解析时回退到视觉内置模型(qwen3.7-plus)。 */
	visionModelId?: string
}

export interface UseAgentResult {
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	currentTask: string
	takeoverRequest: UserTakeoverRequest | null
	config: ExtConfig | null
	execute: (task: string) => Promise<ExecutionResult>
	followUp: (task: string) => Promise<ExecutionResult>
	submitActiveTaskMessage: (message: string) => Promise<ExecutionResult | void>
	stop: () => void
	completeUserTakeover: () => void
	pauseUserTakeover: () => void
	resume: () => Promise<ExecutionResult>
	resetConversation: () => boolean
	restoreConversation: (session: RestorableAgentConversation) => boolean
	configure: (config: ExtConfig) => Promise<void>
}

export interface AgentConversationState {
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	currentTask: string
}

export type AgentConversationContent = Pick<
	AgentConversationState,
	'history' | 'activity' | 'currentTask'
>

export interface RestorableAgentConversation {
	task: string
	history: HistoricalEvent[]
	status: Extract<AgentStatus, 'completed' | 'error'>
}

export interface UseAgentOptions {
	enableUserTakeover?: boolean
}

const AGENT_SESSION_RELOAD_STORAGE_KEYS = new Set([
	WENXUE_USER_SESSION_KEY,
	'llmConfig',
	'language',
	'advancedConfig',
	'uiLanguage',
	'selectedModelId',
	'customModels',
	'visionModelId',
])

export interface AgentSessionAgent {
	status: AgentStatus
	task: string
	history: HistoricalEvent[]
	onUserTakeover?: (
		request: UserTakeoverRequest,
		options?: { signal: AbortSignal },
	) => Promise<UserTakeoverResolution>
	execute: (task: string) => Promise<ExecutionResult>
	followUp: (task: string) => Promise<ExecutionResult>
	restoreConversation: (session: RestorableAgentConversation) => void
	resume: () => Promise<ExecutionResult>
	stop: () => void
	pushObservation: (content: string) => void
	dispose: () => void
	addEventListener: EventTarget['addEventListener']
	removeEventListener: EventTarget['removeEventListener']
}

export interface AgentSessionStateSinks {
	setStatus: (status: AgentStatus) => void
	setHistory: (history: HistoricalEvent[]) => void
	setActivity: (activity: AgentActivity | null) => void
	setCurrentTask: (task: string) => void
	setTakeoverRequest: (request: UserTakeoverRequest | null) => void
}

interface PendingTakeoverRequest {
	signal?: AbortSignal
	abortListener?: () => void
	resolve: (resolution: UserTakeoverResolution) => void
	reject: (reason: unknown) => void
}

export interface TakeoverRequestController {
	request: (
		request: UserTakeoverRequest,
		options?: { signal?: AbortSignal },
	) => Promise<UserTakeoverResolution>
	resolve: (resolution: UserTakeoverResolution) => void
	cancel: (reason?: unknown) => void
	dispose: () => void
}

function createTakeoverAbortError(message: string): DOMException {
	return new DOMException(message, 'AbortError')
}

export function createTakeoverRequestController(
	onRequestChange: (request: UserTakeoverRequest | null) => void,
): TakeoverRequestController {
	let pending: PendingTakeoverRequest | null = null

	const clearPending = (entry: PendingTakeoverRequest): boolean => {
		if (pending !== entry) return false

		pending = null
		if (entry.signal && entry.abortListener) {
			entry.signal.removeEventListener('abort', entry.abortListener)
		}
		onRequestChange(null)
		return true
	}

	const rejectEntry = (entry: PendingTakeoverRequest, reason: unknown) => {
		if (!clearPending(entry)) return
		entry.reject(reason)
	}

	const cancel = (reason: unknown = createTakeoverAbortError('User takeover was cancelled.')) => {
		if (!pending) return
		rejectEntry(pending, reason)
	}

	const request: TakeoverRequestController['request'] = (nextRequest, options) => {
		cancel(createTakeoverAbortError('User takeover was superseded by a newer request.'))

		const signal = options?.signal
		if (signal?.aborted) {
			const rejected = Promise.reject<UserTakeoverResolution>(
				signal.reason ?? createTakeoverAbortError('User takeover was aborted.'),
			)
			rejected.catch(() => undefined)
			return rejected
		}

		const promise = new Promise<UserTakeoverResolution>((resolve, reject) => {
			const entry: PendingTakeoverRequest = { signal, resolve, reject }
			entry.abortListener = () => {
				rejectEntry(entry, signal?.reason ?? createTakeoverAbortError('User takeover was aborted.'))
			}

			pending = entry
			onRequestChange(nextRequest)
			signal?.addEventListener('abort', entry.abortListener, { once: true })
			if (signal?.aborted) entry.abortListener()
		})
		promise.catch(() => undefined)
		return promise
	}

	return {
		request,
		resolve(resolution) {
			const entry = pending
			if (!entry || !clearPending(entry)) return
			entry.resolve(resolution)
		},
		cancel,
		dispose() {
			cancel(createTakeoverAbortError('User takeover controller was disposed.'))
		},
	}
}

export function isAgentTaskActive(status: AgentStatus): boolean {
	return status === 'running' || status === 'waiting_for_user' || status === 'paused'
}

export interface AgentSessionController {
	bind: (agent: AgentSessionAgent, options: UseAgentOptions) => void
	unbind: (agent: AgentSessionAgent) => void
	dispose: () => void
	execute: (task: string) => Promise<ExecutionResult>
	followUp: (task: string) => Promise<ExecutionResult>
	submitActiveTaskMessage: (message: string) => Promise<ExecutionResult | void>
	restoreConversation: (session: RestorableAgentConversation) => boolean
	stop: () => void
	resume: () => Promise<ExecutionResult>
	completeUserTakeover: () => void
	pauseUserTakeover: () => void
	cancelUserTakeover: () => void
	resetActiveConversation: (replacement: AgentSessionAgent, options: UseAgentOptions) => boolean
	isTaskActive: () => boolean
	configure: <T>(
		nextConfig: T,
		save: (config: T) => Promise<T>,
		apply: (config: T) => void | Promise<void>,
	) => Promise<void>
}

interface AgentSessionBinding {
	agent: AgentSessionAgent
	takeoverController: TakeoverRequestController | null
	handleStatusChange: () => void
	handleHistoryChange: () => void
	handleActivity: (event: Event) => void
}

function assertAgentInactive(agent: AgentSessionAgent): void {
	if (isAgentTaskActive(agent.status)) throw new Error('Agent task is active.')
}

function createActiveTaskUserObservation(message: string): string {
	return `User sent this message while the task was waiting for manual takeover: ${message}`
}

export function createAgentSessionController(
	sinks: AgentSessionStateSinks,
): AgentSessionController {
	let binding: AgentSessionBinding | null = null
	let configuring = false

	const getAgent = (): AgentSessionAgent => {
		if (!binding) throw new Error('Agent not initialized')
		return binding.agent
	}

	const bindAgent = (agent: AgentSessionAgent, options: UseAgentOptions) => {
		if (binding?.agent === agent) return
		release()

		const takeoverController = options.enableUserTakeover
			? createTakeoverRequestController(sinks.setTakeoverRequest)
			: null
		agent.onUserTakeover = takeoverController?.request

		const handleStatusChange = () => {
			sinks.setStatus(agent.status)
			if (
				agent.status === 'idle' ||
				agent.status === 'paused' ||
				agent.status === 'completed' ||
				agent.status === 'error'
			) {
				sinks.setActivity(null)
			}
		}
		const handleHistoryChange = () => {
			sinks.setHistory([...agent.history])
		}
		const handleActivity = (event: Event) => {
			sinks.setActivity((event as CustomEvent<AgentActivity>).detail)
		}

		binding = {
			agent,
			takeoverController,
			handleStatusChange,
			handleHistoryChange,
			handleActivity,
		}
		agent.addEventListener('statuschange', handleStatusChange)
		agent.addEventListener('historychange', handleHistoryChange)
		agent.addEventListener('activity', handleActivity)

		sinks.setStatus(agent.status)
		sinks.setHistory([...agent.history])
		sinks.setActivity(null)
		sinks.setCurrentTask(agent.task)
		sinks.setTakeoverRequest(null)
	}

	const release = (expectedAgent?: AgentSessionAgent) => {
		const current = binding
		if (!current || (expectedAgent && current.agent !== expectedAgent)) return

		binding = null
		current.agent.removeEventListener('statuschange', current.handleStatusChange)
		current.agent.removeEventListener('historychange', current.handleHistoryChange)
		current.agent.removeEventListener('activity', current.handleActivity)
		current.agent.onUserTakeover = undefined
		current.takeoverController?.dispose()
		current.agent.dispose()
	}

	return {
		bind(agent, options) {
			bindAgent(agent, options)
		},
		unbind: release,
		dispose() {
			release()
		},
		async execute(task) {
			if (configuring) throw new Error('Agent is being configured.')
			const agent = getAgent()
			assertAgentInactive(agent)

			binding?.takeoverController?.cancel(
				createTakeoverAbortError('User takeover was cancelled by a new task.'),
			)
			sinks.setTakeoverRequest(null)
			sinks.setCurrentTask(task)
			sinks.setHistory([])
			sinks.setActivity(null)
			return agent.execute(task)
		},
		async followUp(task) {
			if (configuring) throw new Error('Agent is being configured.')
			const agent = getAgent()
			assertAgentInactive(agent)

			sinks.setCurrentTask(task)
			sinks.setActivity(null)
			return agent.followUp(task)
		},
		async submitActiveTaskMessage(message) {
			if (configuring) throw new Error('Agent is being configured.')
			const agent = getAgent()
			if (agent.status !== 'waiting_for_user' && agent.status !== 'paused') {
				throw new Error('No active user-waiting task.')
			}

			agent.pushObservation(createActiveTaskUserObservation(message))
			if (agent.status === 'waiting_for_user') {
				binding?.takeoverController?.resolve('completed')
				return
			}

			return agent.resume()
		},
		restoreConversation(session) {
			if (!binding || isAgentTaskActive(binding.agent.status)) return false

			binding.takeoverController?.cancel()
			sinks.setTakeoverRequest(null)
			binding.agent.restoreConversation(session)
			const nextState = createRestoredAgentConversationState(session)
			sinks.setStatus(nextState.status)
			sinks.setHistory(nextState.history)
			sinks.setActivity(nextState.activity)
			sinks.setCurrentTask(nextState.currentTask)
			return true
		},
		stop() {
			binding?.agent.stop()
		},
		resume() {
			return getAgent().resume()
		},
		completeUserTakeover() {
			binding?.takeoverController?.resolve('completed')
		},
		pauseUserTakeover() {
			binding?.takeoverController?.resolve('paused')
		},
		cancelUserTakeover() {
			binding?.takeoverController?.cancel()
			sinks.setTakeoverRequest(null)
		},
		resetActiveConversation(replacement, options) {
			const current = binding
			if (!current || !isAgentTaskActive(current.agent.status)) return false

			current.agent.stop()
			release(current.agent)
			bindAgent(replacement, options)
			return true
		},
		isTaskActive() {
			return binding ? isAgentTaskActive(binding.agent.status) : false
		},
		async configure(nextConfig, save, apply) {
			if (configuring) throw new Error('Agent is being configured.')
			if (binding) assertAgentInactive(binding.agent)
			configuring = true
			try {
				await apply(await save(nextConfig))
			} finally {
				configuring = false
			}
		},
	}
}

export function hasAgentConversationContent({
	currentTask,
	history,
	activity,
}: AgentConversationContent): boolean {
	return Boolean(currentTask || history.length > 0 || activity)
}

export function createClearedAgentConversationState(): AgentConversationState {
	return {
		status: 'idle',
		history: [],
		activity: null,
		currentTask: '',
	}
}

export function createRestoredAgentConversationState({
	task,
	history,
	status,
}: RestorableAgentConversation): AgentConversationState {
	return {
		status,
		history: [...history],
		activity: null,
		currentTask: task,
	}
}

export function createAgentForConfig(
	config: ExtConfig,
	runtimeModels?: RuntimeAgentModels,
): MultiPageAgent {
	const customModels = config.customModels ?? []
	// 系统级文本 + 视觉模型；学习通流水线跟随这两个系统模型。
	const chaoxingModels = runtimeModels?.chaoxingModels ?? {
		text: resolveSelectedLLMConfig(config.selectedModelId, customModels),
		vision: resolveVisionLLMConfig(config.visionModelId, customModels),
	}
	const resolvedVisualObservationModel = runtimeModels?.vision ?? chaoxingModels.vision
	const resolvedVisionModelId = normalizeVisionModelId(config.visionModelId, customModels)
	const visualObservationModel = {
		...resolvedVisualObservationModel,
		requiresApiKey:
			resolvedVisionModelId === BUILT_IN_MODEL_ID ||
			resolvedVisionModelId === BUILT_IN_VISION_MODEL_ID,
	}
	const activeModel = runtimeModels?.active ?? config

	return new MultiPageAgent({
		baseURL: activeModel.baseURL,
		model: activeModel.model,
		apiKey: activeModel.apiKey,
		language: config.language,
		experimentalLlmsTxt: config.experimentalLlmsTxt,
		experimentalIncludeAllTabs: config.experimentalIncludeAllTabs,
		disableNamedToolChoice: activeModel.disableNamedToolChoice,
		getNamedToolChoiceDisabled: activeModel.getNamedToolChoiceDisabled,
		onNamedToolChoiceUnsupported: activeModel.onNamedToolChoiceUnsupported,
		compaction: config.compaction,
		chaoxingModels,
		visualObservationModel,
		instructions: config.systemInstruction ? { system: config.systemInstruction } : undefined,
	})
}

export async function initializeAgentSession<TConfig>({
	signal,
	loadConfig,
	createAgent,
	bindAgent,
	setConfig,
}: {
	signal: AbortSignal
	loadConfig: () => Promise<TConfig>
	createAgent: (config: TConfig) => AgentSessionAgent | Promise<AgentSessionAgent>
	bindAgent: (agent: AgentSessionAgent) => void
	setConfig: (config: TConfig) => void
}): Promise<void> {
	const loadedConfig = await loadConfig()
	if (signal.aborted) return

	const agent = await createAgent(loadedConfig)
	if (signal.aborted) {
		agent.dispose()
		return
	}

	bindAgent(agent)
	setConfig(loadedConfig)
}

export function useAgent({ enableUserTakeover = false }: UseAgentOptions = {}): UseAgentResult {
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentTask, setCurrentTask] = useState('')
	const [takeoverRequest, setTakeoverRequest] = useState<UserTakeoverRequest | null>(null)
	const [config, setConfig] = useState<ExtConfig | null>(null)
	const sessionControllerRef = useRef<AgentSessionController | null>(null)
	const runtimeModelsRef = useRef<RuntimeAgentModels | null>(null)
	const mountedRef = useRef(false)
	const initialLoadAbortRef = useRef<AbortController | null>(null)
	if (!sessionControllerRef.current) {
		sessionControllerRef.current = createAgentSessionController({
			setStatus,
			setHistory,
			setActivity,
			setCurrentTask,
			setTakeoverRequest,
		})
	}
	const sessionController = sessionControllerRef.current

	const clearVisibleConversation = useCallback(() => {
		const nextState = createClearedAgentConversationState()
		setStatus(nextState.status)
		setHistory(nextState.history)
		setActivity(nextState.activity)
		setCurrentTask(nextState.currentTask)
		setTakeoverRequest(null)
	}, [])

	const reloadAgentSession = useCallback(
		async ({ clearExisting = false }: { clearExisting?: boolean } = {}) => {
			if (sessionController.isTaskActive()) {
				return
			}
			initialLoadAbortRef.current?.abort()
			const abortController = new AbortController()
			initialLoadAbortRef.current = abortController

			if (clearExisting) {
				sessionController.dispose()
				clearVisibleConversation()
			}

			try {
				try {
					const backgroundState = await ensureVisualObserveBackgroundReady()
					if (backgroundState === 'reloading' || abortController.signal.aborted) return
				} catch (error) {
					if (abortController.signal.aborted) return
					console.error('[useAgent] Visual observation background is unavailable:', error)
				}
				await initializeAgentSession({
					signal: abortController.signal,
					loadConfig: () => loadStoredConfig(),
					createAgent: async (loadedConfig) => {
						const runtimeModels = await loadRuntimeAgentModels(loadedConfig)
						runtimeModelsRef.current = runtimeModels
						return createAgentForConfig(loadedConfig, runtimeModels)
					},
					bindAgent: (agent) => sessionController.bind(agent, { enableUserTakeover }),
					setConfig,
				})
			} catch (error) {
				if (!abortController.signal.aborted) {
					console.error('[useAgent] Failed to initialize agent:', error)
				}
			} finally {
				if (initialLoadAbortRef.current === abortController) {
					initialLoadAbortRef.current = null
				}
			}
		},
		[clearVisibleConversation, enableUserTakeover, sessionController],
	)

	useEffect(() => {
		mountedRef.current = true
		void reloadAgentSession()

		const handleStorageChange = (
			changes: Record<string, chrome.storage.StorageChange>,
			areaName: string,
		) => {
			if (
				areaName !== 'local' ||
				!Object.keys(changes).some((key) => AGENT_SESSION_RELOAD_STORAGE_KEYS.has(key))
			) {
				return
			}
			void reloadAgentSession({
				clearExisting: WENXUE_USER_SESSION_KEY in changes,
			})
		}
		chrome.storage.onChanged.addListener(handleStorageChange)

		return () => {
			mountedRef.current = false
			initialLoadAbortRef.current?.abort()
			initialLoadAbortRef.current = null
			chrome.storage.onChanged.removeListener(handleStorageChange)
			sessionController.dispose()
		}
	}, [reloadAgentSession, sessionController])

	const execute = useCallback(
		(task: string) => sessionController.execute(task),
		[sessionController],
	)
	const followUp = useCallback(
		(task: string) => sessionController.followUp(task),
		[sessionController],
	)
	const submitActiveTaskMessage = useCallback(
		(message: string) => sessionController.submitActiveTaskMessage(message),
		[sessionController],
	)
	const stop = useCallback(() => sessionController.stop(), [sessionController])
	const completeUserTakeover = useCallback(
		() => sessionController.completeUserTakeover(),
		[sessionController],
	)
	const pauseUserTakeover = useCallback(
		() => sessionController.pauseUserTakeover(),
		[sessionController],
	)
	const resume = useCallback(() => sessionController.resume(), [sessionController])

	const resetConversation = useCallback(() => {
		if (sessionController.isTaskActive()) {
			if (!config) return false
			return sessionController.resetActiveConversation(
				createAgentForConfig(config, runtimeModelsRef.current ?? undefined),
				{
					enableUserTakeover,
				},
			)
		}

		sessionController.cancelUserTakeover()
		const nextState = createClearedAgentConversationState()
		setStatus(nextState.status)
		setHistory(nextState.history)
		setActivity(nextState.activity)
		setCurrentTask(nextState.currentTask)
		return true
	}, [config, enableUserTakeover, sessionController])

	const restoreConversation = useCallback(
		(session: RestorableAgentConversation) => {
			return sessionController.restoreConversation(session)
		},
		[sessionController],
	)

	const configure = useCallback(
		async (nextConfig: ExtConfig) => {
			initialLoadAbortRef.current?.abort()
			initialLoadAbortRef.current = null
			await sessionController.configure(
				nextConfig,
				(value) => saveStoredConfig(chrome.storage.local, value),
				async (savedConfig) => {
					if (!mountedRef.current) {
						throw createTakeoverAbortError('Agent session has been disposed.')
					}

					const runtimeModels = await loadRuntimeAgentModels(savedConfig)
					runtimeModelsRef.current = runtimeModels
					const replacement = createAgentForConfig(savedConfig, runtimeModels)
					if (!mountedRef.current) {
						replacement.dispose()
						throw createTakeoverAbortError('Agent session has been disposed.')
					}

					sessionController.bind(replacement, { enableUserTakeover })
					setConfig(savedConfig)
				},
			)
		},
		[enableUserTakeover, sessionController],
	)

	return {
		status,
		history,
		activity,
		currentTask,
		takeoverRequest,
		config,
		execute,
		followUp,
		submitActiveTaskMessage,
		stop,
		completeUserTakeover,
		pauseUserTakeover,
		resume,
		resetConversation,
		restoreConversation,
		configure,
	}
}
