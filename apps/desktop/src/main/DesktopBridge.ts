import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserProfileStore } from './BrowserProfileStore'
import type { BrowserResources } from './BrowserResources'
import type { BrowserStatus, BrowserSupervisor } from './BrowserSupervisor'
import type { LauncherLogStore } from './LauncherLogStore'
import type { DeepPartial, LauncherSettings, LauncherSettingsStore } from './LauncherSettingsStore'
import type { LauncherTelemetryIngest } from './LauncherTelemetryIngest'
import type { TokenUsageStore } from './TokenUsageStore'

export interface IpcMainLike {
	handle(channel: string, handler: (...args: unknown[]) => unknown): void
}

export interface AppVersions {
	app: string
	browser: string
	extension: string
}

export interface AppShellInfo {
	platform: NodeJS.Platform
	frameless: boolean
	hasSystemTrafficLights: boolean
	isMaximized: boolean
}

export interface LaunchResult {
	ok: boolean
	error?: string
}

export type OpenLogsResult = LaunchResult

export interface DesktopBridgeOptions {
	ipcMain: IpcMainLike
	supervisor: Pick<
		BrowserSupervisor,
		'launch' | 'stop' | 'status' | 'statuses' | 'onStatusChange' | 'onProfileStatusChange'
	>
	profileStore: Pick<
		BrowserProfileStore,
		'list' | 'create' | 'duplicate' | 'rename' | 'remove' | 'touch'
	>
	logStore: Pick<LauncherLogStore, 'query' | 'clear'>
	settingsStore: Pick<LauncherSettingsStore, 'get' | 'update'>
	telemetryIngest: Pick<LauncherTelemetryIngest, 'ingest'>
	tokenUsageStore: Pick<TokenUsageStore, 'summary'>
	resources: BrowserResources
	getAppVersion: () => string
	getShellInfo: () => AppShellInfo
	openLogs: () => Promise<void>
	openPath: (path: string) => Promise<string>
	minimizeWindow: () => void
	toggleMaximizeWindow: () => void
	requestClose: () => void
	sendStatus: (status: BrowserStatus) => void
	sendProfileStatus: (payload: { profileId: string; status: BrowserStatus }) => void
}

