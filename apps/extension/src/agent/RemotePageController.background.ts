/**
 * background logics for RemotePageController
 * - redirect messages from RemotePageController(Agent, extension pages) to ContentScript
 */

type PageControlMessage = {
	type: 'PAGE_CONTROL'
	action: string
	payload: any
	targetTabId: number
	frameId?: number
}

function originOf(url: string | undefined): string {
	if (!url) return ''

	try {
		return new URL(url).origin
	} catch {
		return ''
	}
}

export function handlePageControlMessage(
	message: PageControlMessage,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
): true | undefined {
	const PREFIX = '[RemotePageController.background]'

	const debug = console.debug.bind(console, `\x1b[90m${PREFIX}\x1b[0m`)

	const { action, payload, targetTabId, frameId } = message

	if (action === 'get_my_tab_id') {
		debug('get_my_tab_id', sender.tab?.id)
		sendResponse({ tabId: sender.tab?.id || null })
		return
	}

	if (action === 'list_frames') {
		chrome.webNavigation
			.getAllFrames({ tabId: targetTabId })
			.then((frames) => {
				const safeFrames = frames ?? []
				const topOrigin = originOf(safeFrames.find((frame) => frame.frameId === 0)?.url)

				sendResponse(
					safeFrames.map((frame) => {
						const origin = originOf(frame.url)

						return {
							frameId: frame.frameId,
							url: frame.url,
							origin,
							sameOriginWithTop: origin === topOrigin,
							parentFrameId: frame.parentFrameId,
						}
					}),
				)
			})
			.catch((error) => {
				console.error(PREFIX, error)
				sendResponse([])
			})

		return true
	}

	// proxy to content script
	chrome.tabs
		.sendMessage(
			targetTabId,
			{
				type: 'PAGE_CONTROL',
				action,
				payload,
			},
			{ frameId: frameId ?? 0 },
		)
		.then((result) => {
			sendResponse(result)
		})
		.catch((error) => {
			const message = error instanceof Error ? error.message : String(error)
			console.error(PREFIX, error)
			sendResponse({
				success: false,
				error: message,
				message,
			})
		})

	return true // async response
}
