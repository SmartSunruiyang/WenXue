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
import { WENXUE_NEW_TAB_URL, type UserSessionHandoff } from './UserSessionHandoff'
import type { PublicUserSession, UserSession, UserSessionStore } from './UserSessionStore'

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

export type WindowCloseChoice = 'cancel' | 'launcherOnly' | 'closeBrowsers' | 'dismiss'

export type WindowClosePurpose = 'close' | 'update-restart' | 'update-quit'

export type WindowClosePromptState = {
	requestId: string
	kind: 'confirm' | 'error'
	purpose?: WindowClosePurpose
} | null

export type OpenLogsResult = LaunchResult

export interface UserSessionResult extends LaunchResult {
	session?: PublicUserSession
}

export interface DesktopBridgeOptions {
	ipcMain: IpcMainLike
	supervisor: Pick<
		BrowserSupervisor,
		'launch' | 'stop' | 'statuses' | 'onStatusChange' | 'onProfileStatusChange'
	>
	profileStore: Pick<
		BrowserProfileStore,
		| 'list'
		| 'create'
		| 'get'
		| 'duplicate'
		| 'rename'
		| 'remove'
		| 'touch'
		| 'listForReconciliation'
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
		| 'state'
		| 'check'
		| 'download'
		| 'openInstaller'
		| 'openManualDownload'
		| 'restartInstall'
		| 'subscribe'
		| 'assertWorkspaceAllowed'
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
	getControlWindowWebContents: () => { mainFrame: unknown } | undefined
	getClosePrompt: () => WindowClosePromptState
	respondToClosePrompt: (requestId: string, choice: WindowCloseChoice) => boolean
	sendStatus: (status: BrowserStatus) => void
	sendProfileStatus: (payload: { profileId: string; status: BrowserStatus }) => void
	sendUpdateState: (state: UpdateState) => void
}

