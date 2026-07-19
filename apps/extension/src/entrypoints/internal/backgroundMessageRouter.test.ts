import { afterEach, describe, expect, it, vi } from 'vitest'

import { routeBackgroundMessage } from './backgroundMessageRouter'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('routeBackgroundMessage', () => {
	it('routes the versioned visual screenshot request through the real background handler', async () => {
		vi.stubGlobal('chrome', {
			tabs: {
				get: vi.fn(async () => ({
					id: 7,
					windowId: 2,
					active: true,
					url: 'https://example.com',
					title: 'Example',
				})),
				update: vi.fn(),
				captureVisibleTab: vi.fn(async () => 'data:image/png;base64,SCREENSHOT'),
				query: vi.fn(async () => [
					{
						id: 7,
						windowId: 2,
						active: true,
						url: 'https://example.com',
						title: 'Example',
					},
				]),
			},
		})
		const sendResponse = vi.fn()

		const keepChannelOpen = routeBackgroundMessage(
			{
				type: 'VISUAL_OBSERVE',
				action: 'capture_visible_tab',
				protocolVersion: 2,
				targetTabId: 7,
			},
			{} as chrome.runtime.MessageSender,
			sendResponse,
		)

		expect(keepChannelOpen).toBe(true)
		await vi.waitFor(() =>
			expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true })),
		)
	})

	it('does not claim unknown message types', () => {
		const sendResponse = vi.fn()

		expect(
			routeBackgroundMessage(
				{ type: 'SOME_OTHER_CONTEXT_MESSAGE' },
				{} as chrome.runtime.MessageSender,
				sendResponse,
			),
		).toBeUndefined()
		expect(sendResponse).not.toHaveBeenCalled()
	})
})
