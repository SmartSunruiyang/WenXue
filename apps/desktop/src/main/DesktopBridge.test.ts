import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserProfile, BrowserProfileStore } from './BrowserProfileStore'
import type { BrowserResources } from './BrowserResources'
import type { BrowserStatus } from './BrowserSupervisor'
import { registerDesktopBridge, type IpcMainLike } from './DesktopBridge'
import type { ExtensionSessionHandoff } from './ExtensionSessionHandoff'
import type { LauncherAuthSession } from './LauncherAuthSession'
import type { LauncherLogStore } from './LauncherLogStore'
import type { LauncherSettingsStore } from './LauncherSettingsStore'
import type { LauncherTelemetryIngest } from './LauncherTelemetryIngest'
import type { TokenUsageStore } from './TokenUsageStore'
import type { UsageCloudClient } from './UsageCloudClient'

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
	const openPath = vi.fn(async () => '')
	const minimizeWindow = vi.fn()
	const toggleMaximizeWindow = vi.fn()
	const requestClose = vi.fn()
	const authLogin = vi.fn(async () => ({
		uid: '2071249607247777793',
		username: 'product-user',
		type: 'external' as const,
		expiresAt: 100_000,
		envId: 'wenxue-d8gz76tacc3659f05',
		region: 'ap-shanghai',
		gatewayBaseUrl: 'https://gateway.example',
	}))
	const authLogout = vi.fn(async () => undefined)
	const authGetSession = vi.fn(async () => ({
		uid: '2071249607247777793',
		username: 'product-user',
		type: 'external' as const,
		expiresAt: 100_000,
		envId: 'wenxue-d8gz76tacc3659f05',
		region: 'ap-shanghai',
		gatewayBaseUrl: 'https://gateway.example',
	}))
	const authGetHandoffSession = vi.fn(async () => ({
		uid: '2071249607247777793',
		username: 'product-user',
		type: 'external' as const,
		accessToken: 'access-token',
		expiresAt: 100_000,
		envId: 'wenxue-d8gz76tacc3659f05',
		region: 'ap-shanghai',
		gatewayBaseUrl: 'https://gateway.example',
	}))
	const handoffRun = vi.fn(
		async (
			_session: Awaited<ReturnType<typeof authGetHandoffSession>>,
			openUrl: (url: string) => Promise<void>,
		) => {
			await openUrl('http://127.0.0.1:1234/wenxue-auth-handoff/test')
			return { ok: true }
		},
	)
	const unsubscribe = vi.fn()
	const unsubscribeProfile = vi.fn()
	const sendStatus = vi.fn()
	const sendProfileStatus = vi.fn()
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
		statuses: () => ({ default: status, research: 'idle' as BrowserStatus }),
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
		create: vi.fn(async () => sampleProfile),
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
	const authSession = {
		login: authLogin,
		logout: authLogout,
		getSession: authGetSession,
		getHandoffSession: authGetHandoffSession,
	} as unknown as LauncherAuthSession
	const extensionSessionHandoff = {
		run: handoffRun,
	} as unknown as ExtensionSessionHandoff
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
		authSession,
		extensionSessionHandoff,
		resources,
		getAppVersion: () => '0.0.0',
		getShellInfo: () => ({
			platform: 'darwin',
			frameless: false,
			hasSystemTrafficLights: true,
			isMaximized: false,
		}),
		openLogs,
		openPath,
		minimizeWindow,
		toggleMaximizeWindow,
		requestClose,
		sendStatus,
		sendProfileStatus,
	})

	return {
		ipcMain,
		launch,
		stop,
		openLogs,
		openPath,
		minimizeWindow,
		toggleMaximizeWindow,
		requestClose,
		profileStore,
		logStore,
		settingsStore,
		telemetryIngest,
		tokenUsageStore,
		usageCloudClient,
		authSession,
		extensionSessionHandoff,
		authLogin,
		authLogout,
		authGetSession,
		authGetHandoffSession,
		handoffRun,
		sendStatus,
		sendProfileStatus,
		unsubscribe,
		unsubscribeProfile,
		emitStatus(next: BrowserStatus) {
			status = next
			statusListener?.(next)
		},
		emitProfileStatus(profileId: string, next: BrowserStatus) {
			profileStatusListener?.(profileId, next)
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
				'app:openLogs',
				'app:requestClose',
				'app:toggleMaximizeWindow',
				'auth:getSession',
				'auth:handoffToExtension',
				'auth:login',
				'auth:logout',
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
				'settings:get',
				'settings:update',
				'telemetry:ingest',
				'tokens:getSummary',
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

	it('returns current browser status', async () => {
		const { ipcMain, emitStatus } = createBridgeHarness()
		const handler = ipcMain.handlers.get('browser:getStatus')

		emitStatus('running')

		await expect(handler?.()).resolves.toBe('running')
	})

	it('lists creates renames duplicates removes opens launches and stops browser profiles', async () => {
		const { ipcMain, launch, openPath, stop, profileStore } = createBridgeHarness()

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

		expect(profileStore.create).toHaveBeenCalledOnce()
		expect(profileStore.rename).toHaveBeenCalledWith('research', '研究主号')
		expect(profileStore.duplicate).toHaveBeenCalledWith('research')
		expect(profileStore.remove).toHaveBeenCalledWith('research')
		expect(profileStore.touch).toHaveBeenCalledWith('research')
		expect(openPath).toHaveBeenCalledWith('/profiles/research')
		expect(launch).toHaveBeenCalledWith('research', {
			startUrl: 'https://example.test/start',
		})
		expect(stop).toHaveBeenCalledWith('research')
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

	it('logs in product users and hands the access token to the extension', async () => {
		const {
			ipcMain,
			launch,
			authLogin,
			authLogout,
			authGetSession,
			authGetHandoffSession,
			handoffRun,
		} = createBridgeHarness()

		await expect(
			ipcMain.handlers.get('auth:login')?.({}, { username: 'product-user', password: 'pw' }),
		).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({
				uid: '2071249607247777793',
				type: 'external',
			}),
		})
		await expect(ipcMain.handlers.get('auth:getSession')?.()).resolves.toEqual({
			ok: true,
			session: expect.objectContaining({ username: 'product-user' }),
		})
		await expect(ipcMain.handlers.get('auth:handoffToExtension')?.({}, 'research')).resolves.toEqual({
			ok: true,
		})
		await expect(ipcMain.handlers.get('auth:logout')?.()).resolves.toEqual({ ok: true })

		expect(authLogin).toHaveBeenCalledWith({ username: 'product-user', password: 'pw' })
		expect(authGetSession).toHaveBeenCalledOnce()
		expect(authGetHandoffSession).toHaveBeenCalledOnce()
		expect(handoffRun).toHaveBeenCalledWith(
			expect.objectContaining({ accessToken: 'access-token' }),
			expect.any(Function),
		)
		expect(launch).toHaveBeenCalledWith('research', {
			startUrl: 'http://127.0.0.1:1234/wenxue-auth-handoff/test',
		})
		expect(authLogout).toHaveBeenCalledOnce()
	})

	it('opens logs with success and failure payloads', async () => {
		const { ipcMain, openLogs } = createBridgeHarness()
		const handler = ipcMain.handlers.get('app:openLogs')

		await expect(handler?.()).resolves.toEqual({ ok: true })

		openLogs.mockRejectedValueOnce(new Error('cannot open logs'))
		await expect(handler?.()).resolves.toEqual({ ok: false, error: 'cannot open logs' })
	})

	it('broadcasts supervisor status changes and returns the unsubscribe function', () => {
		const { emitStatus, emitProfileStatus, sendStatus, sendProfileStatus, unsubscribe } =
			createBridgeHarness()
		const harness = createBridgeHarness()
		const unregister = registerDesktopBridge({
			ipcMain: new FakeIpcMain(),
			supervisor: {
				launch: vi.fn(async () => undefined),
				stop: vi.fn(async () => undefined),
				status: () => 'idle',
				statuses: () => ({}),
				onStatusChange: (cb: (status: BrowserStatus) => void) => {
					cb('launching')
					return unsubscribe
				},
				onProfileStatusChange: (cb: (profileId: string, status: BrowserStatus) => void) => {
					cb('default', 'launching')
					return unsubscribe
				},
			},
			profileStore: harness.profileStore,
			logStore: harness.logStore,
			settingsStore: harness.settingsStore,
			telemetryIngest: harness.telemetryIngest,
			tokenUsageStore: harness.tokenUsageStore,
			usageCloudClient: harness.usageCloudClient,
			authSession: harness.authSession,
			extensionSessionHandoff: harness.extensionSessionHandoff,
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
			openPath: vi.fn(async () => ''),
			minimizeWindow: vi.fn(),
			toggleMaximizeWindow: vi.fn(),
			requestClose: vi.fn(),
			sendStatus,
			sendProfileStatus,
		})

		expect(sendStatus).toHaveBeenCalledWith('launching')
		expect(sendProfileStatus).toHaveBeenCalledWith({ profileId: 'default', status: 'launching' })
		emitStatus('running')
		emitProfileStatus('research', 'running')
		unregister()
		expect(unsubscribe).toHaveBeenCalledTimes(2)
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
