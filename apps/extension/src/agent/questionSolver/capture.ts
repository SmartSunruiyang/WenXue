import { delayWithAbort } from './asyncControl'
import type { InternalImageEnvelope, VisualCapturePreparation } from './contracts'
import { sha256Hex } from './fingerprints'
import { IMAGE_ASSET_MAX_BYTES } from './imageAssets'

export const GLOBAL_CAPTURE_INTERVAL_MS = 550
const CAPTURE_RETRY_LIMIT = 1

export interface CaptureTabsApi {
	tabs: Pick<typeof chrome.tabs, 'captureVisibleTab' | 'get' | 'query'>
}

export interface VisiblePngCapture {
	dataUrl: `data:image/png;base64,${string}`
	tab: chrome.tabs.Tab
}

export class CaptureError extends Error {
	constructor(
		readonly code: string,
		message = code,
	) {
		super(message)
		this.name = 'CaptureError'
	}
}

export class GlobalCaptureLimiter {
	private nextStartAt = 0
	private queue: Promise<void> = Promise.resolve()

	constructor(
		private readonly now: () => number = Date.now,
		private readonly wait: (ms: number, signal?: AbortSignal) => Promise<void> = abortableWait,
	) {}

	acquire(signal?: AbortSignal): Promise<void> {
		const turn = this.queue.then(async () => {
			signal?.throwIfAborted()
			const delay = Math.max(0, this.nextStartAt - this.now())
			if (delay > 0) await this.wait(delay, signal)
			signal?.throwIfAborted()
			this.nextStartAt = this.now() + GLOBAL_CAPTURE_INTERVAL_MS
		})
		this.queue = turn.catch(() => undefined)
		return turn
	}

	reset(): void {
		this.nextStartAt = 0
		this.queue = Promise.resolve()
	}
}

export class TabEffectLock {
	private readonly tails = new Map<number, Promise<void>>()

	async runExclusive<T>(tabId: number, callback: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(tabId) ?? Promise.resolve()
		let release!: () => void
		const current = new Promise<void>((resolve) => {
			release = resolve
		})
		const tail = previous.then(() => current)
		this.tails.set(tabId, tail)
		await previous
		try {
			return await callback()
		} finally {
			release()
			if (this.tails.get(tabId) === tail) this.tails.delete(tabId)
		}
	}
}

export const globalCaptureLimiter = new GlobalCaptureLimiter()
export const globalTabEffectLock = new TabEffectLock()

export async function captureVisibleManagedTabPng(args: {
	targetTabId: number
	api?: CaptureTabsApi
	limiter?: GlobalCaptureLimiter
	signal?: AbortSignal
	retryLimit?: 0 | 1
}): Promise<VisiblePngCapture> {
	const api = args.api ?? chrome
	const limiter = args.limiter ?? globalCaptureLimiter
	args.signal?.throwIfAborted()
	let target: chrome.tabs.Tab
	try {
		target = await api.tabs.get(args.targetTabId)
	} catch {
		throw new CaptureError('no_active_tab', 'The target tab is no longer available.')
	}
	if (target.id === undefined || target.windowId === undefined) {
		throw new CaptureError('no_active_tab', 'The target tab is no longer available.')
	}
	if (!target.active) {
		throw new CaptureError(
			'tab_not_visible',
			'The Agent-managed target tab is not currently visible; switch to it before visual observation.',
		)
	}
	const activeBefore = (await api.tabs.query({ active: true, windowId: target.windowId }))[0]
	if (activeBefore?.id !== target.id) {
		throw new CaptureError('tab_changed', 'The active tab changed before capture.')
	}

	let lastError: unknown
	const retryLimit = args.retryLimit ?? CAPTURE_RETRY_LIMIT
	for (let attempt = 0; attempt <= retryLimit; attempt++) {
		await limiter.acquire(args.signal)
		args.signal?.throwIfAborted()
		try {
			const dataUrl = await api.tabs.captureVisibleTab(target.windowId, { format: 'png' })
			if (!dataUrl?.startsWith('data:image/png;base64,')) {
				throw new CaptureError('capture_failed', 'Browser returned an invalid PNG screenshot.')
			}
			const activeAfter = (await api.tabs.query({ active: true, windowId: target.windowId }))[0]
			if (activeAfter?.id !== target.id) {
				throw new CaptureError(
					'tab_changed',
					'The active tab changed while the screenshot was being captured.',
				)
			}
			if (
				typeof target.url === 'string' &&
				typeof activeAfter.url === 'string' &&
				activeAfter.url !== target.url
			) {
				throw new CaptureError(
					'tab_changed',
					'The target tab changed while the screenshot was being captured.',
				)
			}
			return { dataUrl: dataUrl as VisiblePngCapture['dataUrl'], tab: activeAfter }
		} catch (error) {
			lastError = error
			if (error instanceof CaptureError && error.code === 'tab_changed') throw error
			if (attempt >= retryLimit) break
			const active = (await api.tabs.query({ active: true, windowId: target.windowId }))[0]
			if (active?.id !== target.id) throw new CaptureError('tab_changed')
		}
	}
	if (lastError instanceof CaptureError) throw lastError
	throw new CaptureError('capture_failed', errorMessage(lastError))
}

