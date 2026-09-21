import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
	buildControlWindowOptions,
	createControlWindow,
	createWindowClosePrompt,
	desktopIconFile,
	handleBrowserRunningClose,
	updateChannel,
} from './MainBootstrap'

describe('desktopIconFile', () => {
	it('selects native icon assets for macOS and Windows', () => {
		expect(desktopIconFile('darwin')).toBe('app-icon-macos-1024.png')
		expect(desktopIconFile('win32')).toBe('app-icon-windows.ico')
	})

	it('uses the PNG fallback on other platforms', () => {
		expect(desktopIconFile('linux')).toBe('app-icon-windows-256.png')
	})
})

describe('updateChannel', () => {
	it('accepts release channels and falls back to stable for an invalid build value', () => {
		expect(updateChannel('dev')).toBe('dev')
		expect(updateChannel('beta')).toBe('beta')
		expect(updateChannel('stable')).toBe('stable')
		expect(updateChannel('nightly')).toBe('stable')
	})
})

describe('buildControlWindowOptions', () => {
	it('uses a resizable macOS glass window with native controls inside the navigation rail', () => {
		const options = buildControlWindowOptions({
			platform: 'darwin',
			iconPath: '/icon.png',
			preloadPath: '/preload.js',
		})

		expect(options).toMatchObject({
			title: '问学',
			width: 1120,
			height: 720,
			minWidth: 920,
			minHeight: 600,
			resizable: true,
			maximizable: true,
			frame: true,
			autoHideMenuBar: true,
			titleBarStyle: 'hiddenInset',
			trafficLightPosition: { x: 10, y: 20 },
			backgroundColor: '#00000000',
			vibrancy: 'under-window',
			visualEffectState: 'active',
			webPreferences: {
				preload: '/preload.js',
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		})
		expect(options.transparent).toBeUndefined()
		expect(options.titleBarOverlay).toBeUndefined()
		expect(options.icon).toBe('/icon.png')
	})

	it.each(['win32', 'linux'] as const)('keeps the opaque frameless window on %s', (platform) => {
		const options = buildControlWindowOptions({
			platform,
			iconPath: '/icon.png',
			preloadPath: '/preload.js',
		})

		expect(options.titleBarStyle).toBe('hidden')
		expect(options.frame).toBe(false)
		expect(options.autoHideMenuBar).toBe(true)
		expect(options.titleBarOverlay).toBeUndefined()
		expect(options.trafficLightPosition).toBeUndefined()
		expect(options.backgroundColor).toBeUndefined()
		expect(options.vibrancy).toBeUndefined()
		expect(options.visualEffectState).toBeUndefined()
		expect(options.transparent).toBeUndefined()
		expect(options.title).toBe('问学')
		expect(options.icon).toBe('/icon.png')
		expect(options.webPreferences).toEqual({
			preload: '/preload.js',
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		})
	})

	it('lets packaged apps use the bundle or executable icon', () => {
		const options = buildControlWindowOptions({
			platform: 'win32',
			preloadPath: '/preload.js',
		})

		expect(options.icon).toBeUndefined()
	})
})

describe('handleBrowserRunningClose', () => {
	it('does not prompt when browser is idle', async () => {
		const requestConfirmation = vi.fn(async () => 'launcherOnly' as const)
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => false,
				requestConfirmation,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(requestConfirmation).not.toHaveBeenCalled()
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	it('keeps browser running by default', async () => {
		const requestConfirmation = vi.fn(async () => 'launcherOnly' as const)
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				requestConfirmation,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(requestConfirmation).toHaveBeenCalledOnce()
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	it('does not prompt when settings keep browsers running on close', async () => {
		const requestConfirmation = vi.fn(async () => 'launcherOnly' as const)
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				exitWithBrowsers: () => 'launcherOnly',
				requestConfirmation,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(requestConfirmation).not.toHaveBeenCalled()
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	it('requests browser shutdown without prompting when settings say to close browsers', async () => {
		const requestConfirmation = vi.fn(async () => 'launcherOnly' as const)
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				exitWithBrowsers: () => 'closeBrowsers',
				requestConfirmation,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(requestConfirmation).not.toHaveBeenCalled()
		expect(requestShutdown).toHaveBeenCalledOnce()
	})

	it('requests browser shutdown when user chooses close browser', async () => {
		const requestConfirmation = vi.fn(async () => 'closeBrowsers' as const)
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				requestConfirmation,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(requestConfirmation).toHaveBeenCalledOnce()
		expect(requestShutdown).toHaveBeenCalledOnce()
	})

	it('keeps the launcher open and reports the error when browser shutdown fails', async () => {
		const shutdownError = new Error('still running')
		const onError = vi.fn()

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				exitWithBrowsers: () => 'closeBrowsers',
				requestConfirmation: vi.fn(async () => 'launcherOnly' as const),
				requestShutdown: vi.fn(async () => {
					throw shutdownError
				}),
				onError,
			}),
		).resolves.toBe('prevented')

		expect(onError).toHaveBeenCalledWith(shutdownError)
	})
})

describe('window close confirmation', () => {
	it('cancels without closing browsers or the launcher', async () => {
		const requestShutdown = vi.fn(async () => undefined)
		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				requestConfirmation: async () => 'cancel',
				requestShutdown,
			}),
		).resolves.toBe('prevented')
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	it('keeps the launcher open when confirmed browser shutdown fails', async () => {
		const onError = vi.fn()
		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				requestConfirmation: async () => 'closeBrowsers',
				requestShutdown: async () => {
					throw new Error('still running')
				},
				onError,
			}),
		).resolves.toBe('prevented')
		expect(onError).toHaveBeenCalledOnce()
	})

	it('accepts only a current prompt response once', async () => {
		const sendState = vi.fn()
		const prompt = createWindowClosePrompt(sendState, () => true)
		const pending = prompt.requestConfirmation()
		const request = prompt.getState()!
		expect(prompt.requestConfirmation()).toBe(pending)
		expect(prompt.respond('stale', 'closeBrowsers')).toBe(false)
		expect(prompt.respond(request.requestId, 'dismiss')).toBe(false)
		expect(prompt.respond(request.requestId, 'launcherOnly')).toBe(true)
		expect(prompt.respond(request.requestId, 'closeBrowsers')).toBe(false)
		await expect(pending).resolves.toBe('launcherOnly')
		expect(prompt.getState()).toBeNull()
		expect(sendState).toHaveBeenLastCalledWith(null)
	})

	it('cancels suspended requests and invalidates their ids', async () => {
		const prompt = createWindowClosePrompt(vi.fn(), () => true)
		const pending = prompt.requestConfirmation()
		const oldId = prompt.getState()!.requestId
		prompt.cancel()
		await expect(pending).resolves.toBe('cancel')
		const next = prompt.requestConfirmation()
		expect(prompt.getState()!.requestId).not.toBe(oldId)
		expect(prompt.respond(oldId, 'closeBrowsers')).toBe(false)
		prompt.cancel()
		await expect(next).resolves.toBe('cancel')
	})

	it('fails closed when the renderer cannot present the request', async () => {
		const prompt = createWindowClosePrompt(vi.fn(), () => false)
		await expect(prompt.requestConfirmation()).resolves.toBe('cancel')
		expect(prompt.getState()).toBeNull()
		const disconnected = createWindowClosePrompt(
			() => {
				throw new Error('gone')
			},
			() => true,
		)
		await expect(disconnected.requestConfirmation()).resolves.toBe('cancel')
	})

	it('shows a separate failure notice which cannot grant permission to close', async () => {
		const prompt = createWindowClosePrompt(vi.fn(), () => true)
		prompt.showFailure()
		const request = prompt.getState()!
		expect(request.kind).toBe('error')
		expect(prompt.respond(request.requestId, 'closeBrowsers')).toBe(false)
		expect(prompt.respond(request.requestId, 'launcherOnly')).toBe(false)
		expect(prompt.respond(request.requestId, 'dismiss')).toBe(true)
		expect(prompt.getState()).toBeNull()
	})
})

