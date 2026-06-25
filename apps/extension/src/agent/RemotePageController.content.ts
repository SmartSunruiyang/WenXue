/**
 * content script for RemotePageController
 */
import { PageController } from '@page-agent/page-controller'
import { injectScript } from 'wxt/utils/inject-script'

import { shouldShowAgentMask } from './RemotePageController'

type JsResult = { success: boolean; message: string }
type MainWorldRunner = (script: string, signal?: AbortSignal) => Promise<JsResult>

export async function dispatchJsExecution(
	pc: { executeJavascript: (script: string) => Promise<JsResult> },
	runInMainWorld: MainWorldRunner,
	payload: [string, { world?: 'isolated' | 'main' }] | undefined,
): Promise<JsResult> {
	const [script, opts] = payload ?? ['', {}]
	const world = opts?.world ?? 'isolated'

	if (world === 'main') {
		const controller = new AbortController()
		return withTimeout(runInMainWorld(script, controller.signal), 10_000, () => controller.abort())
	}

	return withTimeout(pc.executeJavascript(script), 10_000)
}

function withTimeout(p: Promise<JsResult>, ms: number, onTimeout?: () => void): Promise<JsResult> {
	let timer: ReturnType<typeof setTimeout>
	const timeout = new Promise<JsResult>((resolve) => {
		timer = setTimeout(
			() => {
				onTimeout?.()
				resolve({ success: false, message: `❌ 执行超时（${ms / 1000}s）` })
			},
			ms,
		)
	})
	return Promise.race([p.finally(() => clearTimeout(timer)), timeout])
}

export function initPageController() {
	let pageController: PageController | null = null
	let intervalID: number | null = null
	let mainWorldExecutorInjected = false
	let mainWorldExecutorInjection: Promise<void> | null = null
	let mainExecId = 0

	const myTabIdPromise = chrome.runtime
		.sendMessage({ type: 'PAGE_CONTROL', action: 'get_my_tab_id' })
		.then((response) => {
			return (response as { tabId: number | null }).tabId
		})
		.catch((error) => {
			console.error('[RemotePageController.ContentScript]: Failed to get my tab id', error)
			return null
		})

	function getPC(): PageController {
		if (!pageController) {
			pageController = new PageController({
				enableMask: false,
				viewportExpansion: 400,
			})
		}
		return pageController
	}

	async function ensureMainWorldExecutor(): Promise<void> {
		if (mainWorldExecutorInjected) return
		if (!mainWorldExecutorInjection) {
			mainWorldExecutorInjection = injectScript('/main-world-executor.js', { keepInDom: true }).then(
				() => {
					mainWorldExecutorInjected = true
				},
			)
		}

		try {
			await mainWorldExecutorInjection
		} catch (error) {
			mainWorldExecutorInjection = null
			throw error
		}
	}

	async function executeInMainWorld(script: string, signal?: AbortSignal): Promise<JsResult> {
		try {
			await ensureMainWorldExecutor()
		} catch (error) {
			return { success: false, message: `❌ 无法注入 main world executor: ${String(error)}` }
		}
		if (signal?.aborted) return { success: false, message: '❌ main world 执行已取消' }

		const id = ++mainExecId
		return new Promise((resolve) => {
			const cleanup = () => {
				window.removeEventListener('message', onMessage)
				signal?.removeEventListener('abort', onAbort)
			}
			const onAbort = () => {
				cleanup()
				resolve({ success: false, message: '❌ main world 执行已取消' })
			}
			const onMessage = (e: MessageEvent) => {
				if (e.source !== window) return
				const d = e.data
				if (typeof d !== 'object' || d === null) return
				if (d.channel !== 'PAGE_AGENT_EXEC_RESPONSE' || d.id !== id) return

				cleanup()
				resolve(
					d.ok
						? { success: true, message: `✅ Executed JavaScript (main world). Result: ${d.result}` }
						: {
								success: false,
								message: `❌ main world 执行失败（可能被页面 CSP 阻止）: ${d.error}`,
							},
				)
			}

			window.addEventListener('message', onMessage)
			signal?.addEventListener('abort', onAbort, { once: true })
			window.postMessage({ channel: 'PAGE_AGENT_EXEC_REQUEST', id, script }, '*')
		})
	}

	intervalID = window.setInterval(async () => {
		const {
			agentHeartbeat,
			isAgentRunning,
			currentTabId,
			isAgentInteractionPaused = false,
		} = await chrome.storage.local.get([
			'agentHeartbeat',
			'isAgentRunning',
			'currentTabId',
			'isAgentInteractionPaused',
		])
		const now = Date.now()
		const agentInTouch = typeof agentHeartbeat === 'number' && now - agentHeartbeat < 2_000
		const shouldShowMask = shouldShowAgentMask({
			isAgentRunning: Boolean(isAgentRunning),
			agentInTouch,
			currentTabId: typeof currentTabId === 'number' ? currentTabId : null,
			myTabId: await myTabIdPromise,
			isAgentInteractionPaused: Boolean(isAgentInteractionPaused),
		})

		if (shouldShowMask) {
			const pc = getPC()
			pc.initMask()
			await pc.showMask()
		} else {
			// await getPC().hideMask()
			if (pageController) {
				pageController.hideMask()
				pageController.cleanUpHighlights()
			}
		}

		if (!isAgentRunning && agentInTouch) {
			if (pageController) {
				pageController.dispose()
				pageController = null
			}
		}
	}, 500)

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type !== 'PAGE_CONTROL') {
			// sendResponse({
			// 	success: false,
			// 	error: `[RemotePageController.ContentScript]: Invalid message type: ${message.type}`,
			// })
			return
		}

		const { action, payload } = message
		const methodName = getMethodName(action)

		const pc = getPC() as any

		switch (action) {
			case 'get_last_update_time':
			case 'get_browser_state':
			case 'update_tree':
			case 'clean_up_highlights':
			case 'click_element':
			case 'input_text':
			case 'select_option':
			case 'scroll':
			case 'scroll_horizontally':
				pc[methodName](...(payload || []))
					.then((result: any) => sendResponse(result))
					.catch((error: any) =>
						sendResponse({
							success: false,
							error: error instanceof Error ? error.message : String(error),
						}),
					)
				break

			case 'execute_javascript':
				dispatchJsExecution(pc, executeInMainWorld, payload)
					.then((result: any) => sendResponse(result))
					.catch((error: any) =>
						sendResponse({
							success: false,
							message: `❌ ${error instanceof Error ? error.message : String(error)}`,
						}),
					)
				break

			default:
				sendResponse({
					success: false,
					error: `Unknown PAGE_CONTROL action: ${action}`,
				})
		}

		return true
	})
}

function getMethodName(action: string): string {
	switch (action) {
		case 'get_last_update_time':
			return 'getLastUpdateTime' as const
		case 'get_browser_state':
			return 'getBrowserState' as const
		case 'update_tree':
			return 'updateTree' as const
		case 'clean_up_highlights':
			return 'cleanUpHighlights' as const

		// DOM actions

		case 'click_element':
			return 'clickElement' as const
		case 'input_text':
			return 'inputText' as const
		case 'select_option':
			return 'selectOption' as const
		case 'scroll':
			return 'scroll' as const
		case 'scroll_horizontally':
			return 'scrollHorizontally' as const
		case 'execute_javascript':
			return 'executeJavascript' as const

		default:
			return action
	}
}
