import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { LogLevel } from './AppLogger'
import type { AppPaths } from './AppPaths'
import type { LauncherSettingsStore } from './LauncherSettingsStore'

export type LauncherLogSource = 'agent' | 'llm' | 'tabs' | 'page' | 'chaoxing' | 'config' | 'system'

export type LauncherLogContext = 'background' | 'sidepanel' | 'newtab' | 'hub' | 'content'

export interface LauncherLogEntry {
	id: number
	ts: number
	level: LogLevel
	source: LauncherLogSource
	context: LauncherLogContext
	browserId: string
	message: string
	data?: unknown
}

export interface LauncherLogFilter {
	levels?: LogLevel[]
	sources?: LauncherLogSource[]
	browserIds?: string[]
	sinceTs?: number
	untilTs?: number
	text?: string
	limit?: number
}

interface LauncherLogFile {
	entries: LauncherLogEntry[]
}

interface PendingLogAppend {
	entries: Omit<LauncherLogEntry, 'id'>[]
	resolve: (entries: LauncherLogEntry[]) => void
	reject: (error: unknown) => void
}

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error']
const SENSITIVE_LOG_KEYS = new Set([
	'accesstoken',
	'apikey',
	'apisecret',
	'authorization',
	'authtoken',
	'bearer',
	'bearertoken',
	'clientsecret',
	'idtoken',
	'refreshtoken',
	'secret',
	'token',
	'xapikey',
	'xauthorization',
])

export class LauncherLogStore {
	private readonly filePath: string
	private operationQueue: Promise<void> = Promise.resolve()
	private pendingAppendBatch: PendingLogAppend[] | null = null

	constructor(
		paths: AppPaths,
		private readonly settings: LauncherSettingsStore,
	) {
		this.filePath = paths.dataFile('launcher-logs.json')
	}

	async query(filter: LauncherLogFilter = {}): Promise<LauncherLogEntry[]> {
		return this.enqueue(async () => {
			const entries = await this.readEntries()
			const text = filter.text?.trim().toLowerCase()
			return entries
				.filter((entry) => !filter.levels?.length || filter.levels.includes(entry.level))
				.filter((entry) => !filter.sources?.length || filter.sources.includes(entry.source))
				.filter(
					(entry) => !filter.browserIds?.length || filter.browserIds.includes(entry.browserId),
				)
				.filter((entry) => filter.sinceTs === undefined || entry.ts >= filter.sinceTs)
				.filter((entry) => filter.untilTs === undefined || entry.ts <= filter.untilTs)
				.filter((entry) => !text || entry.message.toLowerCase().includes(text))
				.slice(-(filter.limit ?? 500))
		})
	}

	append(entries: Omit<LauncherLogEntry, 'id'>[]): Promise<LauncherLogEntry[]> {
		if (entries.length === 0) return Promise.resolve([])

		return new Promise((resolve, reject) => {
			const pending = { entries, resolve, reject }
			if (this.pendingAppendBatch) {
				this.pendingAppendBatch.push(pending)
				return
			}

			const batch = [pending]
			this.pendingAppendBatch = batch
			void this.enqueue(() => this.flushAppendBatch(batch))
		})
	}

	async clear(): Promise<void> {
		await this.enqueue(() => this.writeEntries([]))
	}

	async purge(): Promise<void> {
		await this.enqueue(async () => {
			await this.writeEntries(await this.applyRetention(await this.readEntries()))
		})
	}

	private async applyRetention(entries: LauncherLogEntry[]): Promise<LauncherLogEntry[]> {
		const { logs } = await this.settings.get()
		const minimumLevelIndex = LEVEL_ORDER.indexOf(logs.minLevel)
		const cutoff = Date.now() - logs.retentionDays * 24 * 60 * 60 * 1000

		return entries
			.filter((entry) => entry.ts >= cutoff)
			.filter((entry) => LEVEL_ORDER.indexOf(entry.level) >= minimumLevelIndex)
			.sort((a, b) => a.ts - b.ts)
			.slice(-logs.maxEntries)
	}

	private async readEntries(): Promise<LauncherLogEntry[]> {
		try {
			const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<LauncherLogFile>
			return Array.isArray(raw.entries) ? raw.entries : []
		} catch (error) {
			if (error instanceof SyntaxError) {
				await this.quarantineCorruptFile()
				await this.writeEntries([])
				return []
			}
			if (!isMissingFile(error)) {
				throw error
			}
			return []
		}
	}

	private async writeEntries(entries: LauncherLogEntry[]): Promise<void> {
		const temporaryPath = `${this.filePath}.wenxue-${randomUUID()}.tmp`
		try {
			await writeFile(temporaryPath, `${JSON.stringify({ entries }, null, 2)}\n`, {
				encoding: 'utf8',
				flag: 'wx',
				mode: 0o600,
			})
			await rename(temporaryPath, this.filePath)
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined)
			throw error
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationQueue.then(operation)
		this.operationQueue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	private async flushAppendBatch(pending: PendingLogAppend[]): Promise<void> {
		if (this.pendingAppendBatch === pending) this.pendingAppendBatch = null
		try {
			const current = await this.readEntries()
			let nextId = current.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
			const batches = pending.map(({ entries }) =>
				entries.map((entry) => ({
					...entry,
					id: nextId++,
					message: sanitizeLogMessage(entry.message),
					data: sanitizeLogData(entry.data),
				})),
			)
			await this.writeEntries(await this.applyRetention([...current, ...batches.flat()]))
			pending.forEach(({ resolve }, index) => resolve(batches[index] ?? []))
		} catch (error) {
			pending.forEach(({ reject }) => reject(error))
		}
	}

	private async quarantineCorruptFile(): Promise<void> {
		try {
			await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
		} catch (error) {
			if (!isMissingFile(error)) {
				throw error
			}
		}
	}
}

export function sanitizeLogMessage(message: string): string {
	const withoutBearer = message.replace(/\bBearer\s+\S+/gi, '[redacted]')
	const withoutAssignments = withoutBearer.replace(
		/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer[_-]?token|token)=([^&\s]+)/gi,
		(_match, key: string) => `${key}=[redacted]`,
	)
	return withoutAssignments.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
		try {
			const url = new URL(candidate)
			url.username = ''
			url.password = ''
			for (const key of Array.from(url.searchParams.keys())) {
				if (isSensitiveLogKey(key)) url.searchParams.set(key, '[redacted]')
			}
			return url.toString()
		} catch {
			return candidate
		}
	})
}

function sanitizeLogData(value: unknown): unknown {
	if (typeof value === 'string') {
		return sanitizeLogMessage(value)
	}
	if (Array.isArray(value)) {
		return value.map(sanitizeLogData)
	}
	if (value && typeof value === 'object') {
		const clean: Record<string, unknown> = {}
		for (const [key, child] of Object.entries(value)) {
			if (isSensitiveLogKey(key)) {
				clean[key] = '[redacted]'
			} else {
				clean[key] = sanitizeLogData(child)
			}
		}
		return clean
	}
	return value
}

function isSensitiveLogKey(key: string): boolean {
	return SENSITIVE_LOG_KEYS.has(key.toLowerCase().replace(/[-_\s]/g, ''))
}

function isMissingFile(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
