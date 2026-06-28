import { describe, expect, it, vi } from 'vitest'
import { buildControlWindowOptions, handleBrowserRunningClose } from './MainBootstrap'

describe('buildControlWindowOptions', () => {
	it('uses the redesigned borderless app window size and macOS title controls', () => {
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
			trafficLightPosition: { x: 18, y: 18 },
		})
		expect(options.titleBarOverlay).toBeUndefined()
	})

	it('uses title bar overlay safe area on Windows', () => {
		const options = buildControlWindowOptions({
			platform: 'win32',
			iconPath: '/icon.png',
			preloadPath: '/preload.js',
		})

		expect(options.titleBarStyle).toBe('hidden')
		expect(options.frame).toBe(false)
		expect(options.autoHideMenuBar).toBe(true)
		expect(options.titleBarOverlay).toBeUndefined()
		expect(options.title).toBe('问学')
	})
})

describe('handleBrowserRunningClose', () => {
	it('does not prompt when browser is idle', async () => {
		const showMessageBox = vi.fn(async () => ({ response: 0 }))
		const requestShutdown = vi.fn(async () => undefined)

		await expect(
			handleBrowserRunningClose({
				status: () => 'idle',
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
				status: () => 'running',
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
				status: () => 'running',
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
				status: () => 'running',
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
				status: () => 'launching',
				showMessageBox,
				requestShutdown,
			}),
		).resolves.toBe('allow')

		expect(showMessageBox).toHaveBeenCalledOnce()
		expect(requestShutdown).toHaveBeenCalledOnce()
	})
})
