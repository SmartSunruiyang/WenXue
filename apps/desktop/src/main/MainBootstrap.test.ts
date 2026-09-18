import { describe, expect, it, vi } from 'vitest'
import {
	buildControlWindowOptions,
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
		const showMessageBox = vi.fn(async () => ({ response: 0 }))
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => false,
				showMessageBox,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(showMessageBox).not.toHaveBeenCalled()
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	it('keeps browser running by default', async () => {
		const showMessageBox = vi.fn(async () => ({ response: 0 }))
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				showMessageBox,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(showMessageBox).toHaveBeenCalledOnce()
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	it('does not prompt when settings keep browsers running on close', async () => {
		const showMessageBox = vi.fn(async () => ({ response: 0 }))
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				exitWithBrowsers: () => 'launcherOnly',
				showMessageBox,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(showMessageBox).not.toHaveBeenCalled()
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	it('requests browser shutdown without prompting when settings say to close browsers', async () => {
		const showMessageBox = vi.fn(async () => ({ response: 0 }))
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				exitWithBrowsers: () => 'closeBrowsers',
				showMessageBox,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(showMessageBox).not.toHaveBeenCalled()
		expect(requestShutdown).toHaveBeenCalledOnce()
	})

	it('requests browser shutdown when user chooses close browser', async () => {
		const showMessageBox = vi.fn(async () => ({ response: 1 }))
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				showMessageBox,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(showMessageBox).toHaveBeenCalledOnce()
		expect(requestShutdown).toHaveBeenCalledOnce()
	})

	it('keeps the launcher open and reports the error when browser shutdown fails', async () => {
		const shutdownError = new Error('still running')
		const onError = vi.fn()

		await expect(
			handleBrowserRunningClose({
				hasActiveProfiles: () => true,
				exitWithBrowsers: () => 'closeBrowsers',
				showMessageBox: vi.fn(async () => ({ response: 0 })),
				requestShutdown: vi.fn(async () => {
					throw shutdownError
				}),
				onError,
			}),
		).resolves.toBe('prevented')

		expect(onError).toHaveBeenCalledWith(shutdownError)
	})
})
