import type { LogControlMessage } from './logTypes'
import { appendBatch, clear, exportAll, query } from './logStore'

/**
 * Dispatch LOG_* control messages from `chrome.runtime.onMessage`.
 *
 * Returns `true` (keeping the message channel open) for async LOG_* handlers,
 * or `undefined` for non-log messages so other handlers can process them.
 */
export function handleLogControlMessage(
	message: LogControlMessage,
	_sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
): true | undefined {
	if (!message?.type?.startsWith('LOG_')) return undefined

	switch (message.type) {
		case 'LOG_APPEND':
			appendBatch(message.entries).then(
				() => sendResponse({ ok: true }),
				(e: unknown) => sendResponse({ error: String(e) }),
			)
			return true

		case 'LOG_QUERY':
			query(message.filter).then(
				(entries) => sendResponse({ entries }),
				(e: unknown) => sendResponse({ error: String(e) }),
			)
			return true

		case 'LOG_EXPORT':
			exportAll(message.filter).then(
				(entries) => sendResponse({ entries }),
				(e: unknown) => sendResponse({ error: String(e) }),
			)
			return true

		case 'LOG_CLEAR':
			clear().then(
				() => sendResponse({ ok: true }),
				(e: unknown) => sendResponse({ error: String(e) }),
			)
			return true
	}
}
