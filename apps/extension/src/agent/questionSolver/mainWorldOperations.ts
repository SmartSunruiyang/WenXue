import * as z from 'zod/v4'

import type { FrameRef, JsonValue, MainWorldOperationId } from './contracts'
import { assertJsonValue, QuestionSolverProtocolError } from './protocol'

const MAIN_RESULT_MAX_BYTES = 256 * 1024

const valueEntrySchema = z
	.object({ key: z.string().min(1).max(256), value: z.string().max(20_000) })
	.strict()
const setterArgsSchema = z
	.object({
		questionFingerprint: z.string().min(1).max(128),
		values: z.array(valueEntrySchema).max(100),
	})
	.strict()
const emptyArgsSchema = z.object({}).strict()
const passiveArgsSchema = z
	.object({
		endpointPatternIds: z.array(z.string().min(1).max(128)).max(16).optional(),
	})
	.strict()

type MainWorldHandler = (args: JsonValue) => JsonValue

interface ScriptingApi {
	scripting: Pick<typeof chrome.scripting, 'executeScript'>
}

interface PassiveCaptureTracker {
	refCount: number
	activeRequests: number
	lastNetworkAt: number
	lastMutationAt: number
	originalFetch?: typeof window.fetch
	originalXhrSend: typeof XMLHttpRequest.prototype.send
	wrappedFetch?: typeof window.fetch
	wrappedXhrSend: typeof XMLHttpRequest.prototype.send
	mutationObserver: MutationObserver
}

interface NetworkQuietTracker {
	activeRequests: 0
	lastNetworkAt: number
	lastMutationAt: number
	mutationObserver: MutationObserver
	cleanupTimer?: number
}

export async function executeFixedMainWorldOperation(args: {
	operationId: MainWorldOperationId
	operationArgs: JsonValue
	target: FrameRef
	api?: ScriptingApi
}): Promise<JsonValue> {
	if (!args.target.documentId) {
		throw new QuestionSolverProtocolError('document_identity_unavailable')
	}
	const handler = handlerFor(args.operationId)
	const validatedArgs = validateOperationArgs(args.operationId, args.operationArgs)
	const api = args.api ?? chrome
	const results = await api.scripting.executeScript({
		target: { tabId: args.target.tabId, documentIds: [args.target.documentId] },
		world: 'MAIN',
		func: handler,
		args: [validatedArgs],
	})
	if (results.length !== 1) throw new QuestionSolverProtocolError('main_world_target_mismatch')
	const result = results[0]?.result
	assertJsonValue(result, false)
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAIN_RESULT_MAX_BYTES) {
		throw new QuestionSolverProtocolError('main_world_result_too_large')
	}
	return result
}

export function validateOperationArgs(
	operationId: MainWorldOperationId,
	args: JsonValue,
): JsonValue {
	const schema = operationId.endsWith('_set')
		? setterArgsSchema
		: operationId === 'common.passive_capture_arm'
			? passiveArgsSchema
			: emptyArgsSchema
	const result = schema.safeParse(args)
	if (!result.success) throw new QuestionSolverProtocolError('main_world_args_invalid')
	return result.data as JsonValue
}

function handlerFor(operationId: MainWorldOperationId): MainWorldHandler {
	switch (operationId) {
		case 'common.native_input_set':
			return nativeInputSetMain as MainWorldHandler
		case 'common.vditor_set':
			return vditorSetMain as MainWorldHandler
		case 'icve.ueditor_set':
			return ueditorSetMain as MainWorldHandler
		case 'unipus.controlled_input_set':
			return unipusControlledInputSetMain as MainWorldHandler
		case 'common.passive_capture_arm':
			return passiveCaptureArmMain as MainWorldHandler
		case 'common.passive_capture_disarm':
			return passiveCaptureDisarmMain as MainWorldHandler
		case 'common.network_quiet_snapshot':
			return networkQuietSnapshotMain as MainWorldHandler
		case 'chaoxing.runtime_read':
		case 'zhihuishu.runtime_read':
		case 'icourse.runtime_read':
			return emptyRuntimeReadMain as MainWorldHandler
		case 'zhihuishu.gxk_project_exam_response':
			return zhihuishuGxkTitleReadMain as MainWorldHandler
	}
}

