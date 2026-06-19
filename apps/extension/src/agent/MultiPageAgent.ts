import { type AgentConfig, type AgentStepEvent, PageAgentCore } from '@page-agent/core'
import type { LLMConfig } from '@page-agent/llms'

import { createActionSignature, StuckActionGuard } from './actionSignature'
import { createChaoxingTools } from './chaoxing/tools'
import { RemotePageController } from './RemotePageController'
import SYSTEM_PROMPT from './system_prompt.md?raw'
import { TabsController } from './TabsController'
import { createTabTools } from './tabTools'

/** Detect user language from browser settings */
function detectLanguage(): 'en-US' | 'zh-CN' {
	const lang = navigator.language || navigator.languages?.[0] || 'en-US'
	return lang.startsWith('zh') ? 'zh-CN' : 'en-US'
}

interface MultiPageAgentConfig extends AgentConfig {
	includeInitialTab?: boolean
	experimentalIncludeAllTabs?: boolean
	/**
	 * 系统级文本 + 视觉模型；学习通流水线据此路由(text 用于纯文本题，vision 用于含图题)。
	 * 不传则回退到 agent 自身的模型作为 text、vision 留空(含图题进入人工)。
	 */
	chaoxingModels?: { text: LLMConfig; vision: LLMConfig }
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

		// Chaoxing (超星学习通) solve tool. Prefer the system-level text + vision
		// models; fall back to the agent's own LLM config as the text model
		// with vision undefined (image questions become needsReview) when unset.
		const fallbackTextModel = {
			baseURL: config.baseURL,
			model: config.model,
			apiKey: config.apiKey,
		}
		const chaoxingTools = createChaoxingTools({
			tabsController,
			getModels: () => config.chaoxingModels ?? { text: fallbackTextModel, vision: undefined },
		})
		const customTools = { ...createTabTools(tabsController), ...chaoxingTools }

		// system prompt - auto-detect language if not specified
		const language = config.language ?? detectLanguage()
		const targetLanguage = language === 'zh-CN' ? '中文' : 'English'
		const systemPrompt = SYSTEM_PROMPT.replace(
			/Default working language: \*\*.*?\*\*/,
			`Default working language: **${targetLanguage}**`,
		)

		const includeInitialTab = config.includeInitialTab ?? true
		const experimentalIncludeAllTabs = config.experimentalIncludeAllTabs ?? false
		const stuckGuard = new StuckActionGuard(3)
		const { onBeforeTask, onAfterTask, onBeforeStep, onAfterStep, onDispose } = config

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
				stuckGuard.reset()
				try {
					await tabsController.init(agent.task, {
						includeInitialTab,
						experimentalIncludeAllTabs,
					})
					await runtime.start()
					await onBeforeTask?.(agent)
				} catch (error) {
					await runtime.stop()
					throw error
				}
			},

			onAfterTask: async (agent, result) => {
				try {
					await runtime.stop()
				} finally {
					await onAfterTask?.(agent, result)
				}
			},

			onBeforeStep: async (agent, stepCount) => {
				await runtime.start()
				if (tabsController.currentTabId) {
					// make sure the current tab is loaded before the step starts
					await tabsController.waitUntilTabLoaded(tabsController.currentTabId)
				}
				await onBeforeStep?.(agent, stepCount)
			},

			onAfterStep: async (agent, history) => {
				let lastStep: AgentStepEvent | undefined
				for (let index = history.length - 1; index >= 0; index--) {
					const event = history[index]
					if (event.type === 'step') {
						lastStep = event
						break
					}
				}
				if (!lastStep) {
					await onAfterStep?.(agent, history)
					return
				}

				const signature = createActionSignature({
					url: agent.currentURL,
					action: lastStep.action,
				})
				const shouldRequestTakeover = stuckGuard.record(signature)

				await onAfterStep?.(agent, history)
				if (!shouldRequestTakeover) return

				stuckGuard.reset()
				if (agent.status !== 'running') return

				await agent.requestUserTakeover({
					reason: 'stuck',
					title: '模型可能遇到无法解决的问题',
					message: '它连续尝试了 3 次相同操作，可能需要你暂时接管页面。',
					goal: lastStep.reflection.next_goal,
					lastAction: lastStep.action,
				})
			},

			onDispose: (agent, reason) => {
				runtime.stop().catch((error) => {
					console.error('[MultiPageAgent] Runtime cleanup failed', error)
				})

				tabsController.dispose()
				onDispose?.(agent, reason)
			},
		})
	}
}
