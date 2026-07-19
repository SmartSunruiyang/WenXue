import {
	CaptureError,
	captureVisibleManagedTabPng,
	type CaptureTabsApi,
} from './questionSolver/capture'

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
	'tab_not_visible',
] as const

export type VisualObserveCaptureFailureCode = (typeof VISUAL_OBSERVE_CAPTURE_FAILURE_CODES)[number]

export interface CapturedVisibleTab {
	ok: true
	protocolVersion: typeof VISUAL_OBSERVE_PROTOCOL_VERSION
	dataUrl: `data:image/${'png' | 'jpeg'};base64,${string}`
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

type VisualObserveChromeApi = CaptureTabsApi

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

	try {
		const { dataUrl, tab } = await captureVisibleManagedTabPng({
			targetTabId,
			api,
			retryLimit: 0,
		})

		return {
			ok: true,
			protocolVersion: VISUAL_OBSERVE_PROTOCOL_VERSION,
			dataUrl,
			tab: {
				id: tab.id as number,
				windowId: tab.windowId,
				url: tab.url,
				title: tab.title,
			},
		}
	} catch (error) {
		if (error instanceof CaptureError) {
			const code = VISUAL_OBSERVE_CAPTURE_FAILURE_CODES.includes(
				error.code as VisualObserveCaptureFailureCode,
			)
				? (error.code as VisualObserveCaptureFailureCode)
				: 'capture_failed'
			return captureFailure(code, error.message)
		}
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
