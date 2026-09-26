import { watchDesktopSignal, type DesktopSignalWatcher } from './cloudbase'

const INITIAL_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 60_000
const SIGNAL_JITTER_MAX_MS = 60_000

export interface DesktopReleaseSignalServiceOptions {
	checkForUpdates?: (reason: 'signal') => Promise<unknown>
	watchSignal?: (
		documentId: string,
		callbacks: {
			onChange: (snapshot: unknown) => void
			onError: (error: unknown) => void
		},
	) => DesktopSignalWatcher
	setTimeoutImpl?: typeof setTimeout
	clearTimeoutImpl?: typeof clearTimeout
	random?: () => number
}

export class DesktopReleaseSignalService {
	private readonly checkForUpdates: (reason: 'signal') => Promise<unknown>
	private readonly watchSignal: NonNullable<DesktopReleaseSignalServiceOptions['watchSignal']>
	private readonly setTimeoutImpl: typeof setTimeout
	private readonly clearTimeoutImpl: typeof clearTimeout
	private readonly random: () => number
	private watcher: DesktopSignalWatcher | null = null
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private signalCheckTimer: ReturnType<typeof setTimeout> | null = null
	private checkInFlight = false
	private trailingCheck = false
	private documentId: string | null = null
	private lastRevision: number | null = null
	private reconnectDelay = INITIAL_RECONNECT_MS
	private generation = 0

	constructor(options: DesktopReleaseSignalServiceOptions = {}) {
		this.checkForUpdates =
			options.checkForUpdates ?? ((reason) => window.wenxue.updates.check(reason))
		this.watchSignal =
			options.watchSignal ??
			((documentId, callbacks) =>
				watchDesktopSignal('desktop_release_signal', documentId, callbacks))
		this.setTimeoutImpl = options.setTimeoutImpl ?? globalThis.setTimeout.bind(globalThis)
		this.clearTimeoutImpl = options.clearTimeoutImpl ?? globalThis.clearTimeout.bind(globalThis)
		this.random = options.random ?? Math.random
	}

	start(runtime: 'electron' | 'chromium', channel: 'dev' | 'beta' | 'stable'): void {
		this.stop()
		this.documentId = `${runtime}:${channel}`
		this.openWatcher()
	}

	stop(): void {
		this.generation += 1
		this.checkInFlight = false
		this.trailingCheck = false
		this.documentId = null
		this.lastRevision = null
		this.reconnectDelay = INITIAL_RECONNECT_MS
		this.closeWatcher()
		if (this.reconnectTimer) {
			this.clearTimeoutImpl(this.reconnectTimer)
			this.reconnectTimer = null
		}
		if (this.signalCheckTimer) {
			this.clearTimeoutImpl(this.signalCheckTimer)
			this.signalCheckTimer = null
		}
	}

	resume(): void {
		if (!this.documentId) return
		this.scheduleCheck(0)
	}

	private openWatcher(): void {
		const documentId = this.documentId
		if (!documentId || this.watcher) return
		const generation = this.generation
		try {
			this.watcher = this.watchSignal(documentId, {
				onChange: (snapshot) => this.handleSignalChange(snapshot, generation, documentId),
				onError: () => this.handleWatchError(generation, documentId),
			})
		} catch {
			this.handleWatchError(generation, documentId)
		}
	}

	private handleSignalChange(snapshot: unknown, generation: number, documentId: string): void {
		if (generation !== this.generation || documentId !== this.documentId) return
		this.reconnectDelay = INITIAL_RECONNECT_MS
		const revision = readSignalRevision(snapshot)
		if (revision === null) return
		if (this.lastRevision === null) {
			this.lastRevision = revision
			return
		}
		if (revision === this.lastRevision) return
		this.lastRevision = revision
		const random = Math.max(0, Math.min(0.999_999, this.random()))
		this.scheduleCheck(Math.floor(random * SIGNAL_JITTER_MAX_MS))
	}

	private scheduleCheck(delayMs: number): void {
		if (this.checkInFlight) {
			this.trailingCheck = true
			return
		}
		if (this.signalCheckTimer) {
			if (delayMs !== 0) return
			this.clearTimeoutImpl(this.signalCheckTimer)
			this.signalCheckTimer = null
		}
		const generation = this.generation
		const documentId = this.documentId
		this.signalCheckTimer = this.setTimeoutImpl(() => {
			this.signalCheckTimer = null
			if (generation !== this.generation || documentId !== this.documentId) return
			this.checkInFlight = true
			void this.checkForUpdates('signal')
				.catch(() => undefined)
				.finally(() => {
					if (generation !== this.generation) return
					this.checkInFlight = false
					if (this.trailingCheck) {
						this.trailingCheck = false
						this.scheduleCheck(0)
					}
				})
		}, delayMs)
	}

	private handleWatchError(generation: number, documentId: string): void {
		if (generation !== this.generation || documentId !== this.documentId) return
		this.closeWatcher()
		if (this.reconnectTimer) return
		const delay = this.reconnectDelay
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS)
		this.reconnectTimer = this.setTimeoutImpl(() => {
			if (generation !== this.generation || documentId !== this.documentId) return
			this.reconnectTimer = null
			this.openWatcher()
		}, delay)
	}

	private closeWatcher(): void {
		const watcher = this.watcher
		this.watcher = null
		if (!watcher) return
		void Promise.resolve(watcher.close()).catch(() => undefined)
	}
}

function readSignalRevision(snapshot: unknown): number | null {
	if (!isRecord(snapshot) || !Array.isArray(snapshot.docs)) return null
	for (const document of snapshot.docs) {
		if (isRecord(document) && typeof document.revision === 'number') return document.revision
	}
	return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
