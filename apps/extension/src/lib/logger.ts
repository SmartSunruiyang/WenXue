import { redact, redactLogMessage } from './logRedaction'
import { appendBatch } from './logStore'
import type { LogContext, LogDraft, LogLevel, LogSource } from './logTypes'

export interface LoggerConfig {
	context: LogContext
	sink: 'direct' | 'message'
	flushSize?: number
	flushMs?: number
}

const DEFAULT_FLUSH_SIZE = 20
const DEFAULT_FLUSH_MS = 1000

let config: LoggerConfig | null = null
const buffer: LogDraft[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function getConfig(): LoggerConfig {
	if (!config) {
		// Fallback: treat as background with direct sink (should be configured before use)
		return { context: 'background', sink: 'direct' }
	}
	return config
}

function scheduleFlush(): void {
	if (flushTimer !== null) return
	const cfg = getConfig()
	const ms = cfg.flushMs ?? DEFAULT_FLUSH_MS
	flushTimer = setTimeout(() => {
		flushTimer = null
		flush().catch(() => {})
	}, ms)
}

async function flush(): Promise<void> {
	if (buffer.length === 0) return
	const batch = buffer.splice(0)
	const cfg = getConfig()

	try {
		if (cfg.sink === 'direct') {
			await appendBatch(batch)
		} else {
			await chrome.runtime.sendMessage({ type: 'LOG_APPEND', entries: batch })
		}
	} catch {
		// Swallow: logging is a side-channel, never disrupt main flow
	}
}

function emit(level: LogLevel, source: LogSource, message: string, data?: unknown): void {
	const cfg = getConfig()
	const entry: LogDraft = {
		ts: Date.now(),
		level,
		source,
		context: cfg.context,
		message: redactLogMessage(message),
		data: data !== undefined ? redact(data) : undefined,
	}

	buffer.push(entry)

	const threshold = cfg.flushSize ?? DEFAULT_FLUSH_SIZE
	if (buffer.length >= threshold) {
		if (flushTimer !== null) {
			clearTimeout(flushTimer)
			flushTimer = null
		}
		flush().catch(() => {})
	} else {
		scheduleFlush()
	}
}

/** Flush remaining entries on page hide / unload. */
function onPageHide(): void {
	if (flushTimer !== null) {
		clearTimeout(flushTimer)
		flushTimer = null
	}
	// Fire-and-forget: best-effort on teardown
	flush().catch(() => {})
}

let visibilityListenerInstalled = false

function ensureVisibilityListener(): void {
	if (visibilityListenerInstalled) return
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') onPageHide()
		})
		window.addEventListener('pagehide', onPageHide)
		visibilityListenerInstalled = true
	}
}

/** Configure the logger for the current runtime context. Call once at startup. */
export function configureLogger(cfg: LoggerConfig): void {
	config = cfg
	ensureVisibilityListener()
}

/** Force-flush any buffered log entries. Useful before teardown. */
export async function flushLogger(): Promise<void> {
	if (flushTimer !== null) {
		clearTimeout(flushTimer)
		flushTimer = null
	}
	await flush()
}

export const logger = {
	debug(source: LogSource, message: string, data?: unknown): void {
		emit('debug', source, message, data)
	},
	info(source: LogSource, message: string, data?: unknown): void {
		emit('info', source, message, data)
	},
	warn(source: LogSource, message: string, data?: unknown): void {
		emit('warn', source, message, data)
	},
	error(source: LogSource, message: string, data?: unknown): void {
		emit('error', source, message, data)
	},
}
