import { strings } from './strings'

export interface LauncherCaptchaToken {
	captcha_token: string
	expires_in: number
}

interface CaptchaApi {
	createCaptchaData: (params: { state: string }) => Promise<unknown>
	verifyCaptchaData: (params: { token: string; key: string }) => Promise<unknown>
}

export interface LauncherCaptchaSnapshot {
	id: number
	image: string
	status: 'ready' | 'refreshing' | 'verifying'
	error: 'invalid' | 'unavailable' | null
}

interface PendingCaptcha {
	id: number
	state: string
	token: string
	resolve: (value: LauncherCaptchaToken) => void
	reject: (error: Error) => void
}

const CAPTCHA_NETWORK_TIMEOUT_MS = 12_000
const listeners = new Set<() => void>()
let api: CaptchaApi | null = null
let pending: PendingCaptcha | null = null
let snapshot: LauncherCaptchaSnapshot | null = null
let nextId = 0

export function configureLauncherCaptcha(nextApi: CaptchaApi): void {
	api = nextApi
}

export function subscribeLauncherCaptcha(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export function getLauncherCaptchaSnapshot(): LauncherCaptchaSnapshot | null {
	return snapshot
}

function publish(next: LauncherCaptchaSnapshot | null): void {
	snapshot = next
	listeners.forEach((listener) => listener())
}

class LauncherCaptchaError extends Error {
	constructor(readonly kind: 'cancelled' | 'unavailable') {
		super(strings.auth.captcha[kind])
	}
}

function captchaError(kind: 'cancelled' | 'unavailable'): LauncherCaptchaError {
	return new LauncherCaptchaError(kind)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isRasterImage(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= 2_000_000 &&
		/^data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[a-z\d+/]+={0,2}$/i.test(value)
	)
}

export function requestLauncherCaptcha(url: string): Promise<LauncherCaptchaToken> {
	if (pending || !api) return Promise.reject(captchaError('unavailable'))
	const separator = url.indexOf('?')
	const image = url.slice(0, separator)
	const params = new URLSearchParams(url.slice(separator + 1))
	const token = params.get('token')
	const state = params.get('state')
	if (separator < 0 || !isRasterImage(image) || !token || !state) {
		return Promise.reject(captchaError('unavailable'))
	}
	return new Promise((resolve, reject) => {
		const id = ++nextId
		pending = { id, token, state, resolve, reject }
		publish({ id, image, status: 'ready', error: null })
	})
}

export function cancelLauncherCaptcha(): void {
	if (!pending) return
	const challenge = pending
	pending = null
	publish(null)
	challenge.reject(captchaError('cancelled'))
}

async function withCaptchaNetworkTimeout<T>(operation: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(captchaError('unavailable')), CAPTCHA_NETWORK_TIMEOUT_MS)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

export async function refreshLauncherCaptcha(): Promise<void> {
	const challenge = pending
	if (!challenge || !api || snapshot?.status !== 'ready') return
	publish({ ...snapshot, status: 'refreshing', error: null })
	try {
		const result = await withCaptchaNetworkTimeout(
			api.createCaptchaData({ state: challenge.state }),
		)
		if (pending !== challenge) return
		if (!isRecord(result) || !isRasterImage(result.data) || typeof result.token !== 'string') {
			throw captchaError('unavailable')
		}
		if (!result.token) throw captchaError('unavailable')
		challenge.token = result.token
		publish({ id: challenge.id, image: result.data, status: 'ready', error: null })
	} catch {
		if (pending === challenge && snapshot) {
			publish({ ...snapshot, status: 'ready', error: 'unavailable' })
		}
	}
}

export async function submitLauncherCaptcha(key: string): Promise<void> {
	const challenge = pending
	if (!challenge || !api || snapshot?.status !== 'ready') return
	if (!key.trim() || key.length > 32) {
		publish({ ...snapshot, error: 'invalid' })
		return
	}
	publish({ ...snapshot, status: 'verifying', error: null })
	try {
		const result = await withCaptchaNetworkTimeout(
			api.verifyCaptchaData({ token: challenge.token, key: key.trim() }),
		)
		if (pending !== challenge) return
		if (
			!isRecord(result) ||
			typeof result.captcha_token !== 'string' ||
			!result.captcha_token ||
			typeof result.expires_in !== 'number' ||
			!Number.isFinite(result.expires_in) ||
			result.expires_in <= 0
		) {
			throw captchaError('unavailable')
		}
		pending = null
		publish(null)
		challenge.resolve({ captcha_token: result.captcha_token, expires_in: result.expires_in })
	} catch (error) {
		if (pending === challenge && snapshot) {
			publish({
				...snapshot,
				status: 'ready',
				error: error instanceof LauncherCaptchaError ? 'unavailable' : 'invalid',
			})
		}
	}
}

export function withCaptchaAwareTimeout<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
	timeoutError: () => Error,
): Promise<T> {
	return new Promise((resolve, reject) => {
		let remaining = timeoutMs
		let startedAt = Date.now()
		let timer: ReturnType<typeof setTimeout> | undefined
		let settled = false
		const cleanup = () => {
			settled = true
			clearTimeout(timer)
			unsubscribe()
		}
		const updateTimer = () => {
			if (settled) return
			if (timer !== undefined) {
				remaining -= Date.now() - startedAt
				clearTimeout(timer)
				timer = undefined
			}
			if (pending) return
			startedAt = Date.now()
			timer = setTimeout(
				() => {
					cleanup()
					reject(timeoutError())
				},
				Math.max(0, remaining),
			)
		}
		const unsubscribe = subscribeLauncherCaptcha(updateTimer)
		updateTimer()
		Promise.resolve()
			.then(operation)
			.then(
				(result) => {
					cleanup()
					resolve(result)
				},
				(error: unknown) => {
					cleanup()
					reject(error)
				},
			)
	})
}
