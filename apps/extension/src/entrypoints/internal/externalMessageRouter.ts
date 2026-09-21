import { saveExtensionUserSession, type UserSessionStorageArea } from '@/lib/userSession'

interface ExternalTabsApi {
	remove(tabId: number): Promise<void>
}

interface ExternalMessageRouterDependencies {
	storage: UserSessionStorageArea
	tabs: ExternalTabsApi
	openOrFocusHubTab(wsPort: number): Promise<void>
}

type ExternalMessageRouter = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
) => true | undefined

export function createExternalMessageRouter(
	dependencies: ExternalMessageRouterDependencies,
): ExternalMessageRouter {
	return (message, sender, sendResponse) => {
		if (!isRecord(message) || typeof message.type !== 'string') {
			sendResponse({ ok: false, error: 'Unsupported external message' })
			return
		}

		switch (message.type) {
			case 'OPEN_HUB': {
				if (!isLocalhostExternalSender(sender)) {
					sendResponse({ ok: false, error: 'Unauthorized sender' })
					return
				}
				if (!isValidPort(message.wsPort)) {
					sendResponse({ ok: false, error: 'Invalid hub port' })
					return
				}

				void dependencies.openOrFocusHubTab(message.wsPort).then(
					() => {
						const senderTabId = readSenderTabId(sender)
						if (senderTabId !== null) {
							void dependencies.tabs.remove(senderTabId).catch(() => {})
						}
						sendResponse({ ok: true })
					},
					(error: unknown) => {
						sendResponse({
							ok: false,
							error: error instanceof Error ? error.message : 'Failed to open hub',
						})
					},
				)
				return true
			}
			case 'WENXUE_USER_SESSION':
				if (!isLocalhostExternalSender(sender)) {
					sendResponse({ ok: false, error: 'Unauthorized sender' })
					return
				}
				void saveExtensionUserSession(dependencies.storage, message.session).then(
					(session) => sendResponse({ ok: true, userId: session.userId }),
					(error: unknown) =>
						sendResponse({
							ok: false,
							error: error instanceof Error ? error.message : 'Invalid user session',
						}),
				)
				return true
			case 'WENXUE_USER_SESSION_HANDOFF_CLOSE': {
				if (!isLocalhostExternalSender(sender)) {
					sendResponse({ ok: false, error: 'Unauthorized sender' })
					return
				}

				const senderTabId = readSenderTabId(sender)
				if (senderTabId === null) {
					sendResponse({ ok: false, error: 'Sender tab is unavailable' })
					return
				}

				void dependencies.tabs.remove(senderTabId).then(
					() => sendResponse({ ok: true }),
					(error: unknown) =>
						sendResponse({
							ok: false,
							error: error instanceof Error ? error.message : 'Failed to close handoff tab',
						}),
				)
				return true
			}
			default:
				sendResponse({ ok: false, error: 'Unsupported external message' })
		}
	}
}

function isLocalhostExternalSender(sender: chrome.runtime.MessageSender): boolean {
	const source = sender.origin ?? sender.url ?? sender.tab?.url
	if (!source) return false

	try {
		const url = new URL(source)
		return (
			url.protocol === 'http:' &&
			(url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
		)
	} catch {
		return false
	}
}

function readSenderTabId(sender: chrome.runtime.MessageSender): number | null {
	const tabId = sender.tab?.id
	return typeof tabId === 'number' && Number.isInteger(tabId) && tabId >= 0 ? tabId : null
}

function isValidPort(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