export function registerDesktopBridge(options: DesktopBridgeOptions): () => void {
	let signOutState: SignOutState | null = null
	let activeAccountNamespace: string | null = null
	let accountTransitionInProgress = false
	const profileOperationTails = new Map<string, Promise<void>>()

	const withProfileOperation = async <T>(
		profileId: string,
		operation: () => Promise<T>,
	): Promise<T> => {
		const previous = profileOperationTails.get(profileId) ?? Promise.resolve()
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const tail = previous.catch(() => undefined).then(() => gate)
		profileOperationTails.set(profileId, tail)
		await previous.catch(() => undefined)
		try {
			return await operation()
		} finally {
			release()
			if (profileOperationTails.get(profileId) === tail) {
				profileOperationTails.delete(profileId)
			}
		}
	}

	const requireActiveSession = (): UserSession => {
		if (accountTransitionInProgress) {
			throw new Error('问学账号状态切换中，请稍候。')
		}
		if (signOutState) {
			throw new Error('正在安全退出问学账号，请稍候。')
		}
		const session = options.userSessionStore.requireSession()
		if (activeAccountNamespace && activeAccountNamespace !== session.userId) {
			throw new Error('请先退出当前问学账号，再登录其他账号')
		}
		activeAccountNamespace = session.userId
		return session
	}
	const assertAccountStillActive = (accountNamespace: string): UserSession => {
		const current = requireActiveSession()
		if (current.userId !== accountNamespace) {
			throw new Error('问学账号已切换，请重新操作。')
		}
		return current
	}
	const accountNamespaceForSignOut = (): string => {
		try {
			const session = options.userSessionStore.requireSession()
			if (activeAccountNamespace && activeAccountNamespace !== session.userId) {
				throw new Error('问学账号状态不一致，请重新打开问学。')
			}
			activeAccountNamespace = session.userId
			return session.userId
		} catch (error) {
			if (activeAccountNamespace) return activeAccountNamespace
			throw error
		}
	}
	const accountStatuses = async (): Promise<Record<string, BrowserStatus>> => {
		const session = requireActiveSession()
		const profiles = await options.profileStore.list(session.userId)
		assertAccountStillActive(session.userId)
		const ownedProfileIds = new Set(profiles.map((profile) => profile.id))
		return Object.fromEntries(
			Object.entries(options.supervisor.statuses()).filter(([profileId]) =>
				ownedProfileIds.has(profileId),
			),
		)
	}
	const stopProfilesForAccount = (accountNamespace: string): Promise<void> =>
		stopAccountProfiles(options, accountNamespace, (profileId) =>
			withProfileOperation(profileId, () => options.supervisor.stop(profileId)),
		)
	const launchOwnedProfile = (profileId: string): Promise<void> => {
		requireActiveSession()
		return withProfileOperation(profileId, async () => {
			await options.updateService.assertWorkspaceAllowed()
			const session = requireActiveSession()
			await options.profileStore.get(session.userId, profileId)
			assertAccountStillActive(session.userId)
			const result = await options.userSessionHandoff.run(
				{ ...session, browserId: profileId },
				async (url) => {
					assertAccountStillActive(session.userId)
					await options.profileStore.get(session.userId, profileId)
					assertAccountStillActive(session.userId)
					await options.supervisor.launch(profileId, {
						startUrls: [WENXUE_NEW_TAB_URL, url],
					})
				},
			)
			if (!result.ok) {
				throw new Error(result.error ?? '问学账号同步失败')
			}
			assertAccountStillActive(session.userId)
			await options.profileStore.touch(session.userId, profileId)
		})
	}

	options.ipcMain.handle('browser:launch', async (): Promise<LaunchResult> => {
		try {
			const session = requireActiveSession()
			await options.updateService.assertWorkspaceAllowed()
			const profiles = await options.profileStore.list(session.userId)
			assertAccountStillActive(session.userId)
			const profile = profiles[0] ?? (await options.profileStore.create(session.userId))
			await launchOwnedProfile(profile.id)
			return { ok: true }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('browser:getStatus', async (): Promise<BrowserStatus> => {
		return aggregateBrowserStatus(await accountStatuses())
	})

	options.ipcMain.handle(
		'browser:getStatuses',
		async (): Promise<Record<string, BrowserStatus>> => {
			return accountStatuses()
		},
	)

	options.ipcMain.handle('browser:listProfiles', async () => {
		const session = requireActiveSession()
		const profiles = await options.profileStore.list(session.userId)
		assertAccountStillActive(session.userId)
		return profiles
	})

	options.ipcMain.handle('browser:addProfile', async (): Promise<ProfileMutationResult> => {
		try {
			const session = requireActiveSession()
			const profile = await options.profileStore.create(session.userId)
			assertAccountStillActive(session.userId)
			return {
				ok: true,
				profile,
			}
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
				const session = requireActiveSession()
				const profile = await options.profileStore.rename(
					session.userId,
					requireStringArg(profileId, 'profileId'),
					requireStringArg(displayName, 'displayName'),
				)
				assertAccountStillActive(session.userId)
				return {
					ok: true,
					profile,
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
				requireActiveSession()
				const profile = await withProfileOperation(requestedProfileId, async () => {
					const session = requireActiveSession()
					await options.profileStore.get(session.userId, requestedProfileId)
					assertAccountStillActive(session.userId)
					assertProfileDataMutationAllowed(options, requestedProfileId)
					const duplicate = await options.profileStore.duplicate(session.userId, requestedProfileId)
					assertAccountStillActive(session.userId)
					return duplicate
				})
				return {
					ok: true,
					profile,
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
				requireActiveSession()
				const profile = await withProfileOperation(requestedProfileId, async () => {
					const session = requireActiveSession()
					await options.profileStore.get(session.userId, requestedProfileId)
					assertAccountStillActive(session.userId)
					await options.supervisor.stop(requestedProfileId)
					assertAccountStillActive(session.userId)
					return options.profileStore.remove(session.userId, requestedProfileId)
				})
				return {
					ok: true,
					profile,
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
				const session = requireActiveSession()
				const requestedProfileId = requireStringArg(profileId, 'profileId')
				const profile = await options.profileStore.get(session.userId, requestedProfileId)
				assertAccountStillActive(session.userId)
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
				await launchOwnedProfile(requestedProfileId)
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
				const requestedProfileId = requireStringArg(profileId, 'profileId')
				requireActiveSession()
				await withProfileOperation(requestedProfileId, async () => {
					const session = requireActiveSession()
					await options.profileStore.get(session.userId, requestedProfileId)
					assertAccountStillActive(session.userId)
					await options.supervisor.stop(requestedProfileId)
				})
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

	options.ipcMain.handle('app:getClosePrompt', async (event): Promise<WindowClosePromptState> => {
		if (!isControlWindowEvent(event, options.getControlWindowWebContents())) return null
		return options.getClosePrompt()
	})

	options.ipcMain.handle(
		'app:respondToClosePrompt',
		async (event, requestId, choice): Promise<LaunchResult> => {
			if (
				!isControlWindowEvent(event, options.getControlWindowWebContents()) ||
				typeof requestId !== 'string' ||
				requestId.length === 0 ||
				requestId.length > 128 ||
				(choice !== 'cancel' &&
					choice !== 'launcherOnly' &&
					choice !== 'closeBrowsers' &&
					choice !== 'dismiss')
			) {
				return { ok: false }
			}
			return { ok: options.respondToClosePrompt(requestId, choice) }
		},
	)

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
			let initialSession = false
			let sessionEstablished = false
			let ownsAccountTransition = false
			try {
				if (signOutState || accountTransitionInProgress) {
					throw new Error('问学账号状态切换中，请稍候。')
				}
				initialSession = activeAccountNamespace === null
				accountTransitionInProgress = true
				ownsAccountTransition = true
				const publicSession = await options.userSessionStore.setSession(session)
				sessionEstablished = true
				if (activeAccountNamespace && activeAccountNamespace !== publicSession.userId) {
					throw new Error('请先退出当前问学账号，再登录其他账号')
				}
				activeAccountNamespace = publicSession.userId
				if (initialSession) {
					await reconcileForeignProfiles(options, publicSession.userId, (profileId) =>
						withProfileOperation(profileId, () => options.supervisor.stop(profileId)),
					)
				}
				return { ok: true, session: publicSession }
			} catch (error) {
				if (initialSession && sessionEstablished) {
					options.userSessionStore.clear()
					activeAccountNamespace = null
				}
				return { ok: false, error: toUserSafeMessage(error) }
			} finally {
				if (ownsAccountTransition) accountTransitionInProgress = false
			}
		},
	)

	options.ipcMain.handle('auth:getSession', async (): Promise<UserSessionResult> => {
		try {
			if (accountTransitionInProgress) throw new Error('问学账号状态切换中，请稍候。')
			const session = options.userSessionStore.current() ?? undefined
			if (session) {
				if (activeAccountNamespace && activeAccountNamespace !== session.userId) {
					throw new Error('问学账号状态不一致，请重新打开问学。')
				}
				activeAccountNamespace = session.userId
			}
			return { ok: true, session }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('auth:prepareSignOut', async (): Promise<LaunchResult> => {
		try {
			if (accountTransitionInProgress) throw new Error('问学账号状态切换中，请稍候。')
			const accountNamespace = accountNamespaceForSignOut()
			if (signOutState) {
				if (
					signOutState.accountNamespace === accountNamespace &&
					signOutState.phase === 'prepared'
				) {
					return { ok: true }
				}
				throw new Error('正在安全退出问学账号，请稍候。')
			}

			signOutState = { accountNamespace, phase: 'preparing' }
			try {
				await stopProfilesForAccount(accountNamespace)
				signOutState = { accountNamespace, phase: 'prepared' }
				return { ok: true }
			} catch (error) {
				signOutState = null
				throw error
			}
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('auth:cancelSignOut', async (): Promise<LaunchResult> => {
		try {
			if (accountTransitionInProgress) throw new Error('问学账号状态切换中，请稍候。')
			if (signOutState?.phase === 'preparing') {
				throw new Error('浏览器仍在安全关闭中，暂时无法取消退出。')
			}
			if (
				signOutState &&
				activeAccountNamespace &&
				signOutState.accountNamespace !== activeAccountNamespace
			) {
				throw new Error('问学账号已切换，无法取消当前退出流程。')
			}
			signOutState = null
			return { ok: true }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('auth:clearSession', async (): Promise<LaunchResult> => {
		try {
			if (accountTransitionInProgress) throw new Error('问学账号状态切换中，请稍候。')
			let accountNamespace: string | null = null
			try {
				accountNamespace = accountNamespaceForSignOut()
			} catch {
				accountNamespace = null
			}
			if (!accountNamespace) {
				signOutState = null
				options.userSessionStore.clear()
				activeAccountNamespace = null
				return { ok: true }
			}

			if (
				signOutState &&
				(signOutState.accountNamespace !== accountNamespace || signOutState.phase !== 'prepared')
			) {
				throw new Error('正在安全退出问学账号，请稍候。')
			}

			if (!signOutState) {
				signOutState = { accountNamespace, phase: 'preparing' }
				try {
					await stopProfilesForAccount(accountNamespace)
					signOutState = { accountNamespace, phase: 'prepared' }
				} catch (error) {
					signOutState = null
					throw error
				}
			}

			options.userSessionStore.clear()
			signOutState = null
			activeAccountNamespace = null
			return { ok: true }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
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

	options.ipcMain.handle('updates:openManualDownload', async (): Promise<UpdateMutationResult> => {
		try {
			return { ok: true, state: await options.updateService.openManualDownload() }
		} catch (error) {
			return {
				ok: false,
				state: options.updateService.state(),
				error: toUserSafeMessage(error),
			}
		}
	})

	options.ipcMain.handle('updates:restartInstall', async (): Promise<UpdateMutationResult> => {
		try {
			return { ok: true, state: await options.updateService.restartInstall() }
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

	const sendCurrentAccountStatus = async (): Promise<void> => {
		try {
			options.sendStatus(aggregateBrowserStatus(await accountStatuses()))
		} catch {
			// Signed-out and cross-account status changes are intentionally invisible.
		}
	}
	const sendOwnedProfileStatus = async (
		profileId: string,
		status: BrowserStatus,
	): Promise<void> => {
		try {
			const session = requireActiveSession()
			await options.profileStore.get(session.userId, profileId)
			assertAccountStillActive(session.userId)
			options.sendProfileStatus({ profileId, status })
		} catch {
			// A profile owned by another or signed-out account must not reach the renderer.
		}
	}
	const unsubscribeStatus = options.supervisor.onStatusChange(() => {
		void sendCurrentAccountStatus()
	})
	const unsubscribeProfileStatus = options.supervisor.onProfileStatusChange((profileId, status) => {
		void sendOwnedProfileStatus(profileId, status)
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

interface SignOutState {
	accountNamespace: string
	phase: 'preparing' | 'prepared'
}

async function stopAccountProfiles(
	options: DesktopBridgeOptions,
	accountNamespace: string,
	stopProfile: (profileId: string) => Promise<void>,
): Promise<void> {
	const profiles = await options.profileStore.list(accountNamespace)
	const results = await Promise.allSettled(
		profiles.map(async (profile) => {
			await stopProfile(profile.id)
		}),
	)
	const failures = results.flatMap((result, index) =>
		result.status === 'rejected'
			? [`${profiles[index]?.displayName ?? '未知浏览器'}：${toUserSafeMessage(result.reason)}`]
			: [],
	)
	if (failures.length > 0) {
		throw new Error(`退出登录前未能安全关闭浏览器：${failures.join('；')}`)
	}
}

async function reconcileForeignProfiles(
	options: DesktopBridgeOptions,
	accountNamespace: string,
	stopProfile: (profileId: string) => Promise<void>,
): Promise<void> {
	const foreignProfiles = (await options.profileStore.listForReconciliation()).filter(
		(profile) => profile.accountNamespace !== accountNamespace,
	)
	const results = await Promise.allSettled(
		foreignProfiles.map(async (profile) => {
			await stopProfile(profile.id)
		}),
	)
	if (results.some((result) => result.status === 'rejected')) {
		throw new Error('检测到其他账号仍在运行的浏览器，无法进入工作台。请关闭所有问学浏览器后重试。')
	}
}

function aggregateBrowserStatus(statuses: Record<string, BrowserStatus>): BrowserStatus {
	const values = Object.values(statuses)
	if (values.includes('error')) return 'error'
	if (values.includes('launching')) return 'launching'
	if (values.includes('running')) return 'running'
	return 'idle'
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
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
			version?: unknown
			version_name?: unknown
		}
		if (typeof manifest.version_name === 'string' && manifest.version_name.length > 0) {
			return manifest.version_name
		}
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

function isControlWindowEvent(
	event: unknown,
	webContents: { mainFrame: unknown } | undefined,
): boolean {
	if (!webContents || !event || typeof event !== 'object') return false
	const source = event as { sender?: unknown; senderFrame?: unknown }
	return source.sender === webContents && source.senderFrame === webContents.mainFrame
}
