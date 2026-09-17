import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { LogLevel } from './AppLogger'
import type { AppPaths } from './AppPaths'

export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export interface LauncherSettings {
	launch: {
		windowWidth: number
		windowHeight: number
		startUrl: string
		concurrencyLimit: number
		staggerMs: number
		profileType: 'persistent' | 'incognito'
		proxyMode: 'none' | 'system' | 'custom'
		language: string
		zoom: number
	}
	behavior: {
		closeAction: 'ask' | 'minimizeToTray' | 'quit'
		exitWithBrowsers: 'ask' | 'launcherOnly' | 'closeBrowsers'
		openAtLogin: boolean
		downloadDir: string
	}
	logs: {
		retentionDays: number
		maxEntries: number
		minLevel: LogLevel
		captureLlmRequests: boolean
		captureLlmResponses: boolean
		defaultExportFormat: 'json' | 'ndjson' | 'text'
	}
	localUser: {
		displayName: string
		colorKey: string
	}
}

export const DEFAULT_LAUNCHER_SETTINGS: LauncherSettings = {
	launch: {
		windowWidth: 1280,
		windowHeight: 820,
		startUrl: 'chrome://newtab',
		concurrencyLimit: 3,
		staggerMs: 400,
		profileType: 'persistent',
		proxyMode: 'none',
		language: 'zh-CN',
		zoom: 100,
	},
	behavior: {
		closeAction: 'ask',
		exitWithBrowsers: 'ask',
		openAtLogin: false,
		downloadDir: '',
	},
	logs: {
		retentionDays: 3,
		maxEntries: 5000,
		minLevel: 'info',
		captureLlmRequests: true,
		captureLlmResponses: false,
		defaultExportFormat: 'json',
	},
	localUser: {
		displayName: '本地用户',
		colorKey: 'purple',
	},
}

const SETTINGS_VERSION = 1

export class LauncherSettingsStore {
	private readonly filePath: string
	private operationQueue: Promise<void> = Promise.resolve()

	constructor(paths: AppPaths) {
		this.filePath = paths.dataFile('settings.json')
	}

	async get(): Promise<LauncherSettings> {
		return this.enqueue(() => this.readSettings())
	}

	async update(patch: DeepPartial<LauncherSettings>): Promise<LauncherSettings> {
		return this.enqueue(async () => {
			assertSettingsPatch(patch)
			const next = mergeSettings(await this.readSettings(), patch)
			assertValidSettings(next)
			await this.writeSettings(next)
			return next
		})
	}

	private async readSettings(): Promise<LauncherSettings> {
		try {
			const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
			if (!isRecord(raw)) throw new SettingsValidationError('settings root must be an object')
			if (raw.version !== undefined && raw.version !== SETTINGS_VERSION) {
				throw new SettingsValidationError('unsupported settings version')
			}
			const patch = { ...raw }
			delete patch.version
			assertSettingsPatch(patch)
			const settings = mergeSettings(DEFAULT_LAUNCHER_SETTINGS, patch)
			assertValidSettings(settings)
			return settings
		} catch (error) {
			if (isMissingFile(error)) return structuredClone(DEFAULT_LAUNCHER_SETTINGS)
			if (!(error instanceof SyntaxError) && !(error instanceof SettingsValidationError))
				throw error
			await this.quarantineInvalidFile()
			return structuredClone(DEFAULT_LAUNCHER_SETTINGS)
		}
	}

