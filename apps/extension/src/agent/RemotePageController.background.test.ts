import { afterEach, describe, expect, it, vi } from 'vitest'

import { handlePageControlMessage } from './RemotePageController.background'

afterEach(() => vi.unstubAllGlobals())

describe('handlePageControlMessage frame routing', () => {
	it('forwards frameId to chrome.tabs.sendMessage', async () => {
		const sendMessage = vi.fn(async () => ({ success: true, message: 'ok' }))
		vi.stubGlobal('chrome', { tabs: { sendMessage } })
		const respond = vi.fn()

		handlePageControlMessage(
			{
				type: 'PAGE_CONTROL',
				action: 'execute_javascript',
				payload: ['x', {}],
				targetTabId: 3,
				frameId: 7,
			} as any,
			{} as any,
			respond,
		)
		await new Promise((r) => setTimeout(r, 0))

		expect(sendMessage).toHaveBeenCalledWith(
			3,
			{ type: 'PAGE_CONTROL', action: 'execute_javascript', payload: ['x', {}] },
			{ frameId: 7 },
		)
	})

	it('defaults to the top frame (frameId 0) when no frameId given', async () => {
		const sendMessage = vi.fn(async () => ({ success: true, message: 'ok' }))
		vi.stubGlobal('chrome', { tabs: { sendMessage } })
		const respond = vi.fn()

		handlePageControlMessage(
			{ type: 'PAGE_CONTROL', action: 'click_element', payload: [1], targetTabId: 3 } as any,
			{} as any,
			respond,
		)
		await new Promise((r) => setTimeout(r, 0))

		expect(sendMessage).toHaveBeenCalledWith(
			3,
			{ type: 'PAGE_CONTROL', action: 'click_element', payload: [1] },
			{ frameId: 0 },
		)
	})

	it('answers list_frames via webNavigation with sameOriginWithTop', async () => {
		vi.stubGlobal('chrome', {
			webNavigation: {
				getAllFrames: vi.fn(async () => [
					{ frameId: 0, parentFrameId: -1, url: 'https://top.com/a' },
					{ frameId: 7, parentFrameId: 0, url: 'https://other.com/b' },
				]),
			},
		})
		const respond = vi.fn()

		handlePageControlMessage(
			{ type: 'PAGE_CONTROL', action: 'list_frames', payload: undefined, targetTabId: 3 } as any,
			{} as any,
			respond,
		)
		await new Promise((r) => setTimeout(r, 0))

		expect(respond).toHaveBeenCalledWith([
			{
				frameId: 0,
				url: 'https://top.com/a',
				origin: 'https://top.com',
				sameOriginWithTop: true,
				parentFrameId: -1,
			},
			{
				frameId: 7,
				url: 'https://other.com/b',
				origin: 'https://other.com',
				sameOriginWithTop: false,
				parentFrameId: 0,
			},
		])
	})
})