/** Fixed, bundled MAIN-world handler. It accepts values only, never selectors or source text. */
function nativeInputSetMain(raw: JsonValue): JsonValue {
	const args = raw as { values: Array<{ key: string; value: string }> }
	const desired = new Map(args.values.map((entry) => [entry.key, entry.value]))
	const controls = Array.from(
		document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
			'input[type="text"],input:not([type]),textarea',
		),
	)
	const keys = controls.map(
		(control) =>
			control.getAttribute('data-blank-key') ||
			control.getAttribute('name') ||
			control.id ||
			undefined,
	)
	const keyCounts = new Map<string, number>()
	for (const key of keys) {
		if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
	}
	let updated = 0
	for (const [index, control] of controls.entries()) {
		const key = keys[index]
		if (!key || keyCounts.get(key) !== 1) continue
		const value = desired.get(key)
		if (value === undefined || control.value === value) continue
		const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')
		descriptor?.set?.call(control, value)
		control.dispatchEvent(new Event('input', { bubbles: true }))
		control.dispatchEvent(new Event('change', { bubbles: true }))
		updated++
	}
	return { updated }
}

function vditorSetMain(raw: JsonValue): JsonValue {
	const args = raw as { values: Array<{ key: string; value: string }> }
	const desired = new Map(args.values.map((entry) => [entry.key, entry.value]))
	const controls = Array.from(document.querySelectorAll<HTMLElement>('.vditor-reset'))
	const keys = controls.map(
		(control) => control.getAttribute('data-blank-key') || control.id || undefined,
	)
	const keyCounts = new Map<string, number>()
	for (const key of keys) {
		if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
	}
	let updated = 0
	for (const [index, control] of controls.entries()) {
		const key = keys[index]
		if (!key || keyCounts.get(key) !== 1) continue
		const value = desired.get(key)
		if (value === undefined || control.textContent === value) continue
		control.textContent = value
		control.dispatchEvent(
			new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
		)
		control.dispatchEvent(new Event('change', { bubbles: true }))
		updated++
	}
	return { updated }
}

function ueditorSetMain(raw: JsonValue): JsonValue {
	const args = raw as { values: Array<{ key: string; value: string }> }
	const desired = new Map(args.values.map((entry) => [entry.key, entry.value]))
	const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[id*="ueditor"]'))
	const keys = frames.map((frame) => frame.getAttribute('data-blank-key') || frame.id || undefined)
	const keyCounts = new Map<string, number>()
	for (const key of keys) {
		if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
	}
	let updated = 0
	for (const [index, frame] of frames.entries()) {
		const key = keys[index]
		if (!key || keyCounts.get(key) !== 1) continue
		const value = desired.get(key)
		const body = frame.contentDocument?.body
		if (value === undefined || !body || body.textContent === value) continue
		body.textContent = value
		body.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
		body.dispatchEvent(new Event('change', { bubbles: true }))
		updated++
	}
	return { updated }
}

function unipusControlledInputSetMain(raw: JsonValue): JsonValue {
	const args = raw as { values: Array<{ key: string; value: string }> }
	const desired = new Map(args.values.map((entry) => [entry.key, entry.value]))
	const controls = Array.from(
		document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
			'.question-wrap input,.question-wrap textarea,.layout-reply-container input,.layout-reply-container textarea,.question-common-abs-reply textarea',
		),
	)
	const keys = controls.map(
		(control) =>
			control.getAttribute('data-blank-key') ||
			control.getAttribute('name') ||
			control.id ||
			undefined,
	)
	const keyCounts = new Map<string, number>()
	for (const key of keys) {
		if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
	}
	let updated = 0
	for (const [index, control] of controls.entries()) {
		const key = keys[index]
		if (!key || keyCounts.get(key) !== 1) continue
		const value = desired.get(key)
		if (value === undefined || control.value === value) continue
		control.focus()
		control.dispatchEvent(
			new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: value }),
		)
		const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')
		descriptor?.set?.call(control, value)
		control.dispatchEvent(
			new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
		)
		control.dispatchEvent(new Event('change', { bubbles: true }))
		control.blur()
		updated++
	}
	return { updated }
}

