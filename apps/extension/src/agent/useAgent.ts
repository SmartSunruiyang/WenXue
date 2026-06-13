/**
 * React hook for using AgentController
 */
import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
	SupportedLanguage,
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
	maxSteps?: number
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
	config: ExtConfig | null
	execute: (task: string) => Promise<ExecutionResult>
	stop: () => void
	resetConversation: () => boolean
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

export function useAgent(): UseAgentResult {
	const agentRef = useRef<MultiPageAgent | null>(null)
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentTask, setCurrentTask] = useState('')
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
			maxSteps: config.maxSteps,
			experimentalLlmsTxt: config.experimentalLlmsTxt,
			experimentalIncludeAllTabs: config.experimentalIncludeAllTabs,
			disableNamedToolChoice: config.disableNamedToolChoice,
		}
		const agent = new MultiPageAgent({
			...agentConfig,
			instructions: config.systemInstruction ? { system: config.systemInstruction } : undefined,
		})
		agentRef.current = agent

		const handleStatusChange = (e: Event) => {
			const newStatus = agent.status as AgentStatus
			setStatus(newStatus)
			if (newStatus === 'idle' || newStatus === 'completed' || newStatus === 'error') {
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
			agent.dispose()
		}
	}, [config])

	const execute = useCallback(async (task: string) => {
		const agent = agentRef.current
		if (!agent) throw new Error('Agent not initialized')

		setCurrentTask(task)
		setHistory([])
		return agent.execute(task)
	}, [])

	const stop = useCallback(() => {
		agentRef.current?.stop()
	}, [])

	const resetConversation = useCallback(() => {
		if (agentRef.current?.status === 'running') return false

		const nextState = createClearedAgentConversationState()
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
		config,
		execute,
		stop,
		resetConversation,
		configure,
	}
}
