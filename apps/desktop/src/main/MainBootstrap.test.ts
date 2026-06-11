import { describe, expect, it, vi } from 'vitest'
import { handleBrowserRunningClose } from './MainBootstrap'

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
