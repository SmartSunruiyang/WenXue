import { installQuestionSolverBackgroundLifecycle } from '@/agent/questionSolver/bridge.background'
import { setupTabEventsPort } from '@/agent/TabsController.background'
import { configureLogger } from '@/lib/logger'
import { purge } from '@/lib/logStore'

import { routeBackgroundMessage } from './internal/backgroundMessageRouter'
import { createExternalMessageRouter } from './internal/externalMessageRouter'

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
	installQuestionSolverBackgroundLifecycle()

	// message proxy

	chrome.runtime.onMessage.addListener(routeBackgroundMessage)

	// external messages (from localhost launcher page via externally_connectable)

	chrome.runtime.onMessageExternal.addListener(
		createExternalMessageRouter({
			storage: chrome.storage.local,
			tabs: chrome.tabs,
			openOrFocusHubTab,
		}),
	)

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
