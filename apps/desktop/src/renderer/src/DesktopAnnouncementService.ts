import type { ClientAnnouncementView } from '@wenxue/client-operations'
import { watchDesktopSignal, type DesktopSignalWatcher } from './cloudbase'

const POLL_INTERVAL_MS = 15 * 60 * 1000
const INITIAL_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647

export interface DesktopAnnouncementSession {
	userId: string
	accessToken: string
	refreshToken?: string
	expiresAt?: number
	gatewayBaseUrl: string
}

export interface DesktopAnnouncementSnapshot {
	current: ClientAnnouncementView | null
	queueLength: number
	error?: string
}

export interface DesktopAnnouncementServiceOptions {
	fetchImpl?: typeof fetch
	refreshSession?: (
		current: DesktopAnnouncementSession,
	) => Promise<DesktopAnnouncementSession | null>
	watchSignal?: (
		documentId: string,
		callbacks: {
			onChange: (snapshot: unknown) => void
			onError: (error: unknown) => void
		},
	) => DesktopSignalWatcher
	setTimeoutImpl?: typeof setTimeout
	clearTimeoutImpl?: typeof clearTimeout
	setIntervalImpl?: typeof setInterval
	clearIntervalImpl?: typeof clearInterval
	now?: () => number
}

type AnnouncementListener = (snapshot: DesktopAnnouncementSnapshot) => void
interface AnnouncementContext {
	session: DesktopAnnouncementSession
	platform: 'darwin' | 'win32'
	version: string
}

interface AnnouncementSignalSubscription {
	documentId: string
	generation: number
	watcher: DesktopSignalWatcher | null
	reconnectTimer: ReturnType<typeof setTimeout> | null
	reconnectDelay: number
	lastRevision: number | null
}

export class DesktopAnnouncementService {
	private readonly fetchImpl: typeof fetch
	private readonly refreshSession: DesktopAnnouncementServiceOptions['refreshSession']
	private readonly watchSignal: NonNullable<DesktopAnnouncementServiceOptions['watchSignal']>
	private readonly setTimeoutImpl: typeof setTimeout
	private readonly clearTimeoutImpl: typeof clearTimeout
	private readonly setIntervalImpl: typeof setInterval
	private readonly clearIntervalImpl: typeof clearInterval
	private readonly now: () => number
	private readonly listeners = new Set<AnnouncementListener>()
	private context: AnnouncementContext | null = null
	private refreshRequest: {
		context: AnnouncementContext
		promise: Promise<DesktopAnnouncementSession>
	} | null = null
	private queue: ClientAnnouncementView[] = []
	private signalSubscriptions: AnnouncementSignalSubscription[] = []
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private expiryTimer: ReturnType<typeof setTimeout> | null = null
	private generation = 0
	private requestSequence = 0
	private error: string | undefined

	constructor(options: DesktopAnnouncementServiceOptions = {}) {
		this.fetchImpl = options.fetchImpl ?? fetch
		this.refreshSession = options.refreshSession
		this.watchSignal =
			options.watchSignal ??
			((documentId, callbacks) =>
				watchDesktopSignal('desktop_announcement_signal', documentId, callbacks))
		this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout
		this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout
		this.setIntervalImpl = options.setIntervalImpl ?? setInterval
		this.clearIntervalImpl = options.clearIntervalImpl ?? clearInterval
		this.now = options.now ?? Date.now
	}

	async start(
		session: DesktopAnnouncementSession,
		platform: 'darwin' | 'win32',
		version: string,
	): Promise<void> {
		this.stop()
		const generation = this.generation
		const accountSignalId = await announcementAccountSignalId(session.userId)
		if (generation !== this.generation) return
		this.context = { session, platform, version }
		this.signalSubscriptions = ['global', accountSignalId].map((documentId) => ({
			documentId,
			generation,
			watcher: null,
			reconnectTimer: null,
			reconnectDelay: INITIAL_RECONNECT_MS,
			lastRevision: null,
		}))
		this.error = undefined
		this.startPolling()
		this.openWatchers()
		await this.refresh()
	}

	stop(): void {
		this.generation += 1
		this.requestSequence += 1
		this.context = null
		this.queue = []
		this.error = undefined
		this.closeSignalSubscriptions()
		if (this.pollTimer) {
			this.clearIntervalImpl(this.pollTimer)
			this.pollTimer = null
		}
		this.clearExpiryTimer()
		this.notify()
	}

	current(): ClientAnnouncementView | null {
		return this.queue[0] ?? null
	}

	subscribe(listener: AnnouncementListener): () => void {
		this.listeners.add(listener)
		listener(this.snapshot())
		return () => this.listeners.delete(listener)
	}