export interface QuestionCropGeometry {
	preparation: VisualCapturePreparation
	frameTopLeftCssPx: { x: number; y: number }
	bitmap: { width: number; height: number }
	contextCssPx?: number
}

export function computeQuestionCrop(args: QuestionCropGeometry): {
	x: number
	y: number
	width: number
	height: number
} {
	const context = args.contextCssPx ?? 24
	const viewport = args.preparation.viewportCssPx
	if (viewport.width <= 0 || viewport.height <= 0)
		throw new CaptureError('capture_geometry_invalid')
	const scaleX = args.bitmap.width / viewport.width
	const scaleY = args.bitmap.height / viewport.height
	if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
		throw new CaptureError('capture_geometry_invalid')
	}
	const rect = args.preparation.localRectCssPx
	const leftCss = args.frameTopLeftCssPx.x + rect.x - context
	const topCss = args.frameTopLeftCssPx.y + rect.y - context
	const rightCss = args.frameTopLeftCssPx.x + rect.x + rect.width + context
	const bottomCss = args.frameTopLeftCssPx.y + rect.y + rect.height + context
	const x = clamp(Math.floor(leftCss * scaleX), 0, args.bitmap.width)
	const y = clamp(Math.floor(topCss * scaleY), 0, args.bitmap.height)
	const right = clamp(Math.ceil(rightCss * scaleX), x, args.bitmap.width)
	const bottom = clamp(Math.ceil(bottomCss * scaleY), y, args.bitmap.height)
	if (right <= x || bottom <= y) throw new CaptureError('capture_geometry_empty')
	return { x, y, width: right - x, height: bottom - y }
}

export async function cropQuestionAsset(args: {
	dataUrl: string
	preparation: VisualCapturePreparation
	frameTopLeftCssPx: { x: number; y: number }
	runId: string
	questionFingerprint: string
	anchorKey: string
	assetId?: string
}): Promise<InternalImageEnvelope> {
	const response = await fetch(args.dataUrl)
	const blob = await response.blob()
	const bitmap = await createImageBitmap(blob)
	try {
		const crop = computeQuestionCrop({
			preparation: args.preparation,
			frameTopLeftCssPx: args.frameTopLeftCssPx,
			bitmap,
		})
		const scale = Math.min(1, 1600 / Math.max(crop.width, crop.height))
		const width = Math.max(1, Math.round(crop.width * scale))
		const height = Math.max(1, Math.round(crop.height * scale))
		const canvas = new OffscreenCanvas(width, height)
		const context = canvas.getContext('2d')
		if (!context) throw new CaptureError('capture_crop_context_unavailable')
		context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
		let bytes = new Uint8Array()
		for (const quality of [0.85, 0.7, 0.55]) {
			const output = await canvas.convertToBlob({ type: 'image/jpeg', quality })
			bytes = new Uint8Array(await output.arrayBuffer())
			if (bytes.byteLength <= IMAGE_ASSET_MAX_BYTES) break
		}
		if (bytes.byteLength > IMAGE_ASSET_MAX_BYTES) {
			throw new CaptureError('capture_asset_too_large')
		}
		return {
			kind: 'question_solver_image_asset',
			assetId: args.assetId ?? crypto.randomUUID(),
			runId: args.runId,
			questionFingerprint: args.questionFingerprint,
			anchorKey: args.anchorKey,
			mimeType: 'image/jpeg',
			base64: bytesToBase64(bytes),
			sha256: await sha256Hex(bytes),
			width,
			height,
			byteLength: bytes.byteLength,
		}
	} finally {
		bitmap.close()
	}
}

export function resetGlobalCaptureStateForTests(): void {
	globalCaptureLimiter.reset()
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
	}
	return btoa(binary)
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value))
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
	return delayWithAbort(ms, signal)
}
