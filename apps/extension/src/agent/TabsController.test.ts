import { afterEach, describe, expect, it, vi } from 'vitest'

import { TabsController } from './TabsController'

describe('TabsController.switchToTab', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

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
