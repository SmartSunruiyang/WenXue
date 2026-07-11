import { afterEach, describe, expect, it, vi } from 'vitest'

import { TabsController } from './TabsController'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('TabsController.switchToTab', () => {
	it('visually activates the target tab via activate_tab', async () => {
		const sendMessage = vi.fn(async () => ({ success: true }))
		const storageSet = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			runtime: { sendMessage },
			storage: { local: { set: storageSet } },
		})

		const controller = new TabsController()
		;(controller as unknown as { tabs: { id: number; isInitial: boolean }[] }).tabs = [
			{ id: 7, isInitial: false },
		]

		await controller.switchToTab(7)

		expect(sendMessage).toHaveBeenCalledWith({
			type: 'TAB_CONTROL',
			action: 'activate_tab',
			payload: { tabId: 7 },
		})
		expect(controller.currentTabId).toBe(7)
	})

	it('still rejects tabs missing from the tab list', async () => {
		const sendMessage = vi.fn(async () => ({ success: true }))
		vi.stubGlobal('chrome', { runtime: { sendMessage } })

		const controller = new TabsController()

		await expect(controller.switchToTab(99)).rejects.toThrow('Tab ID 99 not found')
		expect(sendMessage).not.toHaveBeenCalled()
	})

	it('does not update the logical tab when browser activation fails', async () => {
		const sendMessage = vi.fn(async () => ({ error: 'No tab with id: 7.' }))
		vi.stubGlobal('chrome', {
			runtime: { sendMessage },
			storage: { local: { set: vi.fn(async () => {}) } },
		})
		const controller = new TabsController()
		;(controller as unknown as { tabs: { id: number; isInitial: boolean }[] }).tabs = [
			{ id: 7, isInitial: false },
		]

		await expect(controller.switchToTab(7)).rejects.toThrow('Failed to activate tab')
		expect(controller.currentTabId).toBeNull()
	})
})

describe('TabsController.openNewTab', () => {
	it('re-activates the new tab after adding it to an existing group', async () => {
		const sendMessage = vi.fn(async (message: { action: string }) => {
			if (message.action === 'open_new_tab') {
				return { success: true, tabId: 9 }
			}
			return { success: true }
		})
		vi.stubGlobal('chrome', {
			runtime: { sendMessage },
			storage: { local: { set: vi.fn(async () => {}) } },
		})

		const controller = new TabsController()
		;(controller as unknown as { tabGroupId: number }).tabGroupId = 3
		;(controller as unknown as { windowId: number }).windowId = 4
		vi.spyOn(controller, 'waitUntilTabLoaded').mockResolvedValue()

		await controller.openNewTab('https://example.com')

		expect(sendMessage.mock.calls.map(([message]) => message.action)).toEqual([
			'open_new_tab',
			'activate_tab',
			'add_tab_to_group',
			'activate_tab',
		])
		expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
			action: 'open_new_tab',
			payload: { url: 'https://example.com', windowId: 4 },
		})
	})
})

describe('TabsController.closeTab', () => {
	it('clears a removed current tab when its replacement cannot be activated', async () => {
		const sendMessage = vi.fn(async (message: { action: string }) =>
			message.action === 'close_tab'
				? { success: true }
				: { error: 'Replacement tab cannot be activated' },
		)
		const storageSet = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			runtime: { sendMessage },
			storage: { local: { set: storageSet } },
		})
		const controller = new TabsController()
		;(controller as unknown as { tabs: { id: number; isInitial: boolean }[] }).tabs = [
			{ id: 8, isInitial: false },
			{ id: 7, isInitial: false },
		]
		controller.currentTabId = 7

		await expect(controller.closeTab(7)).rejects.toThrow(/Failed to activate tab ID 8/)
		expect(controller.currentTabId).toBeNull()
		expect(storageSet).toHaveBeenCalledWith({ currentTabId: null })
	})
})

describe('TabsController tab events', () => {
	it('handles asynchronous activation failures without an unhandled rejection', async () => {
		let onMessage!: (message: unknown) => void
		vi.stubGlobal('chrome', {
			runtime: {
				connect: vi.fn(() => ({
					onMessage: {
						addListener: (listener: (message: unknown) => void) => (onMessage = listener),
					},
					onDisconnect: { addListener: vi.fn() },
					disconnect: vi.fn(),
				})),
			},
		})
		const controller = new TabsController()
		;(controller as unknown as { experimentalIncludeAllTabs: boolean }).experimentalIncludeAllTabs =
			true
		const failure = new Error('activation failed')
		vi.spyOn(controller, 'switchToTab').mockRejectedValue(failure)
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		;(controller as unknown as { connectTabEvents: () => void }).connectTabEvents()
		onMessage({ action: 'created', payload: { tab: { id: 7 } } })

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(expect.any(String), failure))
	})

	it('clears a removed current tab when event-driven replacement activation fails', async () => {
		let onMessage!: (message: unknown) => void
		const storageSet = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			runtime: {
				connect: vi.fn(() => ({
					onMessage: {
						addListener: (listener: (message: unknown) => void) => (onMessage = listener),
					},
					onDisconnect: { addListener: vi.fn() },
					disconnect: vi.fn(),
				})),
			},
			storage: { local: { set: storageSet } },
		})
		const controller = new TabsController()
		;(controller as unknown as { tabs: { id: number; isInitial: boolean }[] }).tabs = [
			{ id: 8, isInitial: false },
			{ id: 7, isInitial: false },
		]
		controller.currentTabId = 7
		const failure = new Error('replacement activation failed')
		vi.spyOn(controller, 'switchToTab').mockRejectedValue(failure)
		vi.spyOn(console, 'error').mockImplementation(() => {})
		;(controller as unknown as { connectTabEvents: () => void }).connectTabEvents()
		onMessage({ action: 'removed', payload: { tabId: 7 } })

		await vi.waitFor(() => expect(controller.currentTabId).toBeNull())
		expect(storageSet).toHaveBeenCalledWith({ currentTabId: null })
	})
})
