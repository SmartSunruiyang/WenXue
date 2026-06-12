import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleTabControlMessage } from './TabsController.background'

const sender = {} as chrome.runtime.MessageSender

describe('handleTabControlMessage activate_tab', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('activates the tab and responds success', async () => {
		const update = vi.fn(async () => ({}))
		vi.stubGlobal('chrome', { tabs: { update } })

		const sendResponse = vi.fn()
		const result = handleTabControlMessage(
			{ type: 'TAB_CONTROL', action: 'activate_tab', payload: { tabId: 42 } },
			sender,
			sendResponse
		)

		expect(result).toBe(true)
		expect(update).toHaveBeenCalledWith(42, { active: true })
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true }))
	})

	it('responds with the error message when activation fails', async () => {
		const update = vi.fn(async () => {
			throw new Error('No tab with id: 42.')
		})
		vi.stubGlobal('chrome', { tabs: { update } })

		const sendResponse = vi.fn()
		handleTabControlMessage(
			{ type: 'TAB_CONTROL', action: 'activate_tab', payload: { tabId: 42 } },
			sender,
			sendResponse
		)

		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ error: 'No tab with id: 42.' }))
	})
})
