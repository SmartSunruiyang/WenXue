import type { UpdateState } from '@wenxue/client-operations'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserProfileStore } from './BrowserProfileStore'
import type { BrowserResources } from './BrowserResources'
import type { BrowserStatus, BrowserSupervisor } from './BrowserSupervisor'
import type { DesktopUpdateService } from './DesktopUpdateService'
import type { LauncherLogStore } from './LauncherLogStore'
import type { DeepPartial, LauncherSettings, LauncherSettingsStore } from './LauncherSettingsStore'
import type { LauncherTelemetryIngest } from './LauncherTelemetryIngest'
import type { TokenUsageStore } from './TokenUsageStore'
import type { UsageCloudClient } from './UsageCloudClient'
import type { UserSessionHandoff } from './UserSessionHandoff'
import type { PublicUserSession, UserSessionStore } from './UserSessionStore'

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

export interface UserSessionResult extends LaunchResult {
	session?: PublicUserSession
}

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
	usageCloudClient: Pick<UsageCloudClient, 'summary'>
	userSessionStore: Pick<UserSessionStore, 'setSession' | 'current' | 'requireSession' | 'clear'>
	userSessionHandoff: Pick<UserSessionHandoff, 'run'>
	updateService: Pick<
		DesktopUpdateService,
		'state' | 'check' | 'download' | 'openInstaller' | 'subscribe' | 'assertWorkspaceAllowed'
	>
	resources: BrowserResources
	getAppVersion: () => string
	getShellInfo: () => AppShellInfo
	openLogs: () => Promise<void>
	openExternal: (url: string) => Promise<void>
	openPath: (path: string) => Promise<string>
	quitApp: () => Promise<void>
	minimizeWindow: () => void
	toggleMaximizeWindow: () => void
	requestClose: () => void
	sendStatus: (status: BrowserStatus) => void
	sendProfileStatus: (payload: { profileId: string; status: BrowserStatus }) => void
	sendUpdateState: (state: UpdateState) => void
}