function passiveCaptureArmMain(): JsonValue {
	const scope = window as typeof window & {
		__wenxueQuestionSolverTracker?: PassiveCaptureTracker
	}
	if (scope.__wenxueQuestionSolverTracker) {
		scope.__wenxueQuestionSolverTracker.refCount++
		return { armed: true, refCount: scope.__wenxueQuestionSolverTracker.refCount }
	}
	const tracker: PassiveCaptureTracker = {
		refCount: 1,
		activeRequests: 0,
		lastNetworkAt: Date.now(),
		lastMutationAt: Date.now(),
		originalFetch: window.fetch,
		originalXhrSend: XMLHttpRequest.prototype.send,
		wrappedXhrSend: XMLHttpRequest.prototype.send,
		mutationObserver: new MutationObserver(() => {
			tracker.lastMutationAt = Date.now()
		}),
	}
	if (document.documentElement) {
		tracker.mutationObserver.observe(document.documentElement, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
	}
	if (typeof window.fetch === 'function') {
		const wrappedFetch = (async (...fetchArgs: Parameters<typeof fetch>) => {
			tracker.activeRequests++
			try {
				return await tracker.originalFetch!.apply(window, fetchArgs)
			} finally {
				tracker.activeRequests--
				tracker.lastNetworkAt = Date.now()
			}
		}) as typeof window.fetch
		tracker.wrappedFetch = wrappedFetch
		window.fetch = wrappedFetch
	}
	const wrappedXhrSend = function (
		this: XMLHttpRequest,
		...sendArgs: Parameters<XMLHttpRequest['send']>
	) {
		tracker.activeRequests++
		const onLoadEnd = () => {
			tracker.activeRequests--
			tracker.lastNetworkAt = Date.now()
		}
		this.addEventListener('loadend', onLoadEnd, { once: true })
		try {
			return tracker.originalXhrSend.apply(this, sendArgs)
		} catch (error) {
			this.removeEventListener('loadend', onLoadEnd)
			onLoadEnd()
			throw error
		}
	}
	tracker.wrappedXhrSend = wrappedXhrSend
	XMLHttpRequest.prototype.send = wrappedXhrSend
	scope.__wenxueQuestionSolverTracker = tracker
	return { armed: true, refCount: 1 }
}

function passiveCaptureDisarmMain(): JsonValue {
	const scope = window as typeof window & {
		__wenxueQuestionSolverTracker?: PassiveCaptureTracker
	}
	const tracker = scope.__wenxueQuestionSolverTracker
	if (!tracker) return { armed: false, refCount: 0 }
	tracker.refCount--
	if (tracker.refCount > 0) return { armed: true, refCount: tracker.refCount }
	tracker.mutationObserver?.disconnect()
	if (tracker.originalFetch && window.fetch === tracker.wrappedFetch) {
		window.fetch = tracker.originalFetch
	}
	if (XMLHttpRequest.prototype.send === tracker.wrappedXhrSend) {
		XMLHttpRequest.prototype.send = tracker.originalXhrSend
	}
	delete scope.__wenxueQuestionSolverTracker
	return { armed: false, refCount: 0 }
}

function networkQuietSnapshotMain(): JsonValue {
	const scope = window as typeof window & {
		__wenxueQuestionSolverTracker?: PassiveCaptureTracker
		__wenxueQuestionSolverQuietTracker?: NetworkQuietTracker
	}
	const passiveTracker = scope.__wenxueQuestionSolverTracker
	if (passiveTracker) {
		return {
			activeRequests: passiveTracker.activeRequests,
			lastNetworkAt: passiveTracker.lastNetworkAt,
			lastMutationAt: passiveTracker.lastMutationAt,
		}
	}

	let tracker = scope.__wenxueQuestionSolverQuietTracker
	if (!tracker) {
		const now = Date.now()
		const createdTracker: NetworkQuietTracker = {
			activeRequests: 0,
			lastNetworkAt: now,
			lastMutationAt: now,
			mutationObserver: new MutationObserver(() => {
				createdTracker.lastMutationAt = Date.now()
			}),
		}
		if (document.documentElement) {
			createdTracker.mutationObserver.observe(document.documentElement, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true,
			})
		}
		tracker = createdTracker
		scope.__wenxueQuestionSolverQuietTracker = createdTracker
	}
	if (tracker.cleanupTimer !== undefined) window.clearTimeout(tracker.cleanupTimer)
	const trackerForCleanup = tracker
	tracker.cleanupTimer = window.setTimeout(() => {
		if (scope.__wenxueQuestionSolverQuietTracker !== trackerForCleanup) return
		trackerForCleanup.mutationObserver.disconnect()
		delete scope.__wenxueQuestionSolverQuietTracker
	}, 30_000)
	return {
		activeRequests: tracker.activeRequests,
		lastNetworkAt: tracker.lastNetworkAt,
		lastMutationAt: tracker.lastMutationAt,
	}
}

