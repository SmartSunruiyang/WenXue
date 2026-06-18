import { type AgentConfig, PageAgentCore } from '@page-agent/core'

import { RemotePageController } from './RemotePageController'
import { TabsController } from './TabsController'
import SYSTEM_PROMPT from './system_prompt.md?raw'
import { createTabTools } from './tabTools'

/** Detect user language from browser settings */
function detectLanguage(): 'en-US' | 'zh-CN' {
	const lang = navigator.language || navigator.languages?.[0] || 'en-US'
	return lang.startsWith('zh') ? 'zh-CN' : 'en-US'
}

interface MultiPageAgentConfig extends AgentConfig {
	includeInitialTab?: boolean
	experimentalIncludeAllTabs?: boolean
}

export function createAgentRuntimeLifecycle({
	setStorage,
	setInterval,
	clearInterval,
	now,
	onHeartbeatError = console.error,
}: {
	setStorage: (values: Record<string, unknown>) => Promise<void>
	setInterval: (callback: () => void, delay: number) => number
	clearInterval: (intervalId: number) => void
	now: () => number
	onHeartbeatError?: (error: unknown) => void
}) {
	let heartBeatInterval: number | null = null
	let running = false

	return {
		async start(): Promise<void> {
			if (running) return
			running = true
			heartBeatInterval = setInterval(() => {
				setStorage({ agentHeartbeat: now() }).catch(onHeartbeatError)
			}, 1_000)

			try {
				await setStorage({ isAgentRunning: true })
			} catch (error) {
				clearInterval(heartBeatInterval)
				heartBeatInterval = null
				running = false
				throw error
			}
		},

		async stop(): Promise<void> {
			if (!running) return
			running = false
			if (heartBeatInterval !== null) {
				clearInterval(heartBeatInterval)
				heartBeatInterval = null
			}
			await setStorage({ isAgentRunning: false })
		},
	}
}

/**
 * MultiPageAgent
 * - use with extension
 * - can be used from a side panel or a content script
 */
export class MultiPageAgent extends PageAgentCore {
	constructor(config: MultiPageAgentConfig) {
		// multi page controller
		const tabsController = new TabsController()
		const pageController = new RemotePageController(tabsController)
		const customTools = createTabTools(tabsController)

		// system prompt - auto-detect language if not specified
		const language = config.language ?? detectLanguage()
		const targetLanguage = language === 'zh-CN' ? '中文' : 'English'
		const systemPrompt = SYSTEM_PROMPT.replace(
			/Default working language: \*\*.*?\*\*/,
			`Default working language: **${targetLanguage}**`,
		)

		const includeInitialTab = config.includeInitialTab ?? true
		const experimentalIncludeAllTabs = config.experimentalIncludeAllTabs ?? false

		const runtime = createAgentRuntimeLifecycle({
			setStorage: (values) => chrome.storage.local.set(values),
			setInterval: (callback, delay) => window.setInterval(callback, delay),
			clearInterval: (intervalId) => window.clearInterval(intervalId),
			now: () => Date.now(),
			onHeartbeatError: (error) => console.error('[MultiPageAgent] Heartbeat failed', error),
		})

		super({
			...config,
			pageController: pageController as any,
			customTools: customTools,
			customSystemPrompt: systemPrompt,

			onBeforeTask: async (agent) => {
				await tabsController.init(agent.task, { includeInitialTab, experimentalIncludeAllTabs })
				await runtime.start()
			},

			onAfterTask: async () => {
				await runtime.stop()
			},

			onBeforeStep: async (agent) => {
				await runtime.start()
				if (!tabsController.currentTabId) return
				// make sure the current tab is loaded before the step starts
				await tabsController.waitUntilTabLoaded(tabsController.currentTabId!)
			},

			onDispose: () => {
				runtime.stop().catch((error) => {
					console.error('[MultiPageAgent] Runtime cleanup failed', error)
				})

				tabsController.dispose()
			},
		})
	}
}
