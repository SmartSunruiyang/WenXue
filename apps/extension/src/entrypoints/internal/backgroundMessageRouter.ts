import { handleChaoxingControlMessage } from '@/agent/chaoxing/bridge.background'
import { handlePageControlMessage } from '@/agent/RemotePageController.background'
import { handleTabControlMessage } from '@/agent/TabsController.background'
import { handleVisualObserveMessage } from '@/agent/visualObserve.background'
import { handleLogControlMessage } from '@/lib/log.background'
import type { LogControlMessage } from '@/lib/logTypes'
import { clearExtensionUserSession, loadExtensionUserSession } from '@/lib/userSession'

export function routeBackgroundMessage(
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
): true | undefined {
	if (!isRecord(message) || typeof message.type !== 'string') return

	switch (message.type) {
		case 'TAB_CONTROL':
			return handleTabControlMessage(
				message as Parameters<typeof handleTabControlMessage>[0],
				sender,
				sendResponse,
			)
		case 'PAGE_CONTROL':
			return handlePageControlMessage(
				message as Parameters<typeof handlePageControlMessage>[0],
				sender,
				sendResponse,
			)
		case 'VISUAL_OBSERVE':
			return handleVisualObserveMessage(message, sender, sendResponse)
		case 'CHAOXING_CONTROL':
			return handleChaoxingControlMessage(
				message as unknown as Parameters<typeof handleChaoxingControlMessage>[0],
				sender,
				sendResponse,
			)
		case 'WENXUE_GET_USER_SESSION':
			loadExtensionUserSession(chrome.storage.local).then(
				(session) => sendResponse({ ok: true, session }),
				(error: unknown) =>
					sendResponse({
						ok: false,
						error: error instanceof Error ? error.message : 'Failed to load user session',
					}),
			)
			return true
		case 'WENXUE_CLEAR_USER_SESSION':
			clearExtensionUserSession(chrome.storage.local).then(
				() => sendResponse({ ok: true }),
				(error: unknown) =>
					sendResponse({
						ok: false,
						error: error instanceof Error ? error.message : 'Failed to clear user session',
					}),
			)
			return true
		default:
			if (message.type.startsWith('LOG_')) {
				return handleLogControlMessage(message as LogControlMessage, sender, sendResponse)
			}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