function emptyRuntimeReadMain(): JsonValue {
	return { candidates: [] }
}

function zhihuishuGxkTitleReadMain(): JsonValue {
	return {
		questionNames: Array.from(document.querySelectorAll<HTMLElement>('.subject_describe > div'))
			.filter((element) => !hidden(element))
			.map((element) => visibleText(element).replace(/\s+/g, ' ').trim())
			.filter(Boolean)
			.slice(0, 500),
	}

	function visibleText(root: Element): string {
		const chunks: string[] = []
		walk(root)
		return chunks.join(' ')

		function walk(node: Node): void {
			if (node.nodeType === Node.TEXT_NODE) {
				if (node.textContent) chunks.push(node.textContent)
				return
			}
			if (!(node instanceof Element) || hidden(node)) return
			for (const child of Array.from(node.childNodes)) walk(child)
		}
	}

	function hidden(element: Element): boolean {
		for (let current: Element | null = element; current; current = current.parentElement) {
			if (
				current.getAttribute('aria-hidden') === 'true' ||
				current.hasAttribute('hidden') ||
				current.hasAttribute('inert')
			) {
				return true
			}
			try {
				const style = current.ownerDocument.defaultView?.getComputedStyle(current)
				if (style && renderedStyleIsHidden(style)) return true
			} catch {
				// A missing style engine is not evidence that the node is hidden.
			}
		}
		return false
	}

	function renderedStyleIsHidden(style: CSSStyleDeclaration): boolean {
		if (
			style.display === 'none' ||
			style.visibility === 'hidden' ||
			style.visibility === 'collapse' ||
			style.opacity === '0' ||
			cssPixelValue(style.fontSize) === 0 ||
			isFullyTransparentColor(style.color) ||
			isFullyTransparentColor(style.getPropertyValue('-webkit-text-fill-color')) ||
			/opacity\(\s*(?:0(?:\.0+)?|0%)\s*\)/.test(style.filter.toLowerCase()) ||
			style.getPropertyValue('content-visibility') === 'hidden'
		) {
			return true
		}
		const clip = style.clip.trim().toLowerCase()
		if (clip && clip !== 'auto' && /rect\([^)]*\b0(?:px)?\b[^)]*\)/.test(clip)) return true
		const clipPath = style.getPropertyValue('clip-path').trim().toLowerCase()
		if (
			/(?:inset\(\s*(?:50|100)%|circle\(\s*0(?:px|%|\b)|ellipse\(\s*0(?:px|%|\b))/.test(clipPath)
		) {
			return true
		}
		const transform = style.transform.replace(/\s+/g, '').toLowerCase()
		if (
			/(?:^|\))scale(?:x|y|3d)?\((?:0(?:,0(?:,0)?)?)\)(?:$|\()/.test(transform) ||
			/^matrix\(0,0,0,0,/.test(transform) ||
			/^matrix3d\(0,0,0,0,0,0,0,0,0,0,0,0,/.test(transform)
		) {
			return true
		}
		const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`.toLowerCase()
		const width = cssPixelValue(style.width)
		const height = cssPixelValue(style.height)
		if ((width === 0 || height === 0) && /\b(?:hidden|clip)\b/.test(overflow)) return true
		const positioned = style.position === 'absolute' || style.position === 'fixed'
		if (
			positioned &&
			[cssPixelValue(style.left), cssPixelValue(style.top)].some(
				(value) => value !== undefined && value <= -1_000,
			)
		) {
			return true
		}
		const textIndent = cssPixelValue(style.textIndent)
		return Boolean(
			textIndent !== undefined && textIndent <= -1_000 && /\b(?:hidden|clip)\b/.test(overflow),
		)
	}

	function isFullyTransparentColor(value: string): boolean {
		const normalized = value.trim().toLowerCase()
		return (
			normalized === 'transparent' ||
			/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(normalized) ||
			/^rgb\([^)]*\/\s*0%?\s*\)$/.test(normalized)
		)
	}

	function cssPixelValue(value: string): number | undefined {
		const normalized = value.trim().toLowerCase()
		if (!/^-?\d+(?:\.\d+)?px$/.test(normalized)) return undefined
		const parsed = Number.parseFloat(normalized)
		return Number.isFinite(parsed) ? parsed : undefined
	}
}
