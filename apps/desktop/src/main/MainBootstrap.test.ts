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
			width: 1120,
			height: 720,
			minWidth: 920,
			minHeight: 600,
			resizable: true,
			maximizable: true,
			titleBarStyle: 'hiddenInset',
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
		expect(options.titleBarOverlay).toEqual({
			color: '#FAFAFA',
			symbolColor: '#060606',
			height: 32,
		})
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
