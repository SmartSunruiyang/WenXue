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
		get: vi.fn(async () => ({ launch: { concurrencyLimit: 3, staggerMs: 400 } })),
		update: vi.fn(async () => ({ launch: { concurrencyLimit: 4, staggerMs: 400 } })),
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
	const telemetryIngest = {
		ingest: vi.fn(async () => ({ logs: 1, tokenUsage: 1 })),
	} as unknown as LauncherTelemetryIngest
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
		resources,
		getAppVersion: () => '0.0.0',
		openLogs,
		openPath,
		sendStatus,
		sendProfileStatus,
	})

	return {
		ipcMain,
		launch,
		stop,
		openLogs,
		openPath,
		profileStore,
		logStore,
		settingsStore,
		telemetryIngest,
		tokenUsageStore,
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
				'app:openLogs',
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
		expect(launch).toHaveBeenCalledWith('research')
		expect(stop).toHaveBeenCalledWith('research')
	})

	it('returns launcher logs settings and token usage summary', async () => {
		const { ipcMain, logStore, settingsStore, telemetryIngest, tokenUsageStore } =
			createBridgeHarness()
		const filter = { levels: ['info'], text: 'agent' }
		const patch = { launch: { concurrencyLimit: 4 } }
		const telemetryPayload = { browserId: 'research', logs: [{ message: 'hello' }] }

		await expect(ipcMain.handlers.get('logs:query')?.({}, filter)).resolves.toEqual([])
		await expect(ipcMain.handlers.get('logs:clear')?.()).resolves.toEqual({ ok: true })
		await expect(ipcMain.handlers.get('settings:get')?.()).resolves.toEqual({
			launch: { concurrencyLimit: 3, staggerMs: 400 },
		})
		await expect(ipcMain.handlers.get('settings:update')?.({}, patch)).resolves.toEqual({
			ok: true,
			settings: { launch: { concurrencyLimit: 4, staggerMs: 400 } },
		})
		await expect(ipcMain.handlers.get('tokens:getSummary')?.()).resolves.toEqual(
			expect.objectContaining({ totalTokens: 3000 }),
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
		expect(tokenUsageStore.summary).toHaveBeenCalledOnce()
		expect(telemetryIngest.ingest).toHaveBeenCalledWith(telemetryPayload)
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
			profileStore: createBridgeHarness().profileStore,
			logStore: createBridgeHarness().logStore,
			settingsStore: createBridgeHarness().settingsStore,
			telemetryIngest: createBridgeHarness().telemetryIngest,
			tokenUsageStore: createBridgeHarness().tokenUsageStore,
			resources: {
				browserBinary: () => '/browsers/cft',
				extensionDir: () => tempDir,
				browserVersion: () => '149.0.7827.55',
			},
			getAppVersion: () => '0.0.0',
			openLogs: vi.fn(async () => undefined),
			openPath: vi.fn(async () => ''),
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
