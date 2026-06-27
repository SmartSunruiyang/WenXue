import { readFile, writeFile } from 'node:fs/promises'
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

export class LauncherSettingsStore {
	private readonly filePath: string

	constructor(paths: AppPaths) {
		this.filePath = paths.dataFile('settings.json')
	}

	async get(): Promise<LauncherSettings> {
		try {
			const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as DeepPartial<LauncherSettings>
			return mergeSettings(DEFAULT_LAUNCHER_SETTINGS, raw)
		} catch (error) {
			if (!isMissingFile(error)) {
				throw error
			}
			return structuredClone(DEFAULT_LAUNCHER_SETTINGS)
		}
	}

	async update(patch: DeepPartial<LauncherSettings>): Promise<LauncherSettings> {
		const next = mergeSettings(await this.get(), patch)
		await writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
		return next
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

function isMissingFile(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
