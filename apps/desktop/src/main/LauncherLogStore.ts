import { readFile, writeFile } from 'node:fs/promises'
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

	constructor(
		paths: AppPaths,
		private readonly settings: LauncherSettingsStore,
	) {
		this.filePath = paths.dataFile('launcher-logs.json')
	}

	async query(filter: LauncherLogFilter = {}): Promise<LauncherLogEntry[]> {
		const entries = await this.readEntries()
		const text = filter.text?.trim().toLowerCase()
		return entries
			.filter((entry) => !filter.levels?.length || filter.levels.includes(entry.level))
			.filter((entry) => !filter.sources?.length || filter.sources.includes(entry.source))
			.filter((entry) => !filter.browserIds?.length || filter.browserIds.includes(entry.browserId))
			.filter((entry) => filter.sinceTs === undefined || entry.ts >= filter.sinceTs)
			.filter((entry) => filter.untilTs === undefined || entry.ts <= filter.untilTs)
			.filter((entry) => !text || entry.message.toLowerCase().includes(text))
			.slice(-(filter.limit ?? 500))
	}

	async append(entries: Omit<LauncherLogEntry, 'id'>[]): Promise<LauncherLogEntry[]> {
		const current = await this.readEntries()
		let nextId = current.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
		const appended = entries.map((entry) => ({
			...entry,
			id: nextId++,
			data: sanitizeLogData(entry.data),
		}))
		const next = await this.applyRetention([...current, ...appended])
		await this.writeEntries(next)
		return appended
	}

	async clear(): Promise<void> {
		await this.writeEntries([])
	}

	async purge(): Promise<void> {
		await this.writeEntries(await this.applyRetention(await this.readEntries()))
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
			if (!isMissingFile(error)) {
				throw error
			}
			return []
		}
	}

	private async writeEntries(entries: LauncherLogEntry[]): Promise<void> {
		await writeFile(this.filePath, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8')
	}
}

function sanitizeLogData(value: unknown): unknown {
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