	private async writeSettings(settings: LauncherSettings): Promise<void> {
		const temporaryPath = `${this.filePath}.wenxue-${randomUUID()}.tmp`
		try {
			await writeFile(
				temporaryPath,
				`${JSON.stringify({ version: SETTINGS_VERSION, ...settings }, null, 2)}\n`,
				{
					encoding: 'utf8',
					flag: 'wx',
					mode: 0o600,
				},
			)
			await rename(temporaryPath, this.filePath)
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined)
			throw error
		}
	}

	private async quarantineInvalidFile(): Promise<void> {
		try {
			await rename(this.filePath, `${this.filePath}.invalid-${Date.now()}`)
		} catch (error) {
			if (!isMissingFile(error)) throw error
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
}

function mergeSettings(
	base: LauncherSettings,
	patch: DeepPartial<LauncherSettings>,
): LauncherSettings {
	return {
		launch: { ...base.launch, ...patch.launch },
		behavior: { ...base.behavior, ...patch.behavior },
		logs: { ...base.logs, ...patch.logs },
		localUser: { ...base.localUser, ...patch.localUser },
	}
}

class SettingsValidationError extends Error {}

const SECTION_KEYS = ['launch', 'behavior', 'logs', 'localUser'] as const

function assertSettingsPatch(value: unknown): asserts value is DeepPartial<LauncherSettings> {
	if (!isRecord(value)) throw new SettingsValidationError('settings patch must be an object')
	assertKnownKeys(value, SECTION_KEYS, 'settings')
	for (const key of SECTION_KEYS) {
		if (value[key] !== undefined && !isRecord(value[key])) {
			throw new SettingsValidationError(`${key} settings must be an object`)
		}
	}
	if (isRecord(value.launch)) {
		assertKnownKeys(
			value.launch,
			[
				'windowWidth',
				'windowHeight',
				'startUrl',
				'concurrencyLimit',
				'staggerMs',
				'profileType',
				'proxyMode',
				'language',
				'zoom',
			],
			'launch',
		)
	}
	if (isRecord(value.behavior)) {
		assertKnownKeys(
			value.behavior,
			['closeAction', 'exitWithBrowsers', 'openAtLogin', 'downloadDir'],
			'behavior',
		)
	}
	if (isRecord(value.logs)) {
		assertKnownKeys(
			value.logs,
			[
				'retentionDays',
				'maxEntries',
				'minLevel',
				'captureLlmRequests',
				'captureLlmResponses',
				'defaultExportFormat',
			],
			'logs',
		)
	}
	if (isRecord(value.localUser)) {
		assertKnownKeys(value.localUser, ['displayName', 'colorKey'], 'localUser')
	}
}

function assertValidSettings(settings: LauncherSettings): void {
	assertIntegerInRange(settings.launch.windowWidth, 640, 7680, 'launch.windowWidth')
	assertIntegerInRange(settings.launch.windowHeight, 480, 4320, 'launch.windowHeight')
	assertString(settings.launch.startUrl, 2048, 'launch.startUrl')
	assertIntegerInRange(settings.launch.concurrencyLimit, 1, 12, 'launch.concurrencyLimit')
	assertIntegerInRange(settings.launch.staggerMs, 0, 5000, 'launch.staggerMs')
	assertOneOf(settings.launch.profileType, ['persistent', 'incognito'], 'launch.profileType')
	assertOneOf(settings.launch.proxyMode, ['none', 'system', 'custom'], 'launch.proxyMode')
	assertString(settings.launch.language, 32, 'launch.language')
	assertIntegerInRange(settings.launch.zoom, 25, 500, 'launch.zoom')
	assertOneOf(
		settings.behavior.closeAction,
		['ask', 'minimizeToTray', 'quit'],
		'behavior.closeAction',
	)
	assertOneOf(
		settings.behavior.exitWithBrowsers,
		['ask', 'launcherOnly', 'closeBrowsers'],
		'behavior.exitWithBrowsers',
	)
	assertBoolean(settings.behavior.openAtLogin, 'behavior.openAtLogin')
	assertString(settings.behavior.downloadDir, 4096, 'behavior.downloadDir', true)
	assertIntegerInRange(settings.logs.retentionDays, 1, 90, 'logs.retentionDays')
	assertIntegerInRange(settings.logs.maxEntries, 100, 100_000, 'logs.maxEntries')
	assertOneOf(settings.logs.minLevel, ['debug', 'info', 'warn', 'error'], 'logs.minLevel')
	assertBoolean(settings.logs.captureLlmRequests, 'logs.captureLlmRequests')
	assertBoolean(settings.logs.captureLlmResponses, 'logs.captureLlmResponses')
	assertOneOf(
		settings.logs.defaultExportFormat,
		['json', 'ndjson', 'text'],
		'logs.defaultExportFormat',
	)
	assertString(settings.localUser.displayName, 200, 'localUser.displayName')
	assertString(settings.localUser.colorKey, 64, 'localUser.colorKey')
}

function assertKnownKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	const unknown = Object.keys(value).find((key) => !allowed.includes(key))
	if (unknown) throw new SettingsValidationError(`${label} contains unknown key: ${unknown}`)
}

function assertIntegerInRange(value: unknown, min: number, max: number, label: string): void {
	if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
		throw new SettingsValidationError(`${label} must be an integer from ${min} to ${max}`)
	}
}

function assertString(value: unknown, maxLength: number, label: string, allowEmpty = false): void {
	if (
		typeof value !== 'string' ||
		(!allowEmpty && value.length === 0) ||
		value.length > maxLength
	) {
		throw new SettingsValidationError(`${label} must be a valid string`)
	}
}

function assertBoolean(value: unknown, label: string): void {
	if (typeof value !== 'boolean') throw new SettingsValidationError(`${label} must be a boolean`)
}

function assertOneOf(value: unknown, allowed: readonly string[], label: string): void {
	if (typeof value !== 'string' || !allowed.includes(value)) {
		throw new SettingsValidationError(`${label} has an unsupported value`)
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
