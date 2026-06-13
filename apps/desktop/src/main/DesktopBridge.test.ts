import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserResources } from './BrowserResources'
import type { BrowserStatus } from './BrowserSupervisor'
import { registerDesktopBridge, type IpcMainLike } from './DesktopBridge'

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
	const ipcMain = new FakeIpcMain()
	const launch = vi.fn(async () => undefined)
	const openLogs = vi.fn(async () => undefined)
	const unsubscribe = vi.fn()
	const sendStatus = vi.fn()
	const supervisor = {
		launch,
		status: () => status,
		onStatusChange: (cb: (next: BrowserStatus) => void) => {
			statusListener = cb
			return unsubscribe
		},
		requestShutdown: vi.fn(async () => undefined),
	}
	const resources: BrowserResources = {
		browserBinary: () => '/browsers/cft',
		extensionDir: () => tempDir,
		browserVersion: () => '149.0.7827.55',
	}

	registerDesktopBridge({
		ipcMain,
		supervisor,
		resources,
		getAppVersion: () => '0.0.0',
		openLogs,
		sendStatus,
	})

	return {
		ipcMain,
		launch,
		openLogs,
		sendStatus,
		unsubscribe,
		emitStatus(next: BrowserStatus) {
			status = next
			statusListener?.(next)
		},
	}
}

describe('registerDesktopBridge', () => {
	it('registers only the invoke channels from the desktop IPC contract', () => {
		const { ipcMain } = createBridgeHarness()

		expect(Array.from(ipcMain.handlers.keys()).sort()).toEqual(
			['app:openLogs', 'app:getVersions', 'browser:getStatus', 'browser:launch'].sort(),
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

	it('opens logs with success and failure payloads', async () => {
		const { ipcMain, openLogs } = createBridgeHarness()
		const handler = ipcMain.handlers.get('app:openLogs')

		await expect(handler?.()).resolves.toEqual({ ok: true })

		openLogs.mockRejectedValueOnce(new Error('cannot open logs'))
		await expect(handler?.()).resolves.toEqual({ ok: false, error: 'cannot open logs' })
	})

	it('broadcasts supervisor status changes and returns the unsubscribe function', () => {
		const { emitStatus, sendStatus, unsubscribe } = createBridgeHarness()
		const unregister = registerDesktopBridge({
			ipcMain: new FakeIpcMain(),
			supervisor: {
				launch: vi.fn(async () => undefined),
				status: () => 'idle',
				onStatusChange: (cb: (status: BrowserStatus) => void) => {
					cb('launching')
					return unsubscribe
				},
			},
			resources: {
				browserBinary: () => '/browsers/cft',
				extensionDir: () => tempDir,
				browserVersion: () => '149.0.7827.55',
			},
			getAppVersion: () => '0.0.0',
			openLogs: vi.fn(async () => undefined),
			sendStatus,
		})

		expect(sendStatus).toHaveBeenCalledWith('launching')
		emitStatus('running')
		unregister()
		expect(unsubscribe).toHaveBeenCalledOnce()
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