class FakeControlWindow extends EventEmitter {
	webContents = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		isDestroyed: () => false,
	})
	isDestroyed = () => false
	loadFile = vi.fn(async () => undefined)
	loadURL = vi.fn(async () => undefined)
	close = vi.fn(() => this.emit('close', { preventDefault: vi.fn() }))
}

function createControlWindowHarness() {
	const requestShutdown = vi.fn(async () => undefined)
	const result = createControlWindow(
		{ BrowserWindow: FakeControlWindow } as unknown as Parameters<typeof createControlWindow>[0],
		{ hasActiveProfiles: () => true, requestShutdown } as unknown as Parameters<
			typeof createControlWindow
		>[1],
		{ get: async () => ({ behavior: { exitWithBrowsers: 'ask' } }) } as unknown as Parameters<
			typeof createControlWindow
		>[2],
		{ log: vi.fn() } as unknown as Parameters<typeof createControlWindow>[3],
		undefined,
	)
	const window = result.window as unknown as FakeControlWindow
	window.webContents.emit('did-finish-load')
	return { ...result, window, requestShutdown }
}

describe('control window close lifecycle', () => {
	it.each(['navigation', 'render-process-gone', 'destroyed', 'closed'])(
		'cancels pending confirmation on %s and prevents a stale response from exiting',
		async (event) => {
			const { window, closePrompt, requestShutdown } = createControlWindowHarness()
			window.close()
			await vi.waitFor(() => expect(closePrompt.getState()?.kind).toBe('confirm'))
			const requestId = closePrompt.getState()!.requestId
			if (event === 'navigation') {
				window.webContents.emit('did-start-navigation', {}, 'file:///app', false, true)
			} else if (event === 'closed') {
				window.emit('closed')
			} else {
				window.webContents.emit(event)
			}
			expect(closePrompt.getState()).toBeNull()
			expect(closePrompt.respond(requestId, 'closeBrowsers')).toBe(false)
			await new Promise((resolve) => setImmediate(resolve))
			expect(window.close).toHaveBeenCalledOnce()
			expect(requestShutdown).not.toHaveBeenCalled()
		},
	)

	it('allows a fresh close request after reloading', async () => {
		const { window, closePrompt } = createControlWindowHarness()
		window.close()
		await vi.waitFor(() => expect(closePrompt.getState()?.kind).toBe('confirm'))
		window.webContents.emit('did-start-navigation', {}, 'file:///app', false, true)
		await new Promise((resolve) => setImmediate(resolve))
		window.webContents.emit('did-finish-load')
		window.close()
		await vi.waitFor(() => expect(closePrompt.getState()?.kind).toBe('confirm'))
		expect(closePrompt.respond(closePrompt.getState()!.requestId, 'cancel')).toBe(true)
	})

	it('does not close after an accepted response races with a renderer reload', async () => {
		const { window, closePrompt, requestShutdown } = createControlWindowHarness()
		window.close()
		await vi.waitFor(() => expect(closePrompt.getState()?.kind).toBe('confirm'))
		closePrompt.respond(closePrompt.getState()!.requestId, 'closeBrowsers')
		window.webContents.emit('did-start-navigation', {}, 'file:///app', false, true)
		await new Promise((resolve) => setImmediate(resolve))
		expect(window.close).toHaveBeenCalledOnce()
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	it('presents browser shutdown failures through the application prompt', async () => {
		const { window, closePrompt, requestShutdown } = createControlWindowHarness()
		requestShutdown.mockRejectedValueOnce(new Error('still running'))
		window.close()
		await vi.waitFor(() => expect(closePrompt.getState()?.kind).toBe('confirm'))
		closePrompt.respond(closePrompt.getState()!.requestId, 'closeBrowsers')
		await vi.waitFor(() => expect(closePrompt.getState()?.kind).toBe('error'))
		expect(window.close).toHaveBeenCalledOnce()
	})
})
