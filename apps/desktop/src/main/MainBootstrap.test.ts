import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
	buildControlWindowOptions,
	coordinateInstallGuard,
	createControlWindow,
	createInstallQuitCoordinator,
	createWindowClosePrompt,
	desktopIconFile,
	handleBrowserRunningClose,
	requestAppQuit,
	updateChannel,
} from './MainBootstrap'

describe('install quit coordination', () => {
	it('routes a ready restart through before-quit without the force shutdown path', async () => {
		const requestShutdown = vi.fn(async () => undefined)
		const quit = vi.fn()
		await requestAppQuit({
			updateState: { phase: 'ready', release: { installAction: 'restart' } } as never,
			requestShutdown,
			quit,
		})
		expect(quit).toHaveBeenCalledOnce()
		expect(requestShutdown).not.toHaveBeenCalled()
	})
	it('deduplicates before-quit and lets a failed install fall through to ordinary exit', async () => {
		let finish!: (installed: boolean) => void
		const installOnQuit = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					finish = resolve
				}),
		)
		const quit = vi.fn()
		const stopUpdates = vi.fn()
		const coordinator = createInstallQuitCoordinator({
			installOnQuit,
			quit,
			stopUpdates,
			onError: vi.fn(),
			isWindowsUpdateReady: () => true,
		})
		const event = { preventDefault: vi.fn() }
		coordinator.beforeQuit(event as never)
		coordinator.beforeQuit(event as never)
		expect(event.preventDefault).toHaveBeenCalledTimes(2)
		expect(installOnQuit).toHaveBeenCalledOnce()
		finish(false)
		await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
		expect(coordinator.skipClosePrompt()).toBe(true)
		coordinator.beforeQuit(event as never)
		expect(stopUpdates).not.toHaveBeenCalled()
		coordinator.willQuit()
		coordinator.willQuit()
		expect(stopUpdates).toHaveBeenCalledOnce()
		expect(installOnQuit).toHaveBeenCalledOnce()
	})

	it('keeps update checks alive when an ordinary close is cancelled, then accepts a later ready update', async () => {
		let ready = false
		const installOnQuit = vi.fn(async () => false)
		const quit = vi.fn()
		const stopUpdates = vi.fn()
		const coordinator = createInstallQuitCoordinator({
			installOnQuit,
			quit,
			stopUpdates,
			onError: vi.fn(),
			isWindowsUpdateReady: () => ready,
		})
		const event = { preventDefault: vi.fn() }
		coordinator.beforeQuit(event as never)
		expect(event.preventDefault).not.toHaveBeenCalled()
		expect(installOnQuit).not.toHaveBeenCalled()
		expect(stopUpdates).not.toHaveBeenCalled()
		ready = true
		coordinator.beforeQuit(event as never)
		expect(event.preventDefault).toHaveBeenCalledOnce()
		await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
		expect(installOnQuit).toHaveBeenCalledOnce()
		expect(stopUpdates).not.toHaveBeenCalled()
		coordinator.willQuit()
		expect(stopUpdates).toHaveBeenCalledOnce()
	})

	it('skips installation for a window close or system shutdown', () => {
		const installOnQuit = vi.fn(async () => true)
		const coordinator = createInstallQuitCoordinator({
			installOnQuit,
			quit: vi.fn(),
			stopUpdates: vi.fn(),
			onError: vi.fn(),
			isWindowsUpdateReady: () => true,
		})
		const event = { preventDefault: vi.fn() }
		coordinator.markWindowClose()
		coordinator.beforeQuit(event as never)
		coordinator.resetWindowClose()
		coordinator.markSystemShutdown()
		coordinator.beforeQuit(event as never)
		expect(event.preventDefault).not.toHaveBeenCalled()
		expect(installOnQuit).not.toHaveBeenCalled()
		expect(coordinator.canInstall()).toBe(false)
	})

	it('rejects restart cancellation and failed browser close without running the installer', async () => {
		const closeTrackedBrowsersForInstall = vi.fn(async () => false)
		const supervisor = {
			withInstallLaunchLock: async <T>(operation: () => Promise<T>) => operation(),
			allProfilesIdleForInstall: vi.fn(async () => false),
			closeTrackedBrowsersForInstall,
		}
		const operation = vi.fn(async () => undefined)
		const deps = {
			supervisor,
			platform: 'win32' as const,
			confirmRestart: vi.fn(async () => false),
			confirmQuitBrowserClose: vi.fn(async () => true),
			canContinue: () => true,
			allowInstallerQuit: vi.fn(),
			resetInstallerQuit: vi.fn(),
		}
		await expect(coordinateInstallGuard('restart', operation, deps)).resolves.toBe(false)
		expect(closeTrackedBrowsersForInstall).not.toHaveBeenCalled()
		await expect(coordinateInstallGuard('quit', operation, deps)).resolves.toBe(false)
		expect(closeTrackedBrowsersForInstall).toHaveBeenCalledOnce()
		expect(operation).not.toHaveBeenCalled()
	})

	it('rechecks shutdown at the final handoff boundary', async () => {
		let canContinue = true
		let idleChecks = 0
		const supervisor = {
			withInstallLaunchLock: async <T>(operation: () => Promise<T>) => operation(),
			allProfilesIdleForInstall: vi.fn(async () => {
				idleChecks += 1
				if (idleChecks === 3) canContinue = false
				return true
			}),
			closeTrackedBrowsersForInstall: vi.fn(async () => true),
		}
		const operation = vi.fn(async (canInstall: () => Promise<boolean>) => {
			if (!(await canInstall())) throw new Error('cancelled')
		})
		const resetInstallerQuit = vi.fn()
		await expect(
			coordinateInstallGuard('quit', operation, {
				supervisor,
				platform: 'win32',
				confirmRestart: async () => true,
				confirmQuitBrowserClose: async () => true,
				canContinue: () => canContinue,
				allowInstallerQuit: vi.fn(),
				resetInstallerQuit,
			}),
		).rejects.toThrow('cancelled')
		expect(resetInstallerQuit).toHaveBeenCalledOnce()
	})

	it('asks for manual browser close before opening a Mac DMG', async () => {
		const supervisor = {
			withInstallLaunchLock: async <T>(operation: () => Promise<T>) => operation(),
			allProfilesIdleForInstall: vi.fn(async () => false),
			closeTrackedBrowsersForInstall: vi.fn(async () => true),
		}
		const operation = vi.fn(async () => undefined)
		await expect(
			coordinateInstallGuard('open-dmg', operation, {
				supervisor,
				platform: 'darwin',
				confirmRestart: async () => true,
				confirmQuitBrowserClose: async () => true,
				canContinue: () => true,
				allowInstallerQuit: vi.fn(),
				resetInstallerQuit: vi.fn(),
			}),
		).rejects.toThrow('请先手动关闭问学浏览器')
		expect(operation).not.toHaveBeenCalled()
		expect(supervisor.closeTrackedBrowsersForInstall).not.toHaveBeenCalled()
	})
})

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
		expect(options.backgroundMaterial).toBeUndefined()
		expect(options.titleBarOverlay).toBeUndefined()
		expect(options.icon).toBe('/icon.png')
	})

	it('uses native acrylic on Windows while preserving resizing and renderer isolation', () => {
		const options = buildControlWindowOptions({
			platform: 'win32',
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
			frame: false,
			autoHideMenuBar: true,
			titleBarStyle: 'hidden',
			backgroundColor: '#00000000',
			backgroundMaterial: 'acrylic',
			webPreferences: {
				preload: '/preload.js',
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		})
		expect(options.transparent).toBeUndefined()
		expect(options.titleBarOverlay).toBeUndefined()
		expect(options.trafficLightPosition).toBeUndefined()
		expect(options.vibrancy).toBeUndefined()
		expect(options.visualEffectState).toBeUndefined()
		expect(options.icon).toBe('/icon.png')
	})

	it('keeps the opaque frameless window on Linux', () => {
		const options = buildControlWindowOptions({
			platform: 'linux',
			iconPath: '/icon.png',
			preloadPath: '/preload.js',
		})

		expect(options.titleBarStyle).toBe('hidden')
		expect(options.frame).toBe(false)
		expect(options.autoHideMenuBar).toBe(true)
		expect(options.titleBarOverlay).toBeUndefined()
		expect(options.trafficLightPosition).toBeUndefined()
		expect(options.backgroundColor).toBeUndefined()
		expect(options.backgroundMaterial).toBeUndefined()
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

	it('never shares a pending close decision with a different update purpose', async () => {
		const prompt = createWindowClosePrompt(vi.fn(), () => true)
		const close = prompt.requestConfirmation('close')
		await expect(prompt.requestConfirmation('update-restart')).resolves.toBe('cancel')
		const closeId = prompt.getState()!.requestId
		expect(prompt.getState()).toMatchObject({ purpose: 'close' })
		prompt.respond(closeId, 'launcherOnly')
		await expect(close).resolves.toBe('launcherOnly')
		const restart = prompt.requestConfirmation('update-restart')
		expect(prompt.getState()).toMatchObject({ purpose: 'update-restart' })
		await expect(prompt.requestConfirmation('update-quit')).resolves.toBe('cancel')
		prompt.respond(prompt.getState()!.requestId, 'closeBrowsers')
		await expect(restart).resolves.toBe('closeBrowsers')
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

function createControlWindowHarness(installExit?: {
	onAcceptedClose: () => void
	skipClosePrompt: () => boolean
}) {
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
		installExit,
	)
	const window = result.window as unknown as FakeControlWindow
	window.webContents.emit('did-finish-load')
	return { ...result, window, requestShutdown }
}

describe('control window close lifecycle', () => {
	it('does not force browser shutdown after an update quit was allowed', () => {
		const onAcceptedClose = vi.fn()
		const { window, requestShutdown } = createControlWindowHarness({
			onAcceptedClose,
			skipClosePrompt: () => true,
		})
		window.close()
		expect(requestShutdown).not.toHaveBeenCalled()
		expect(onAcceptedClose).toHaveBeenCalledOnce()
	})
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