export function registerDesktopBridge(options: DesktopBridgeOptions): () => void {
	options.ipcMain.handle('browser:launch', async (): Promise<LaunchResult> => {
		try {
			await options.supervisor.launch('default', {
				startUrl: await launcherStartUrl(options.settingsStore),
			})
			return { ok: true }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('browser:getStatus', async (): Promise<BrowserStatus> => {
		return options.supervisor.status()
	})

	options.ipcMain.handle(
		'browser:getStatuses',
		async (): Promise<Record<string, BrowserStatus>> => {
			return options.supervisor.statuses()
		},
	)

	options.ipcMain.handle('browser:listProfiles', async () => {
		return options.profileStore.list()
	})

	options.ipcMain.handle('browser:addProfile', async (): Promise<ProfileMutationResult> => {
		try {
			return { ok: true, profile: await options.profileStore.create() }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle(
		'browser:renameProfile',
		async (
			_event: unknown,
			profileId: string,
			displayName: string,
		): Promise<ProfileMutationResult> => {
			try {
				return { ok: true, profile: await options.profileStore.rename(profileId, displayName) }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:duplicateProfile',
		async (_event: unknown, profileId: string): Promise<ProfileMutationResult> => {
			try {
				return { ok: true, profile: await options.profileStore.duplicate(profileId) }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:removeProfile',
		async (_event: unknown, profileId: string): Promise<ProfileMutationResult> => {
			try {
				return { ok: true, profile: await options.profileStore.remove(profileId) }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:openProfileFolder',
		async (_event: unknown, profileId: string): Promise<LaunchResult> => {
			try {
				const profile = (await options.profileStore.list()).find((item) => item.id === profileId)
				if (!profile) {
					throw new Error(`Unknown browser profile: ${profileId}`)
				}
				const message = await options.openPath(profile.userDataDir)
				if (message.length > 0) {
					throw new Error(message)
				}
				return { ok: true }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:launchProfile',
		async (_event: unknown, profileId: string): Promise<LaunchResult> => {
			try {
				await options.supervisor.launch(profileId, {
					startUrl: await launcherStartUrl(options.settingsStore),
				})
				await options.profileStore.touch(profileId)
				return { ok: true }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:stopProfile',
		async (_event: unknown, profileId: string): Promise<LaunchResult> => {
			try {
				await options.supervisor.stop(profileId)
				return { ok: true }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle('app:getVersions', async (): Promise<AppVersions> => {
		return {
			app: options.getAppVersion(),
			browser: options.resources.browserVersion(),
			extension: readExtensionVersion(options.resources.extensionDir()),
		}
	})

	options.ipcMain.handle('app:getShellInfo', async (): Promise<AppShellInfo> => {
		return options.getShellInfo()
	})

	options.ipcMain.handle('app:openLogs', async (): Promise<OpenLogsResult> => {
		try {
			await options.openLogs()
			return { ok: true }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('app:minimizeWindow', async (): Promise<LaunchResult> => {
		options.minimizeWindow()
		return { ok: true }
	})

	options.ipcMain.handle('app:toggleMaximizeWindow', async (): Promise<LaunchResult> => {
		options.toggleMaximizeWindow()
		return { ok: true }
	})

	options.ipcMain.handle('app:requestClose', async (): Promise<LaunchResult> => {
		options.requestClose()
		return { ok: true }
	})

	options.ipcMain.handle('logs:query', async (_event: unknown, filter?: unknown) => {
		return options.logStore.query(asRecord(filter))
	})

	options.ipcMain.handle('logs:clear', async (): Promise<LaunchResult> => {
		try {
			await options.logStore.clear()
			return { ok: true }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('settings:get', async (): Promise<LauncherSettings> => {
		return options.settingsStore.get()
	})

	options.ipcMain.handle(
		'settings:update',
		async (
			_event: unknown,
			patch: DeepPartial<LauncherSettings>,
		): Promise<SettingsMutationResult> => {
			try {
				return { ok: true, settings: await options.settingsStore.update(patch) }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle('tokens:getSummary', async () => {
		return options.tokenUsageStore.summary()
	})

	options.ipcMain.handle('telemetry:ingest', async (_event: unknown, payload?: unknown) => {
		try {
			return { ok: true, result: await options.telemetryIngest.ingest(payload) }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	const unsubscribeStatus = options.supervisor.onStatusChange(options.sendStatus)
	const unsubscribeProfileStatus = options.supervisor.onProfileStatusChange((profileId, status) => {
		options.sendProfileStatus({ profileId, status })
	})

	return () => {
		unsubscribeStatus()
		unsubscribeProfileStatus()
	}
}

async function launcherStartUrl(
	settingsStore: Pick<LauncherSettingsStore, 'get'>,
): Promise<string | undefined> {
	const startUrl = (await settingsStore.get()).launch.startUrl.trim()
	return startUrl.length > 0 ? startUrl : undefined
}

interface ProfileMutationResult extends LaunchResult {
	profile?: Awaited<ReturnType<BrowserProfileStore['create']>>
}

interface SettingsMutationResult extends LaunchResult {
	settings?: LauncherSettings
}

function readExtensionVersion(extensionDir: string): string {
	try {
		const manifestPath = path.join(extensionDir, 'manifest.json')
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
		if (typeof manifest.version === 'string' && manifest.version.length > 0) {
			return manifest.version
		}
	} catch {
		return 'unknown'
	}

	return 'unknown'
}

function toUserSafeMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message
	}
	if (typeof error === 'string' && error.length > 0) {
		return error
	}

	return 'Unknown launch error'
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