export function registerDesktopBridge(options: DesktopBridgeOptions): () => void {
	options.ipcMain.handle('browser:launch', async (): Promise<LaunchResult> => {
		try {
			await launchProfileWithUserSession(options, 'default')
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
			profileId: unknown,
			displayName: unknown,
		): Promise<ProfileMutationResult> => {
			try {
				return {
					ok: true,
					profile: await options.profileStore.rename(
						requireStringArg(profileId, 'profileId'),
						requireStringArg(displayName, 'displayName'),
					),
				}
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:duplicateProfile',
		async (_event: unknown, profileId: unknown): Promise<ProfileMutationResult> => {
			try {
				const requestedProfileId = requireStringArg(profileId, 'profileId')
				assertProfileDataMutationAllowed(options, requestedProfileId)
				return {
					ok: true,
					profile: await options.profileStore.duplicate(requestedProfileId),
				}
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:removeProfile',
		async (_event: unknown, profileId: unknown): Promise<ProfileMutationResult> => {
			try {
				const requestedProfileId = requireStringArg(profileId, 'profileId')
				assertProfileDataMutationAllowed(options, requestedProfileId)
				return {
					ok: true,
					profile: await options.profileStore.remove(requestedProfileId),
				}
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:openProfileFolder',
		async (_event: unknown, profileId: unknown): Promise<LaunchResult> => {
			try {
				const requestedProfileId = requireStringArg(profileId, 'profileId')
				const profile = (await options.profileStore.list()).find(
					(item) => item.id === requestedProfileId,
				)
				if (!profile) {
					throw new Error(`Unknown browser profile: ${requestedProfileId}`)
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
		async (_event: unknown, profileId: unknown): Promise<LaunchResult> => {
			try {
				const requestedProfileId = requireStringArg(profileId, 'profileId')
				await launchProfileWithUserSession(options, requestedProfileId)
				await options.profileStore.touch(requestedProfileId)
				return { ok: true }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle(
		'browser:stopProfile',
		async (_event: unknown, profileId: unknown): Promise<LaunchResult> => {
			try {
				await options.supervisor.stop(requireStringArg(profileId, 'profileId'))
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

	options.ipcMain.handle(
		'app:openExternal',
		async (_event: unknown, value: unknown): Promise<LaunchResult> => {
			try {
				const url = new URL(requireStringArg(value, 'url'))
				if (url.protocol !== 'https:') throw new Error('只能打开 HTTPS 链接')
				await options.openExternal(url.toString())
				return { ok: true }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

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

	options.ipcMain.handle('app:quit', async (): Promise<LaunchResult> => {
		try {
			await options.quitApp()
			return { ok: true }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
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
		async (_event: unknown, patch: unknown): Promise<SettingsMutationResult> => {
			try {
				return { ok: true, settings: await options.settingsStore.update(asSettingsPatch(patch)) }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle('tokens:getSummary', async () => {
		try {
			return await options.usageCloudClient.summary()
		} catch {
			return options.tokenUsageStore.summary()
		}
	})

	options.ipcMain.handle(
		'auth:setSession',
		async (_event: unknown, session: unknown): Promise<UserSessionResult> => {
			try {
				return { ok: true, session: options.userSessionStore.setSession(session) }
			} catch (error) {
				return { ok: false, error: toUserSafeMessage(error) }
			}
		},
	)

	options.ipcMain.handle('auth:getSession', async (): Promise<UserSessionResult> => {
		try {
			return { ok: true, session: options.userSessionStore.current() ?? undefined }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('auth:clearSession', async (): Promise<LaunchResult> => {
		options.userSessionStore.clear()
		return { ok: true }
	})

	options.ipcMain.handle('updates:getState', async (): Promise<UpdateState> => {
		return options.updateService.state()
	})

	options.ipcMain.handle(
		'updates:check',
		async (_event: unknown, reason?: unknown): Promise<UpdateMutationResult> => {
			try {
				const checkReason = reason === undefined ? 'manual' : requireUpdateCheckReason(reason)
				return { ok: true, state: await options.updateService.check(checkReason) }
			} catch (error) {
				return {
					ok: false,
					state: options.updateService.state(),
					error: toUserSafeMessage(error),
				}
			}
		},
	)

	options.ipcMain.handle('updates:download', async (): Promise<UpdateMutationResult> => {
		try {
			return { ok: true, state: await options.updateService.download() }
		} catch (error) {
			return {
				ok: false,
				state: options.updateService.state(),
				error: toUserSafeMessage(error),
			}
		}
	})

	options.ipcMain.handle('updates:openInstaller', async (): Promise<UpdateMutationResult> => {
		try {
			return { ok: true, state: await options.updateService.openInstaller() }
		} catch (error) {
			return {
				ok: false,
				state: options.updateService.state(),
				error: toUserSafeMessage(error),
			}
		}
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
	const unsubscribeUpdateState = options.updateService.subscribe(options.sendUpdateState)

	return () => {
		unsubscribeStatus()
		unsubscribeProfileStatus()
		unsubscribeUpdateState()
	}
}

function assertProfileDataMutationAllowed(options: DesktopBridgeOptions, profileId: string): void {
	const status = options.supervisor.statuses()[profileId] ?? 'idle'
	if (status === 'launching' || status === 'running') {
		throw new Error(`浏览器配置 ${profileId} 正在使用，请先关闭浏览器后再操作。`)
	}
}

async function launchProfileWithUserSession(
	options: DesktopBridgeOptions,
	profileId: string,
): Promise<void> {
	await options.updateService.assertWorkspaceAllowed()
	const session = options.userSessionStore.requireSession()
	const result = await options.userSessionHandoff.run(session, async (url) => {
		await options.supervisor.launch(profileId, { startUrl: url })
	})
	if (!result.ok) {
		throw new Error(result.error ?? '问学账号同步失败')
	}
}

interface ProfileMutationResult extends LaunchResult {
	profile?: Awaited<ReturnType<BrowserProfileStore['create']>>
}

interface SettingsMutationResult extends LaunchResult {
	settings?: LauncherSettings
}

interface UpdateMutationResult extends LaunchResult {
	state: UpdateState
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

function asSettingsPatch(value: unknown): DeepPartial<LauncherSettings> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid settings patch')
	}
	return value as DeepPartial<LauncherSettings>
}

function requireStringArg(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`Invalid ${label}`)
	}
	return value
}

function requireUpdateCheckReason(value: unknown): 'manual' | 'signal' {
	if (value === 'manual' || value === 'signal') return value
	throw new Error('Invalid update check reason')
}
