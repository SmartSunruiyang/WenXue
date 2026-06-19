/**
 * React hook for using AgentController
 */
import type {
	AgentActivity,
	AgentStatus,
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
import type { CustomModelConfig } from '@/lib/modelConfig'
import { MultiPageAgent } from './MultiPageAgent'

/** Language preference: undefined means follow system */
export type LanguagePreference = SupportedLanguage | undefined

export interface AdvancedConfig {
	systemInstruction?: string
	experimentalLlmsTxt?: boolean
	experimentalIncludeAllTabs?: boolean
	disableNamedToolChoice?: boolean
}

export interface ExtConfig extends LLMConfig, AdvancedConfig {
	language?: LanguagePreference
	uiLanguage?: UILanguage
	selectedModelId?: string
	customModels?: CustomModelConfig[]
}

export interface UseAgentResult {
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	currentTask: string
	takeoverRequest: UserTakeoverRequest | null
	config: ExtConfig | null
	execute: (task: string) => Promise<ExecutionResult>
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

export function useAgent(): UseAgentResult {
	const agentRef = useRef<MultiPageAgent | null>(null)
	const takeoverControllerRef = useRef<TakeoverRequestController | null>(null)
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentTask, setCurrentTask] = useState('')
	const [takeoverRequest, setTakeoverRequest] = useState<UserTakeoverRequest | null>(null)
	const [config, setConfig] = useState<ExtConfig | null>(null)

	useEffect(() => {
		loadStoredConfig().then(setConfig)
	}, [])

	useEffect(() => {
		if (!config) return

		const agentConfig = {
			baseURL: config.baseURL,
			model: config.model,
			apiKey: config.apiKey,
			language: config.language,
			experimentalLlmsTxt: config.experimentalLlmsTxt,
			experimentalIncludeAllTabs: config.experimentalIncludeAllTabs,
			disableNamedToolChoice: config.disableNamedToolChoice,
		}
		const agent = new MultiPageAgent({
			...agentConfig,
			instructions: config.systemInstruction ? { system: config.systemInstruction } : undefined,
		})
		const takeoverController = createTakeoverRequestController(setTakeoverRequest)
		agent.onUserTakeover = takeoverController.request
		agentRef.current = agent
		takeoverControllerRef.current = takeoverController

		const handleStatusChange = (e: Event) => {
			const newStatus = agent.status as AgentStatus
			setStatus(newStatus)
			if (
				newStatus === 'idle' ||
				newStatus === 'paused' ||
				newStatus === 'completed' ||
				newStatus === 'error'
			) {
				setActivity(null)
			}
		}

		const handleHistoryChange = (e: Event) => {
			setHistory([...agent.history])
		}

		const handleActivity = (e: Event) => {
			const newActivity = (e as CustomEvent).detail as AgentActivity
			setActivity(newActivity)
		}

		agent.addEventListener('statuschange', handleStatusChange)
		agent.addEventListener('historychange', handleHistoryChange)
		agent.addEventListener('activity', handleActivity)

		return () => {
			agent.removeEventListener('statuschange', handleStatusChange)
			agent.removeEventListener('historychange', handleHistoryChange)
			agent.removeEventListener('activity', handleActivity)
			if (agentRef.current === agent) agentRef.current = null
			if (takeoverControllerRef.current === takeoverController) {
				takeoverControllerRef.current = null
			}
			agent.onUserTakeover = undefined
			takeoverController.dispose()
			agent.dispose()
		}
	}, [config])

	const execute = useCallback(async (task: string) => {
		const agent = agentRef.current
		if (!agent) throw new Error('Agent not initialized')

		takeoverControllerRef.current?.cancel(
			createTakeoverAbortError('User takeover was cancelled by a new task.'),
		)
		setTakeoverRequest(null)
		setCurrentTask(task)
		setHistory([])
		setActivity(null)
		return agent.execute(task)
	}, [])

	const stop = useCallback(() => {
		agentRef.current?.stop()
	}, [])

	const resolveTakeover = useCallback((resolution: UserTakeoverResolution) => {
		takeoverControllerRef.current?.resolve(resolution)
	}, [])

	const completeUserTakeover = useCallback(() => resolveTakeover('completed'), [resolveTakeover])
	const pauseUserTakeover = useCallback(() => resolveTakeover('paused'), [resolveTakeover])

	const resume = useCallback(async () => {
		const agent = agentRef.current
		if (!agent) throw new Error('Agent not initialized')
		return agent.resume()
	}, [])

	const resetConversation = useCallback(() => {
		if (agentRef.current && isAgentTaskActive(agentRef.current.status as AgentStatus)) return false

		takeoverControllerRef.current?.cancel()
		setTakeoverRequest(null)
		const nextState = createClearedAgentConversationState()
		setStatus(nextState.status)
		setHistory(nextState.history)
		setActivity(nextState.activity)
		setCurrentTask(nextState.currentTask)
		return true
	}, [])

	const restoreConversation = useCallback((session: RestorableAgentConversation) => {
		if (agentRef.current && isAgentTaskActive(agentRef.current.status as AgentStatus)) return false

		takeoverControllerRef.current?.cancel()
		setTakeoverRequest(null)
		const nextState = createRestoredAgentConversationState(session)
		setStatus(nextState.status)
		setHistory(nextState.history)
		setActivity(nextState.activity)
		setCurrentTask(nextState.currentTask)
		return true
	}, [])

	const configure = useCallback(async (nextConfig: ExtConfig) => {
		setConfig(await saveStoredConfig(chrome.storage.local, nextConfig))
	}, [])

	return {
		status,
		history,
		activity,
		currentTask,
		takeoverRequest,
		config,
		execute,
		stop,
		completeUserTakeover,
		pauseUserTakeover,
		resume,
		resetConversation,
		restoreConversation,
		configure,
	}
}
