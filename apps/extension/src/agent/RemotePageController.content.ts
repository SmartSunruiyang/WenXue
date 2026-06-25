/**
 * content script for RemotePageController
 */
import { PageController } from '@page-agent/page-controller'

import { shouldShowAgentMask } from './RemotePageController'

type JsResult = { success: boolean; message: string }

export async function dispatchJsExecution(
	pc: { executeJavascript: (script: string) => Promise<JsResult> },
	runInMainWorld: (script: string) => Promise<JsResult>,
	payload: [string, { world?: 'isolated' | 'main' }] | undefined,
): Promise<JsResult> {
	const [script, opts] = payload ?? ['', {}]
	const world = opts?.world ?? 'isolated'
	const run = world === 'main' ? runInMainWorld(script) : pc.executeJavascript(script)
	return withTimeout(run, 10_000)
}

function withTimeout(p: Promise<JsResult>, ms: number): Promise<JsResult> {
	let timer: ReturnType<typeof setTimeout>
	const timeout = new Promise<JsResult>((resolve) => {
		timer = setTimeout(
			() => resolve({ success: false, message: `❌ 执行超时（${ms / 1000}s）` }),
			ms,
		)
	})
	return Promise.race([p.finally(() => clearTimeout(timer)), timeout])
}

export function initPageController() {
	let pageController: PageController | null = null
	let intervalID: number | null = null

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

	const executeInMainWorld = async (_script: string): Promise<JsResult> => ({
		success: false,
		message: 'main world not wired yet',
	})

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
