import type { UpdateState } from '@wenxue/client-operations'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserProfile, BrowserProfileStore } from './BrowserProfileStore'
import type { BrowserResources } from './BrowserResources'
import type { BrowserStatus } from './BrowserSupervisor'
import { registerDesktopBridge, type IpcMainLike } from './DesktopBridge'
import type { LauncherLogStore } from './LauncherLogStore'
import type { LauncherSettingsStore } from './LauncherSettingsStore'
import type { LauncherTelemetryIngest } from './LauncherTelemetryIngest'
import type { TokenUsageStore } from './TokenUsageStore'
import type { UsageCloudClient } from './UsageCloudClient'
import type { UserSessionHandoff } from './UserSessionHandoff'
import type { UserSession, UserSessionStore } from './UserSessionStore'

class FakeIpcMain implements IpcMainLike {
	handlers = new Map<string, (...args: unknown[]) => unknown>()

	handle(channel: string, handler: (...args: unknown[]) => unknown): void {
		this.handlers.set(channel, handler)
	}
}

let tempDir: string

beforeEach(async () => {
	tempDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-desktop-bridge-'))
})

afterEach(async () => {
	await rm(tempDir, { force: true, recursive: true })
})

function createBridgeHarness() {
	let status: BrowserStatus = 'idle'
	let statusListener: ((status: BrowserStatus) => void) | undefined
	let profileStatusListener: ((profileId: string, status: BrowserStatus) => void) | undefined
	const ipcMain = new FakeIpcMain()
	const launch = vi.fn(async () => undefined)
	const stop = vi.fn(async () => undefined)
	const openLogs = vi.fn(async () => undefined)
	const openExternal = vi.fn(async () => undefined)
	const openPath = vi.fn(async () => '')
	const minimizeWindow = vi.fn()
	const toggleMaximizeWindow = vi.fn()
	const requestClose = vi.fn()
	const quitApp = vi.fn(async () => undefined)
	const sampleSession: UserSession = {
		userId: 'user_123',
		accessToken: 'user-access-token',
		refreshToken: 'user-refresh-token',
		expiresAt: 1782663600000,
		gatewayBaseUrl: 'https://gateway.example',
	}
	const publicSession = {
		userId: sampleSession.userId,
		expiresAt: sampleSession.expiresAt,
		gatewayBaseUrl: sampleSession.gatewayBaseUrl,
	}
	const userSessionSet = vi.fn(async (session: UserSession) => ({
		userId: session.userId,
		expiresAt: session.expiresAt,
		gatewayBaseUrl: session.gatewayBaseUrl,
	}))
	const userSessionCurrent = vi.fn(() => publicSession)
	const userSessionRequire = vi.fn(() => sampleSession)
	const userSessionClear = vi.fn()
	const userSessionHandoffRun = vi.fn(
		async (_session: UserSession, openUrl: (url: string) => Promise<void>) => {
			await openUrl('http://127.0.0.1:1234/wenxue-user-session-handoff/test')
			return { ok: true }
		},
	)
	const unsubscribe = vi.fn()
	const unsubscribeProfile = vi.fn()
	const sendStatus = vi.fn()
	const sendProfileStatus = vi.fn()
	const sendUpdateState = vi.fn()
	let updateState: UpdateState = { phase: 'idle' }
	let updateStateListener: ((state: UpdateState) => void) | undefined
	const updateCheck = vi.fn(async () => updateState)
	const updateDownload = vi.fn(async () => updateState)
	const updateOpenInstaller = vi.fn(async () => updateState)
	const unsubscribeUpdate = vi.fn()
	const assertWorkspaceAllowed = vi.fn(async () => {
		if ('release' in updateState && updateState.release?.mode === 'mandatory') {
			throw new Error('当前版本必须完成更新后才能启动问学工作区。')
		}
	})
	const updateService = {
		state: () => updateState,
		assertWorkspaceAllowed,
		check: updateCheck,
		download: updateDownload,
		openInstaller: updateOpenInstaller,
		subscribe: (listener: (state: UpdateState) => void) => {
			updateStateListener = listener
			listener(updateState)
			return unsubscribeUpdate
		},
	}
	const sampleProfile: BrowserProfile = {
		id: 'research',
		displayName: '资料采集',
		type: 'persistent',
		colorKey: 'blue',
		createdAt: 100,
		lastUsedAt: null,
		userDataDir: '/profiles/research',
	}
	const supervisor = {
		launch,
		stop,
		status: () => status,
		statuses: () => ({ research: status, foreign: 'running' as BrowserStatus }),
		onStatusChange: (cb: (next: BrowserStatus) => void) => {
			statusListener = cb
			return unsubscribe
		},
		onProfileStatusChange: (cb: (profileId: string, next: BrowserStatus) => void) => {
			profileStatusListener = cb
			return unsubscribeProfile
		},
		requestShutdown: vi.fn(async () => undefined),
	}
	const profileStore = {
		list: vi.fn(async () => [sampleProfile]),
		listForReconciliation: vi.fn(async () => [
			{ id: sampleProfile.id, accountNamespace: sampleSession.userId },
		]),
		create: vi.fn(async () => sampleProfile),
		get: vi.fn(async (_accountNamespace: string, profileId: string) => {
			if (profileId !== sampleProfile.id) {
				throw new Error(`Unknown browser profile: ${profileId}`)
			}
			return sampleProfile
		}),
		duplicate: vi.fn(async () => ({ ...sampleProfile, id: 'research_copy' })),
		rename: vi.fn(async () => sampleProfile),
		remove: vi.fn(async () => sampleProfile),
		touch: vi.fn(async () => sampleProfile),
	} as unknown as BrowserProfileStore
	const logStore = {
		query: vi.fn(async () => []),
		clear: vi.fn(async () => undefined),
	} as unknown as LauncherLogStore
	const settingsStore = {
		get: vi.fn(async () => ({
			launch: {
				windowWidth: 1120,
				windowHeight: 720,
				startUrl: 'https://example.test/start',
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
		})),
		update: vi.fn(async () => ({
			launch: {
				windowWidth: 1120,
				windowHeight: 720,
				startUrl: 'https://example.test/start',
				concurrencyLimit: 4,
				staggerMs: 400,
				profileType: 'persistent',
				proxyMode: 'none',
				language: 'zh-CN',
				zoom: 100,
			},
		})),
	} as unknown as LauncherSettingsStore
	const tokenUsageStore = {
		summary: vi.fn(async () => ({
			totalInputTokens: 1000,
			totalOutputTokens: 2000,
			totalTokens: 3000,
			estimatedCostCny: 0.02,
			byBrowser: [],
			byModel: [],
			daily: [],
			recent: [],
		})),
	} as unknown as TokenUsageStore
	const usageCloudClient = {
		summary: vi.fn(async () => ({
			totalInputTokens: 1200,
			totalOutputTokens: 2800,
			totalTokens: 4000,
			estimatedCostCny: 0,
			byBrowser: [],
			byModel: [],
			daily: [],
			recent: [],
		})),
	} as unknown as UsageCloudClient
	const telemetryIngest = {
		ingest: vi.fn(async () => ({ logs: 1, tokenUsage: 1 })),
	} as unknown as LauncherTelemetryIngest
	const userSessionStore = {
		setSession: userSessionSet,
		current: userSessionCurrent,
		requireSession: userSessionRequire,
		clear: userSessionClear,
	} as unknown as UserSessionStore
	const userSessionHandoff = {
		run: userSessionHandoffRun,
	} as unknown as UserSessionHandoff
	const resources: BrowserResources = {
		browserBinary: () => '/browsers/cft',
		extensionDir: () => tempDir,
		browserVersion: () => '149.0.7827.55',
	}

	registerDesktopBridge({
		ipcMain,
		supervisor,
		profileStore,
		logStore,
		settingsStore,
		telemetryIngest,
		tokenUsageStore,
		usageCloudClient,
		userSessionStore,
		userSessionHandoff,
		updateService,
		resources,
		getAppVersion: () => '0.0.0',
		getShellInfo: () => ({
			platform: 'darwin',
			frameless: false,
			hasSystemTrafficLights: true,
			isMaximized: false,
		}),
		openLogs,
		openExternal,
		openPath,
		quitApp,
		minimizeWindow,
		toggleMaximizeWindow,
		requestClose,
		sendStatus,
		sendProfileStatus,
		sendUpdateState,
	})

	return {
		ipcMain,
		launch,
		stop,
		openLogs,
		openExternal,
		openPath,
		minimizeWindow,
		toggleMaximizeWindow,
		requestClose,
		quitApp,
		profileStore,
		supervisor,
		logStore,
		settingsStore,
		telemetryIngest,
		tokenUsageStore,
		usageCloudClient,
		userSessionStore,
		userSessionHandoff,
		updateService,
		assertWorkspaceAllowed,
		sampleSession,
		userSessionSet,
		userSessionCurrent,
		userSessionRequire,
		userSessionClear,
		userSessionHandoffRun,
		updateCheck,
		updateDownload,
		updateOpenInstaller,
		sendStatus,
		sendProfileStatus,
		sendUpdateState,
		unsubscribe,
		unsubscribeProfile,
		unsubscribeUpdate,
		emitStatus(next: BrowserStatus) {
			status = next
			statusListener?.(next)
		},
		emitProfileStatus(profileId: string, next: BrowserStatus) {
			profileStatusListener?.(profileId, next)
		},
		emitUpdateState(next: UpdateState) {
			updateState = next
			updateStateListener?.(next)
		},
	}
}

describe('registerDesktopBridge', () => {
	it('registers only the invoke channels from the desktop IPC contract', () => {
		const { ipcMain } = createBridgeHarness()

		expect(Array.from(ipcMain.handlers.keys()).sort()).toEqual(
			[
				'app:getVersions',
				'app:getShellInfo',
				'app:minimizeWindow',
				'app:openExternal',
				'app:openLogs',
				'app:quit',
				'app:requestClose',
				'app:toggleMaximizeWindow',
				'browser:addProfile',
				'browser:duplicateProfile',
				'browser:getStatus',
				'browser:getStatuses',
				'browser:launch',
				'browser:launchProfile',
				'browser:listProfiles',
				'browser:openProfileFolder',
				'browser:removeProfile',
				'browser:renameProfile',
				'browser:stopProfile',
				'logs:clear',
				'logs:query',
				'auth:cancelSignOut',
				'auth:clearSession',
				'auth:getSession',
				'auth:prepareSignOut',
				'auth:setSession',
				'settings:get',
				'settings:update',
				'telemetry:ingest',
				'tokens:getSummary',
				'updates:check',
				'updates:download',
				'updates:getState',
				'updates:openInstaller',
			].sort(),
		)
	})

	it('returns launch success and failure payloads', async () => {
		const { ipcMain, launch } = createBridgeHarness()
		const handler = ipcMain.handlers.get('browser:launch')

		await expect(handler?.()).resolves.toEqual({ ok: true })

		launch.mockRejectedValueOnce(new Error('boom'))
		await expect(handler?.()).resolves.toEqual({ ok: false, error: 'boom' })
	})

	it('blocks every browser launch path in the main process during a mandatory update', async () => {
		const harness = createBridgeHarness()
		harness.emitUpdateState({
			phase: 'available',
			release: {
				releaseId: 'electron:stable:0.1.1',
				version: '0.1.1',
				channel: 'stable',
				mode: 'mandatory',
				distribution: { mode: 'manual-unsigned' },
				title: '必须更新',
				notes: '安全更新',
				size: 1024,
			},
		})

		await expect(harness.ipcMain.handlers.get('browser:launch')?.()).resolves.toEqual({
			ok: false,
			error: '当前版本必须完成更新后才能启动问学工作区。',
		})
		await expect(
			harness.ipcMain.handlers.get('browser:launchProfile')?.({}, 'research'),
		).resolves.toEqual({
			ok: false,
			error: '当前版本必须完成更新后才能启动问学工作区。',
		})
		expect(harness.launch).not.toHaveBeenCalled()
	})

	it('waits for update policy restoration before launching a workspace', async () => {
		const harness = createBridgeHarness()
		let allowWorkspace: (() => void) | undefined
		harness.assertWorkspaceAllowed.mockImplementationOnce(
			() => new Promise<void>((resolve) => (allowWorkspace = resolve)),
		)
		const launchResult = harness.ipcMain.handlers.get('browser:launch')?.()

		await Promise.resolve()
		expect(harness.launch).not.toHaveBeenCalled()
		allowWorkspace?.()
		await expect(launchResult).resolves.toEqual({ ok: true })
		expect(harness.launch).toHaveBeenCalledOnce()
	})

	it('returns current browser status', async () => {
		const { ipcMain, emitStatus } = createBridgeHarness()
		const handler = ipcMain.handlers.get('browser:getStatus')

		emitStatus('running')

		await expect(handler?.()).resolves.toBe('running')
	})

	it('filters browser statuses to the current account', async () => {
		const { ipcMain } = createBridgeHarness()

		await expect(ipcMain.handlers.get('browser:getStatuses')?.()).resolves.toEqual({
			research: 'idle',
		})
		await expect(ipcMain.handlers.get('browser:getStatus')?.()).resolves.toBe('idle')
	})

	it('lists creates renames duplicates removes opens launches and stops browser profiles', async () => {
		const { ipcMain, launch, openPath, stop, profileStore, userSessionHandoffRun } =
			createBridgeHarness()

		await expect(ipcMain.handlers.get('browser:listProfiles')?.()).resolves.toEqual([
			expect.objectContaining({ id: 'research', displayName: '资料采集' }),
		])
		await expect(ipcMain.handlers.get('browser:addProfile')?.()).resolves.toEqual({
			ok: true,
			profile: expect.objectContaining({ id: 'research' }),
		})
		await expect(
			ipcMain.handlers.get('browser:renameProfile')?.({}, 'research', '研究主号'),
		).resolves.toEqual({
			ok: true,
			profile: expect.objectContaining({ displayName: '资料采集' }),
		})
		await expect(
			ipcMain.handlers.get('browser:duplicateProfile')?.({}, 'research'),
		).resolves.toEqual({
			ok: true,
			profile: expect.objectContaining({ id: 'research_copy' }),
		})
		await expect(
			ipcMain.handlers.get('browser:openProfileFolder')?.({}, 'research'),
		).resolves.toEqual({ ok: true })
		await expect(ipcMain.handlers.get('browser:removeProfile')?.({}, 'research')).resolves.toEqual({
			ok: true,
			profile: expect.objectContaining({ id: 'research' }),
		})
		await expect(ipcMain.handlers.get('browser:launchProfile')?.({}, 'research')).resolves.toEqual({
			ok: true,
		})
		await expect(ipcMain.handlers.get('browser:stopProfile')?.({}, 'research')).resolves.toEqual({
			ok: true,
		})

		expect(profileStore.create).toHaveBeenCalledWith('user_123')
		expect(profileStore.rename).toHaveBeenCalledWith('user_123', 'research', '研究主号')
		expect(profileStore.duplicate).toHaveBeenCalledWith('user_123', 'research')
		expect(profileStore.remove).toHaveBeenCalledWith('user_123', 'research')
		expect(profileStore.touch).toHaveBeenCalledWith('user_123', 'research')
		expect(profileStore.get).toHaveBeenCalledWith('user_123', 'research')
		expect(openPath).toHaveBeenCalledWith('/profiles/research')
		expect(launch).toHaveBeenCalledWith('research', {
			startUrl: 'http://127.0.0.1:1234/wenxue-user-session-handoff/test',
		})
		expect(userSessionHandoffRun).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'user_123', browserId: 'research' }),
			expect.any(Function),
		)
		expect(stop).toHaveBeenCalledWith('research')
	})

	it.each(['launching', 'running'] as const)(
		'rejects profile duplication while the profile is %s',
		async (status) => {
			const { ipcMain, profileStore, supervisor } = createBridgeHarness()
			supervisor.statuses = () => ({ research: status, foreign: 'running' as BrowserStatus })

			await expect(
				ipcMain.handlers.get('browser:duplicateProfile')?.({}, 'research'),
			).resolves.toMatchObject({ ok: false, error: expect.stringContaining('正在使用') })
			expect(profileStore.duplicate).not.toHaveBeenCalled()
		},
	)
	it('rejects a renderer-supplied profile id that is not owned by the active account', async () => {
		const { ipcMain, launch, openPath, profileStore, stop } = createBridgeHarness()
		vi.mocked(profileStore.get).mockRejectedValue(new Error('Unknown browser profile: foreign'))

		await expect(ipcMain.handlers.get('browser:launchProfile')?.({}, 'foreign')).resolves.toEqual({
			ok: false,
			error: 'Unknown browser profile: foreign',
		})
		await expect(
			ipcMain.handlers.get('browser:openProfileFolder')?.({}, 'foreign'),
		).resolves.toEqual({ ok: false, error: 'Unknown browser profile: foreign' })
		await expect(ipcMain.handlers.get('browser:stopProfile')?.({}, 'foreign')).resolves.toEqual({
			ok: false,
			error: 'Unknown browser profile: foreign',
		})
		await expect(
			ipcMain.handlers.get('browser:duplicateProfile')?.({}, 'foreign'),
		).resolves.toEqual({ ok: false, error: 'Unknown browser profile: foreign' })
		await expect(ipcMain.handlers.get('browser:removeProfile')?.({}, 'foreign')).resolves.toEqual({
			ok: false,
			error: 'Unknown browser profile: foreign',
		})

		expect(launch).not.toHaveBeenCalled()
		expect(openPath).not.toHaveBeenCalled()
		expect(stop).not.toHaveBeenCalled()
		expect(profileStore.duplicate).not.toHaveBeenCalled()
		expect(profileStore.remove).not.toHaveBeenCalled()
	})

	it('stops a profile before removing its metadata and keeps it when stop fails', async () => {
		const { ipcMain, profileStore, stop } = createBridgeHarness()
		const order: string[] = []
		stop.mockImplementationOnce(async () => {
			order.push('stop')
		})
		vi.mocked(profileStore.remove).mockImplementationOnce(async () => {
			order.push('remove')
			return (await profileStore.get('user_123', 'research')) as BrowserProfile
		})

		await expect(ipcMain.handlers.get('browser:removeProfile')?.({}, 'research')).resolves.toEqual({
			ok: true,
			profile: expect.objectContaining({ id: 'research' }),
		})
		expect(order).toEqual(['stop', 'remove'])

		vi.mocked(profileStore.remove).mockClear()
		stop.mockRejectedValueOnce(new Error('still running'))
		await expect(ipcMain.handlers.get('browser:removeProfile')?.({}, 'research')).resolves.toEqual({
			ok: false,
			error: 'still running',
		})
		expect(profileStore.remove).not.toHaveBeenCalled()
	})

	it('returns shell info and controls the launcher window', async () => {
		const { ipcMain, minimizeWindow, requestClose, toggleMaximizeWindow } = createBridgeHarness()

		await expect(ipcMain.handlers.get('app:getShellInfo')?.()).resolves.toEqual({
			platform: 'darwin',
			frameless: false,
			hasSystemTrafficLights: true,
			isMaximized: false,
		})
		await expect(ipcMain.handlers.get('app:minimizeWindow')?.()).resolves.toEqual({ ok: true })
		await expect(ipcMain.handlers.get('app:toggleMaximizeWindow')?.()).resolves.toEqual({
			ok: true,
		})
		await expect(ipcMain.handlers.get('app:requestClose')?.()).resolves.toEqual({ ok: true })

		expect(minimizeWindow).toHaveBeenCalledOnce()
		expect(toggleMaximizeWindow).toHaveBeenCalledOnce()
		expect(requestClose).toHaveBeenCalledOnce()
	})

	it('returns launcher logs settings and cloud token usage summary', async () => {
		const { ipcMain, logStore, settingsStore, telemetryIngest, tokenUsageStore, usageCloudClient } =
			createBridgeHarness()
		const filter = { levels: ['info'], text: 'agent' }
		const patch = { launch: { concurrencyLimit: 4 } }
		const telemetryPayload = { browserId: 'research', logs: [{ message: 'hello' }] }

		await expect(ipcMain.handlers.get('logs:query')?.({}, filter)).resolves.toEqual([])
		await expect(ipcMain.handlers.get('logs:clear')?.()).resolves.toEqual({ ok: true })
		await expect(ipcMain.handlers.get('settings:get')?.()).resolves.toEqual(
			expect.objectContaining({
				launch: expect.objectContaining({ concurrencyLimit: 3, staggerMs: 400 }),
			}),
		)
		await expect(ipcMain.handlers.get('settings:update')?.({}, patch)).resolves.toEqual({
			ok: true,
			settings: {
				launch: expect.objectContaining({ concurrencyLimit: 4, staggerMs: 400 }),
			},
		})
		await expect(ipcMain.handlers.get('tokens:getSummary')?.()).resolves.toEqual(
			expect.objectContaining({ totalTokens: 4000 }),
		)
		await expect(ipcMain.handlers.get('telemetry:ingest')?.({}, telemetryPayload)).resolves.toEqual(
			{
				ok: true,
				result: { logs: 1, tokenUsage: 1 },
			},
		)

		expect(logStore.query).toHaveBeenCalledWith(filter)
		expect(logStore.clear).toHaveBeenCalledOnce()
		expect(settingsStore.get).toHaveBeenCalledOnce()
		expect(settingsStore.update).toHaveBeenCalledWith(patch)
		expect(usageCloudClient.summary).toHaveBeenCalledOnce()
		expect(tokenUsageStore.summary).not.toHaveBeenCalled()
		expect(telemetryIngest.ingest).toHaveBeenCalledWith(telemetryPayload)
	})

	it('falls back to local token usage when cloud usage is unavailable', async () => {
		const { ipcMain, tokenUsageStore, usageCloudClient } = createBridgeHarness()
		vi.mocked(usageCloudClient.summary).mockRejectedValueOnce(new Error('offline'))

		await expect(ipcMain.handlers.get('tokens:getSummary')?.()).resolves.toEqual(
			expect.objectContaining({ totalTokens: 3000 }),
		)

		expect(usageCloudClient.summary).toHaveBeenCalledOnce()
		expect(tokenUsageStore.summary).toHaveBeenCalledOnce()
	})

	it('sets returns and safely clears the current user session', async () => {
		const { ipcMain, sampleSession, stop, userSessionSet, userSessionCurrent, userSessionClear } =
			createBridgeHarness()

		await expect(ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ userId: 'user_123' }),
		})
		await expect(ipcMain.handlers.get('auth:getSession')?.()).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ userId: 'user_123' }),
		})
		await expect(ipcMain.handlers.get('auth:clearSession')?.()).resolves.toEqual({ ok: true })

		expect(userSessionSet).toHaveBeenCalledWith(sampleSession)
		expect(userSessionCurrent).toHaveBeenCalledOnce()
		expect(stop).toHaveBeenCalledWith('research')
		expect(userSessionClear).toHaveBeenCalledOnce()
	})

	it('prepares sign-out by stopping every owned profile before clearing the session', async () => {
		const { ipcMain, profileStore, stop, userSessionClear } = createBridgeHarness()

		await expect(ipcMain.handlers.get('auth:prepareSignOut')?.()).resolves.toEqual({ ok: true })
		expect(profileStore.list).toHaveBeenCalledWith('user_123')
		expect(stop).toHaveBeenCalledWith('research')
		expect(userSessionClear).not.toHaveBeenCalled()
		await expect(ipcMain.handlers.get('browser:listProfiles')?.()).rejects.toThrow(
			'正在安全退出问学账号',
		)

		await expect(ipcMain.handlers.get('auth:clearSession')?.()).resolves.toEqual({ ok: true })
		expect(stop).toHaveBeenCalledOnce()
		expect(userSessionClear).toHaveBeenCalledOnce()
	})

	it('keeps the account active when a profile cannot be closed during sign-out', async () => {
		const { ipcMain, stop, userSessionClear } = createBridgeHarness()
		stop.mockRejectedValueOnce(new Error('still running'))

		await expect(ipcMain.handlers.get('auth:prepareSignOut')?.()).resolves.toEqual({
			ok: false,
			error: '退出登录前未能安全关闭浏览器：资料采集：still running',
		})
		expect(userSessionClear).not.toHaveBeenCalled()
		await expect(ipcMain.handlers.get('browser:listProfiles')?.()).resolves.toEqual([
			expect.objectContaining({ id: 'research' }),
		])
	})

	it('can cancel a prepared sign-out when cloud authentication fails', async () => {
		const { ipcMain } = createBridgeHarness()

		await expect(ipcMain.handlers.get('auth:prepareSignOut')?.()).resolves.toEqual({ ok: true })
		await expect(ipcMain.handlers.get('auth:cancelSignOut')?.()).resolves.toEqual({ ok: true })
		await expect(ipcMain.handlers.get('browser:listProfiles')?.()).resolves.toEqual([
			expect.objectContaining({ id: 'research' }),
		])
	})

	it('does not allow cancelling while browser shutdown preparation is still running', async () => {
		const { ipcMain, launch, stop } = createBridgeHarness()
		let finishStop!: () => void
		stop.mockImplementationOnce(
			() =>
				new Promise<undefined>((resolve) => {
					finishStop = () => resolve(undefined)
				}),
		)

		const prepareResult = ipcMain.handlers.get('auth:prepareSignOut')?.()
		await vi.waitFor(() => expect(stop).toHaveBeenCalledWith('research'))
		await expect(ipcMain.handlers.get('auth:cancelSignOut')?.()).resolves.toEqual({
			ok: false,
			error: '浏览器仍在安全关闭中，暂时无法取消退出。',
		})
		await expect(ipcMain.handlers.get('browser:launchProfile')?.({}, 'research')).resolves.toEqual({
			ok: false,
			error: '正在安全退出问学账号，请稍候。',
		})
		expect(launch).not.toHaveBeenCalled()

		finishStop()
		await expect(prepareResult).resolves.toEqual({ ok: true })
	})

	it('closes foreign and unowned live profiles before accepting the first account session', async () => {
		const { ipcMain, profileStore, sampleSession, stop } = createBridgeHarness()
		vi.mocked(profileStore.listForReconciliation).mockResolvedValueOnce([
			{ id: 'research', accountNamespace: 'user_123' },
			{ id: 'foreign', accountNamespace: 'user_456' },
			{ id: 'legacy', accountNamespace: null },
		])

		await expect(ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ userId: 'user_123' }),
		})
		expect(stop).toHaveBeenCalledTimes(2)
		expect(stop).toHaveBeenCalledWith('foreign')
		expect(stop).toHaveBeenCalledWith('legacy')
		expect(stop).not.toHaveBeenCalledWith('research')
	})

	it('uses the gateway-verified session owner instead of the renderer claim', async () => {
		const { ipcMain, profileStore, sampleSession, stop, userSessionSet } = createBridgeHarness()
		userSessionSet.mockResolvedValueOnce({
			userId: 'user_123',
			expiresAt: sampleSession.expiresAt,
			gatewayBaseUrl: sampleSession.gatewayBaseUrl,
		})
		vi.mocked(profileStore.listForReconciliation).mockResolvedValueOnce([
			{ id: 'research', accountNamespace: 'user_123' },
			{ id: 'renderer-claimed', accountNamespace: 'user_456' },
		])

		await expect(
			ipcMain.handlers.get('auth:setSession')?.({}, { ...sampleSession, userId: 'user_456' }),
		).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ userId: 'user_123' }),
		})
		expect(stop).toHaveBeenCalledWith('renderer-claimed')
		expect(stop).not.toHaveBeenCalledWith('research')
	})

	it('blocks profile and account operations while token ownership verification is pending', async () => {
		const { ipcMain, launch, sampleSession, userSessionSet } = createBridgeHarness()
		let finishVerification!: () => void
		userSessionSet.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishVerification = () =>
						resolve({
							userId: sampleSession.userId,
							expiresAt: sampleSession.expiresAt,
							gatewayBaseUrl: sampleSession.gatewayBaseUrl,
						})
				}),
		)

		const firstSet = ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)
		await vi.waitFor(() => expect(userSessionSet).toHaveBeenCalledOnce())
		await expect(ipcMain.handlers.get('browser:launchProfile')?.({}, 'research')).resolves.toEqual({
			ok: false,
			error: '问学账号状态切换中，请稍候。',
		})
		await expect(ipcMain.handlers.get('auth:prepareSignOut')?.()).resolves.toEqual({
			ok: false,
			error: '问学账号状态切换中，请稍候。',
		})
		await expect(ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)).resolves.toEqual({
			ok: false,
			error: '问学账号状态切换中，请稍候。',
		})
		await expect(ipcMain.handlers.get('browser:launchProfile')?.({}, 'research')).resolves.toEqual({
			ok: false,
			error: '问学账号状态切换中，请稍候。',
		})
		await expect(ipcMain.handlers.get('auth:prepareSignOut')?.()).resolves.toEqual({
			ok: false,
			error: '问学账号状态切换中，请稍候。',
		})
		expect(launch).not.toHaveBeenCalled()

		finishVerification()
		await expect(firstSet).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ userId: 'user_123' }),
		})
	})

	it('keeps the transition locked while foreign-profile reconciliation is pending', async () => {
		const { ipcMain, launch, profileStore, sampleSession } = createBridgeHarness()
		let finishReconciliation!: () => void
		vi.mocked(profileStore.listForReconciliation).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishReconciliation = () =>
						resolve([{ id: 'research', accountNamespace: sampleSession.userId }])
				}),
		)

		const firstSet = ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)
		await vi.waitFor(() => expect(profileStore.listForReconciliation).toHaveBeenCalledOnce())
		await expect(ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)).resolves.toEqual({
			ok: false,
			error: '问学账号状态切换中，请稍候。',
		})
		await expect(ipcMain.handlers.get('browser:launchProfile')?.({}, 'research')).resolves.toEqual({
			ok: false,
			error: '问学账号状态切换中，请稍候。',
		})
		expect(launch).not.toHaveBeenCalled()

		finishReconciliation()
		await expect(firstSet).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ userId: 'user_123' }),
		})
	})

	it('keeps an established account active when a verified refresh fails', async () => {
		const { ipcMain, sampleSession, userSessionClear, userSessionSet } = createBridgeHarness()
		await expect(ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ userId: 'user_123' }),
		})
		userSessionSet.mockRejectedValueOnce(new Error('问学账号身份校验失败，请重新登录'))

		await expect(ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)).resolves.toEqual({
			ok: false,
			error: '问学账号身份校验失败，请重新登录',
		})
		await expect(ipcMain.handlers.get('browser:listProfiles')?.()).resolves.toEqual([
			expect.objectContaining({ id: 'research' }),
		])
		expect(userSessionClear).not.toHaveBeenCalled()
	})

	it('rejects the first account session when a foreign live profile cannot close', async () => {
		const { ipcMain, profileStore, sampleSession, stop, userSessionClear } = createBridgeHarness()
		vi.mocked(profileStore.listForReconciliation).mockResolvedValueOnce([
			{ id: 'foreign', accountNamespace: 'user_456' },
		])
		stop.mockRejectedValueOnce(new Error('still running'))

		await expect(ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)).resolves.toEqual({
			ok: false,
			error: '检测到其他账号仍在运行的浏览器，无法进入工作台。请关闭所有问学浏览器后重试。',
		})
		expect(userSessionClear).toHaveBeenCalledOnce()
	})

	it('can safely stop and clear an expired session by its retained account ownership', async () => {
		const { ipcMain, sampleSession, stop, userSessionRequire } = createBridgeHarness()
		await expect(ipcMain.handlers.get('auth:setSession')?.({}, sampleSession)).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ userId: 'user_123' }),
		})
		userSessionRequire.mockImplementation(() => {
			throw new Error('用户登录已过期，请重新登录')
		})

		await expect(ipcMain.handlers.get('auth:prepareSignOut')?.()).resolves.toEqual({ ok: true })
		await expect(ipcMain.handlers.get('auth:clearSession')?.()).resolves.toEqual({ ok: true })
		expect(stop).toHaveBeenCalledWith('research')
	})

	it('rejects browser launch when no user session is synced', async () => {
		const { ipcMain, launch, userSessionRequire } = createBridgeHarness()
		userSessionRequire.mockImplementationOnce(() => {
			throw new Error('请先登录问学账号')
		})

		await expect(ipcMain.handlers.get('browser:launchProfile')?.({}, 'research')).resolves.toEqual({
			ok: false,
			error: '请先登录问学账号',
		})
		expect(launch).not.toHaveBeenCalled()
	})

	it('rechecks the active account after an asynchronous session handoff', async () => {
		const { ipcMain, launch, userSessionHandoffRun } = createBridgeHarness()
		let continueHandoff!: () => void
		userSessionHandoffRun.mockImplementationOnce(
			async (_session: UserSession, openUrl: (url: string) => Promise<void>) => {
				await new Promise<void>((resolve) => {
					continueHandoff = resolve
				})
				await openUrl('http://127.0.0.1:1234/wenxue-user-session-handoff/test')
				return { ok: true }
			},
		)

		const launchResult = ipcMain.handlers.get('browser:launchProfile')?.({}, 'research')
		await vi.waitFor(() => expect(userSessionHandoffRun).toHaveBeenCalledOnce())
		const prepareResult = ipcMain.handlers.get('auth:prepareSignOut')?.()
		await Promise.resolve()
		continueHandoff()

		await expect(launchResult).resolves.toEqual({
			ok: false,
			error: '正在安全退出问学账号，请稍候。',
		})
		await expect(prepareResult).resolves.toEqual({ ok: true })
		expect(launch).not.toHaveBeenCalled()
	})

	it('opens logs with success and failure payloads', async () => {
		const { ipcMain, openLogs } = createBridgeHarness()
		const handler = ipcMain.handlers.get('app:openLogs')

		await expect(handler?.()).resolves.toEqual({ ok: true })

		openLogs.mockRejectedValueOnce(new Error('cannot open logs'))
		await expect(handler?.()).resolves.toEqual({ ok: false, error: 'cannot open logs' })
	})

	it('opens only validated HTTPS links in the system browser', async () => {
		const { ipcMain, openExternal } = createBridgeHarness()

		await expect(
			ipcMain.handlers.get('app:openExternal')?.({}, 'https://example.test/path'),
		).resolves.toEqual({ ok: true })
		await expect(
			ipcMain.handlers.get('app:openExternal')?.({}, 'http://example.test/path'),
		).resolves.toEqual({ ok: false, error: '只能打开 HTTPS 链接' })
		expect(openExternal).toHaveBeenCalledWith('https://example.test/path')
		expect(openExternal).toHaveBeenCalledOnce()
	})

	it('exposes a graceful whole-app quit action for mandatory updates', async () => {
		const { ipcMain, quitApp } = createBridgeHarness()

		await expect(ipcMain.handlers.get('app:quit')?.()).resolves.toEqual({ ok: true })
		expect(quitApp).toHaveBeenCalledOnce()
	})

	it('translates update state checks downloads and explicit installer handoff', async () => {
		const { ipcMain, updateCheck, updateDownload, updateOpenInstaller } = createBridgeHarness()

		await expect(ipcMain.handlers.get('updates:getState')?.()).resolves.toEqual({ phase: 'idle' })
		await expect(ipcMain.handlers.get('updates:check')?.({}, 'signal')).resolves.toEqual({
			ok: true,
			state: { phase: 'idle' },
		})
		await expect(ipcMain.handlers.get('updates:download')?.()).resolves.toEqual({
			ok: true,
			state: { phase: 'idle' },
		})
		await expect(ipcMain.handlers.get('updates:openInstaller')?.()).resolves.toEqual({
			ok: true,
			state: { phase: 'idle' },
		})
		expect(updateCheck).toHaveBeenCalledWith('signal')
		expect(updateDownload).toHaveBeenCalledOnce()
		expect(updateOpenInstaller).toHaveBeenCalledOnce()
	})

	it('returns manual update unavailability without replacing the current update state', async () => {
		const { ipcMain, updateCheck } = createBridgeHarness()
		updateCheck.mockRejectedValueOnce(new Error('开发模式不支持桌面更新，请安装桌面版本后检查。'))

		await expect(ipcMain.handlers.get('updates:check')?.({}, 'manual')).resolves.toEqual({
			ok: false,
			state: { phase: 'idle' },
			error: '开发模式不支持桌面更新，请安装桌面版本后检查。',
		})
	})

	it('broadcasts only owned supervisor status changes and returns the unsubscribe function', async () => {
		const {
			emitStatus,
			emitProfileStatus,
			profileStore,
			sendStatus,
			sendProfileStatus,
			unsubscribe,
		} = createBridgeHarness()
		const harness = createBridgeHarness()
		const unregister = registerDesktopBridge({
			ipcMain: new FakeIpcMain(),
			supervisor: {
				launch: vi.fn(async () => undefined),
				stop: vi.fn(async () => undefined),
				statuses: () => ({}),
				onStatusChange: (cb: (status: BrowserStatus) => void) => {
					cb('launching')
					return unsubscribe
				},
				onProfileStatusChange: (cb: (profileId: string, status: BrowserStatus) => void) => {
					cb('research', 'launching')
					return unsubscribe
				},
			},
			profileStore: harness.profileStore,
			logStore: harness.logStore,
			settingsStore: harness.settingsStore,
			telemetryIngest: harness.telemetryIngest,
			tokenUsageStore: harness.tokenUsageStore,
			usageCloudClient: harness.usageCloudClient,
			userSessionStore: harness.userSessionStore,
			userSessionHandoff: harness.userSessionHandoff,
			updateService: harness.updateService,
			resources: {
				browserBinary: () => '/browsers/cft',
				extensionDir: () => tempDir,
				browserVersion: () => '149.0.7827.55',
			},
			getAppVersion: () => '0.0.0',
			getShellInfo: () => ({
				platform: 'darwin',
				frameless: false,
				hasSystemTrafficLights: true,
				isMaximized: false,
			}),
			openLogs: vi.fn(async () => undefined),
			openExternal: vi.fn(async () => undefined),
			openPath: vi.fn(async () => ''),
			quitApp: vi.fn(async () => undefined),
			minimizeWindow: vi.fn(),
			toggleMaximizeWindow: vi.fn(),
			requestClose: vi.fn(),
			sendStatus,
			sendProfileStatus,
			sendUpdateState: harness.sendUpdateState,
		})

		await vi.waitFor(() => expect(sendStatus).toHaveBeenCalledWith('idle'))
		await vi.waitFor(() =>
			expect(sendProfileStatus).toHaveBeenCalledWith({
				profileId: 'research',
				status: 'launching',
			}),
		)
		emitStatus('running')
		emitProfileStatus('research', 'running')
		await vi.waitFor(() =>
			expect(sendProfileStatus).toHaveBeenCalledWith({ profileId: 'research', status: 'running' }),
		)
		const ownedEventCount = sendProfileStatus.mock.calls.length
		emitProfileStatus('foreign', 'running')
		await vi.waitFor(() => expect(profileStore.get).toHaveBeenCalledWith('user_123', 'foreign'))
		expect(sendProfileStatus).toHaveBeenCalledTimes(ownedEventCount)
		unregister()
		expect(unsubscribe).toHaveBeenCalledTimes(2)
		expect(harness.unsubscribeUpdate).toHaveBeenCalledOnce()
	})

	it('returns app browser and extension versions with missing-manifest fallback', async () => {
		const { ipcMain } = createBridgeHarness()
		const handler = ipcMain.handlers.get('app:getVersions')

		await expect(handler?.()).resolves.toEqual({
			app: '0.0.0',
			browser: '149.0.7827.55',
			extension: 'unknown',
		})

		await mkdir(tempDir, { recursive: true })
		await writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify({ version: '1.2.3' }))

		await expect(handler?.()).resolves.toEqual({
			app: '0.0.0',
			browser: '149.0.7827.55',
			extension: '1.2.3',
		})
	})
})
