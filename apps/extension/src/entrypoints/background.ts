import { setupTabEventsPort } from '@/agent/TabsController.background'
import { configureLogger } from '@/lib/logger'
import { purge } from '@/lib/logStore'
import { saveExtensionUserSession } from '@/lib/userSession'

import { routeBackgroundMessage } from './internal/backgroundMessageRouter'

const LOG_PURGE_ALARM = 'log-purge'
const DEFAULT_RETENTION_DAYS = 3
const DEFAULT_MAX_ENTRIES = 5000

export default defineBackground(() => {
	console.log('[Background] Service Worker started')

	// configure logger for background context (direct sink → writes to idb directly)
	configureLogger({ context: 'background', sink: 'direct' })

	// startup log purge
	runPurge()

	// scheduled log purge every 30 minutes
	chrome.alarms.create(LOG_PURGE_ALARM, { periodInMinutes: 30 })
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === LOG_PURGE_ALARM) runPurge()
	})

	// tab change events

	setupTabEventsPort()

	// message proxy

	chrome.runtime.onMessage.addListener(routeBackgroundMessage)

	// external messages (from localhost launcher page via externally_connectable)

	chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
		if (message.type === 'OPEN_HUB') {
			openOrFocusHubTab(message.wsPort).then(() => {
				if (sender.tab?.id) chrome.tabs.remove(sender.tab.id)
				sendResponse({ ok: true })
			})
			return true
		}
		if (message.type === 'WENXUE_USER_SESSION') {
			if (!isLocalhostExternalSender(sender)) {
				sendResponse({ ok: false, error: 'Unauthorized sender' })
				return
			}
			saveExtensionUserSession(chrome.storage.local, message.session).then(
				(session) => sendResponse({ ok: true, userId: session.userId }),
				(error: unknown) =>
					sendResponse({
						ok: false,
						error: error instanceof Error ? error.message : 'Invalid user session',
					}),
			)
			return true
		}
	})

	// setup

	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

async function openOrFocusHubTab(wsPort: number) {
	const hubUrl = chrome.runtime.getURL('hub.html')
	const existing = await chrome.tabs.query({ url: `${hubUrl}*` })

	if (existing.length > 0 && existing[0].id) {
		await chrome.tabs.update(existing[0].id, {
			active: true,
			url: `${hubUrl}?ws=${wsPort}`,
		})
		return
	}

	await chrome.tabs.create({ url: `${hubUrl}?ws=${wsPort}`, pinned: true, active: true })
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

async function runPurge(): Promise<void> {
	try {
		const stored = await chrome.storage.local.get(['logRetentionDays', 'logMaxEntries'])
		const retentionDays = (stored.logRetentionDays as number | undefined) ?? DEFAULT_RETENTION_DAYS
		const maxEntries = (stored.logMaxEntries as number | undefined) ?? DEFAULT_MAX_ENTRIES
		await purge({ retentionDays, maxEntries, now: Date.now() })
	} catch {
		// Purge is best-effort; never crash the SW
	}
}