	async acknowledge(announcementId: string): Promise<void> {
		const context = this.context
		if (!context) throw new Error('消息会话已结束，请重新登录后重试。')
		if (!this.queue.some((announcement) => announcement.id === announcementId)) return

		const response = await this.authorizedFetch(
			context,
			`${normalizeGatewayBaseUrl(context.session.gatewayBaseUrl)}/v1/client/announcement-ack`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({ announcementId }),
			},
		)
		if (!response.ok && response.status !== 404 && response.status !== 410) {
			throw new Error(await readApiError(response, `消息确认失败 (${response.status})`))
		}

		if (this.context !== context) return
		this.queue = this.queue.filter((announcement) => announcement.id !== announcementId)
		this.error = undefined
		this.scheduleExpiry()
		this.notify()
		void this.refresh().catch(() => undefined)
	}

	private async refresh(): Promise<void> {
		const context = this.context
		if (!context) return
		const generation = this.generation
		const requestSequence = ++this.requestSequence
		const url = new URL(
			`${normalizeGatewayBaseUrl(context.session.gatewayBaseUrl)}/v1/client/announcements/pending`,
		)
		url.searchParams.set('platform', context.platform)
		url.searchParams.set('version', context.version)

		try {
			const response = await this.authorizedFetch(context, url)
			if (!response.ok) {
				throw new Error(await readApiError(response, `消息同步失败 (${response.status})`))
			}
			const queue = readAnnouncementQueue(await response.json())
			if (
				generation !== this.generation ||
				requestSequence !== this.requestSequence ||
				this.context !== context
			) {
				return
			}
			this.queue = sortAnnouncements(queue)
				.filter((announcement) => Date.parse(announcement.expiresAt) > this.now())
				.slice(0, 10)
			this.error = undefined
			this.scheduleExpiry()
			this.notify()
		} catch (error) {
			if (
				generation !== this.generation ||
				requestSequence !== this.requestSequence ||
				this.context !== context
			) {
				return
			}
			this.error = toMessage(error, '消息同步失败，请检查网络后重试。')
			this.notify()
			throw error
		}
	}

	private startPolling(): void {
		this.pollTimer = this.setIntervalImpl(() => {
			void this.refresh().catch(() => undefined)
		}, POLL_INTERVAL_MS)
	}

	private openWatchers(): void {
		this.signalSubscriptions.forEach((subscription) => this.openWatcher(subscription))
	}

	private openWatcher(subscription: AnnouncementSignalSubscription): void {
		if (!this.isActiveSubscription(subscription) || subscription.watcher) return
		try {
			subscription.watcher = this.watchSignal(subscription.documentId, {
				onChange: (snapshot) => this.handleSignalChange(subscription, snapshot),
				onError: (error) => this.handleWatchError(subscription, error),
			})
		} catch (error) {
			this.handleWatchError(subscription, error)
		}
	}

	private handleSignalChange(
		subscription: AnnouncementSignalSubscription,
		snapshot: unknown,
	): void {
		if (!this.isActiveSubscription(subscription)) return
		subscription.reconnectDelay = INITIAL_RECONNECT_MS
		const revision = readSignalRevision(snapshot)
		if (revision !== null && subscription.lastRevision === revision) return
		subscription.lastRevision = revision
		void this.refresh().catch(() => undefined)
	}

	private handleWatchError(subscription: AnnouncementSignalSubscription, error: unknown): void {
		if (!this.isActiveSubscription(subscription)) return
		this.closeWatcher(subscription)
		this.error = toMessage(error, '消息实时连接已断开，正在自动重连。')
		this.notify()
		if (subscription.reconnectTimer) return
		const delay = subscription.reconnectDelay
		subscription.reconnectDelay = Math.min(subscription.reconnectDelay * 2, MAX_RECONNECT_MS)
		subscription.reconnectTimer = this.setTimeoutImpl(() => {
			subscription.reconnectTimer = null
			this.openWatcher(subscription)
		}, delay)
	}

	private closeWatcher(subscription: AnnouncementSignalSubscription): void {
		const watcher = subscription.watcher
		subscription.watcher = null
		if (!watcher) return
		void Promise.resolve(watcher.close()).catch(() => undefined)
	}

	private closeSignalSubscriptions(): void {
		for (const subscription of this.signalSubscriptions) {
			this.closeWatcher(subscription)
			if (subscription.reconnectTimer) {
				this.clearTimeoutImpl(subscription.reconnectTimer)
				subscription.reconnectTimer = null
			}
		}
		this.signalSubscriptions = []
	}

	private isActiveSubscription(subscription: AnnouncementSignalSubscription): boolean {
		return (
			this.context !== null &&
			subscription.generation === this.generation &&
			this.signalSubscriptions.includes(subscription)
		)
	}

	private scheduleExpiry(): void {
		this.clearExpiryTimer()
		if (!this.context || this.queue.length === 0) return
		const now = this.now()
		const nextExpiry = Math.min(
			...this.queue.map((announcement) => Date.parse(announcement.expiresAt)),
		)
		if (!Number.isFinite(nextExpiry)) return
		const expire = () => {
			this.expiryTimer = null
			const currentTime = this.now()
			const nextQueue = this.queue.filter(
				(announcement) => Date.parse(announcement.expiresAt) > currentTime,
			)
			if (nextQueue.length !== this.queue.length) {
				this.queue = nextQueue
				this.notify()
			}
			this.scheduleExpiry()
		}
		if (nextExpiry <= now) {
			expire()
			return
		}
		this.expiryTimer = this.setTimeoutImpl(expire, Math.min(nextExpiry - now, MAX_TIMEOUT_DELAY_MS))
	}

	private clearExpiryTimer(): void {
		if (!this.expiryTimer) return
		this.clearTimeoutImpl(this.expiryTimer)
		this.expiryTimer = null
	}

	private async fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const controller = new AbortController()
		const timeout = this.setTimeoutImpl(() => controller.abort(), REQUEST_TIMEOUT_MS)
		try {
			const response = await this.fetchImpl(input, {
				...init,
				redirect: 'error',
				signal: controller.signal,
			})
			const body = await response.arrayBuffer()
			return new Response(body.byteLength > 0 ? body : null, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			})
		} finally {
			this.clearTimeoutImpl(timeout)
		}
	}

	private async authorizedFetch(
		context: AnnouncementContext,
		input: RequestInfo | URL,
		init: RequestInit = {},
	): Promise<Response> {
		const request = (accessToken: string) => {
			const headers = new Headers(init.headers)
			headers.set('authorization', `Bearer ${accessToken}`)
			return this.fetchWithTimeout(input, {
				...init,
				headers,
			})
		}
		let response = await request(context.session.accessToken)
		if (response.status !== 401 || !this.refreshSession || this.context !== context) return response
		const refreshed = await this.refreshAuthorizedSession(context)
		if (this.context !== context) return response
		response = await request(refreshed.accessToken)
		return response
	}

	private refreshAuthorizedSession(
		context: AnnouncementContext,
	): Promise<DesktopAnnouncementSession> {
		if (this.refreshRequest?.context === context) return this.refreshRequest.promise
		const promise = Promise.resolve(this.refreshSession?.(context.session))
			.then((session) => {
				if (!session || session.userId !== context.session.userId) {
					throw new Error('消息登录凭证已失效，请重新登录。')
				}
				if (this.context === context) context.session = session
				return session
			})
			.finally(() => {
				if (this.refreshRequest?.context === context) this.refreshRequest = null
			})
		this.refreshRequest = { context, promise }
		return promise
	}

	private snapshot(): DesktopAnnouncementSnapshot {
		return {
			current: this.current(),
			queueLength: this.queue.length,
			...(this.error ? { error: this.error } : {}),
		}
	}

	private notify(): void {
		const snapshot = this.snapshot()
		this.listeners.forEach((listener) => listener(snapshot))
	}
}

