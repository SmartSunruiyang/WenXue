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
		vi.spyOn(controller, 'waitUntilTabLoaded').mockResolvedValue()

		await controller.openNewTab('https://example.com')

		expect(sendMessage.mock.calls.map(([message]) => message.action)).toEqual([
			'open_new_tab',
			'activate_tab',
			'add_tab_to_group',
			'activate_tab',
		])
	})
})
