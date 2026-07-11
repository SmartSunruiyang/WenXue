export const VISUAL_OBSERVE_PROTOCOL_VERSION = 2 as const

export type VisualObserveMessage =
	| {
			type: 'VISUAL_OBSERVE'
			action: 'get_protocol_version'
			protocolVersion: number
	  }
	| {
			type: 'VISUAL_OBSERVE'
			action: 'capture_visible_tab'
			protocolVersion: number
			targetTabId: number
	  }

export const VISUAL_OBSERVE_CAPTURE_FAILURE_CODES = [
	'capture_failed',
	'invalid_request',
	'message_failed',
	'no_active_tab',
	'protocol_mismatch',
	'runtime_outdated',
	'tab_changed',
] as const

export type VisualObserveCaptureFailureCode = (typeof VISUAL_OBSERVE_CAPTURE_FAILURE_CODES)[number]

export interface CapturedVisibleTab {
	ok: true
	protocolVersion: typeof VISUAL_OBSERVE_PROTOCOL_VERSION
	dataUrl: string
	tab: {
		id: number
		windowId: number
		url?: string
		title?: string
	}
}

export interface VisualObserveCaptureFailure {
	ok: false
	protocolVersion: typeof VISUAL_OBSERVE_PROTOCOL_VERSION
	code: VisualObserveCaptureFailureCode
	error: string
}

export type VisualObserveCaptureResult = CapturedVisibleTab | VisualObserveCaptureFailure

export interface VisualObserveProtocolResponse {
	ok: true
	protocolVersion: typeof VISUAL_OBSERVE_PROTOCOL_VERSION
}

interface VisualObserveChromeApi {
	tabs: Pick<typeof chrome.tabs, 'captureVisibleTab' | 'get' | 'query' | 'update'>
}

export function handleVisualObserveMessage(
	message: unknown,
	_sender: chrome.runtime.MessageSender,
	sendResponse: (response: VisualObserveCaptureResult | VisualObserveProtocolResponse) => void,
): true | undefined {
	if (!isRecord(message)) {
		sendResponse(captureFailure('invalid_request', 'Visual observation request is invalid.'))
		return
	}
	if (message.protocolVersion !== VISUAL_OBSERVE_PROTOCOL_VERSION) {
		sendResponse(
			captureFailure(
				'protocol_mismatch',
				`Visual observation protocol mismatch: expected ${VISUAL_OBSERVE_PROTOCOL_VERSION}.`,
			),
		)
		return
	}
	if (message.action === 'get_protocol_version') {
		sendResponse({ ok: true, protocolVersion: VISUAL_OBSERVE_PROTOCOL_VERSION })
		return
	}
	if (message.action !== 'capture_visible_tab') {
		sendResponse(
			captureFailure('invalid_request', `Unknown visual observe action: ${String(message.action)}`),
		)
		return
	}

	captureCurrentVisibleTab({ targetTabId: message.targetTabId }).then(
		sendResponse,
		(error: unknown) => {
			sendResponse(captureFailure('capture_failed', errorMessage(error)))
		},
	)

	return true
}

export async function captureCurrentVisibleTab({
	targetTabId,
	api = chrome,
}: {
	targetTabId?: unknown
	api?: VisualObserveChromeApi
} = {}): Promise<VisualObserveCaptureResult> {
	if (typeof targetTabId !== 'number' || !Number.isInteger(targetTabId) || targetTabId < 0) {
		return captureFailure('invalid_request', 'Visual observation requires a valid target tab id.')
	}

	let targetTab: chrome.tabs.Tab
	try {
		targetTab = await api.tabs.get(targetTabId)
	} catch {
		return captureFailure('no_active_tab', 'The target tab is no longer available.')
	}

	try {
		if (targetTab?.id === undefined || targetTab.windowId === undefined) {
			return captureFailure('no_active_tab', 'The target tab is no longer available.')
		}

		if (!targetTab.active) {
			await api.tabs.update(targetTab.id, { active: true })
		}

		const dataUrl = await api.tabs.captureVisibleTab(targetTab.windowId, {
			format: 'jpeg',
			quality: 80,
		})
		if (!dataUrl) {
			return captureFailure('capture_failed', 'Browser returned an empty screenshot.')
		}

		const activeTab = (await api.tabs.query({ active: true, windowId: targetTab.windowId }))[0]
		if (activeTab?.id !== targetTab.id) {
			return captureFailure(
				'tab_changed',
				'The active tab changed while the screenshot was being captured.',
			)
		}
		if (
			typeof targetTab.url === 'string' &&
			typeof activeTab.url === 'string' &&
			activeTab.url !== targetTab.url
		) {
			return captureFailure(
				'tab_changed',
				'The target tab changed while the screenshot was being captured.',
			)
		}

		return {
			ok: true,
			protocolVersion: VISUAL_OBSERVE_PROTOCOL_VERSION,
			dataUrl,
			tab: {
				id: activeTab.id,
				windowId: activeTab.windowId,
				url: activeTab.url,
				title: activeTab.title,
			},
		}
	} catch (error) {
		return captureFailure('capture_failed', errorMessage(error))
	}
}

function captureFailure(
	code: VisualObserveCaptureFailureCode,
	error: string,
): VisualObserveCaptureFailure {
	return {
		ok: false,
		protocolVersion: VISUAL_OBSERVE_PROTOCOL_VERSION,
		code,
		error,
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