function readAnnouncementQueue(value: unknown): ClientAnnouncementView[] {
	if (!isRecord(value) || !Array.isArray(value.announcements)) {
		throw new Error('消息服务返回了无效数据，请稍后重试。')
	}
	if (!value.announcements.every(isAnnouncementView)) {
		throw new Error('消息服务返回了无效消息，请稍后重试。')
	}
	return value.announcements
}

async function announcementAccountSignalId(userId: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId))
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
		'',
	)
	return `user:${hex}`
}

function isAnnouncementView(value: unknown): value is ClientAnnouncementView {
	if (!isRecord(value)) return false
	return (
		typeof value.id === 'string' &&
		(value.importance === 'normal' || value.importance === 'important') &&
		typeof value.title === 'string' &&
		typeof value.body === 'string' &&
		typeof value.publishedAt === 'string' &&
		typeof value.expiresAt === 'string' &&
		(value.detailUrl === undefined || isHttpsUrl(value.detailUrl))
	)
}

function sortAnnouncements(queue: ClientAnnouncementView[]): ClientAnnouncementView[] {
	return [...queue].sort((left, right) => {
		if (left.importance !== right.importance) return left.importance === 'important' ? -1 : 1
		return Date.parse(left.publishedAt) - Date.parse(right.publishedAt)
	})
}

function readSignalRevision(snapshot: unknown): number | null {
	if (!isRecord(snapshot) || !Array.isArray(snapshot.docs)) return null
	for (const document of snapshot.docs) {
		if (isRecord(document) && typeof document.revision === 'number') return document.revision
	}
	return null
}

async function readApiError(response: Response, fallback: string): Promise<string> {
	try {
		const value: unknown = await response.json()
		if (!isRecord(value)) return fallback
		if (typeof value.message === 'string') return value.message
		if (isRecord(value.error) && typeof value.error.message === 'string') return value.error.message
		return fallback
	} catch {
		return fallback
	}
}

function normalizeGatewayBaseUrl(value: string): string {
	return value.replace(/\/+$/, '')
}

function isHttpsUrl(value: unknown): boolean {
	if (typeof value !== 'string') return false
	try {
		return new URL(value).protocol === 'https:'
	} catch {
		return false
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback
}
