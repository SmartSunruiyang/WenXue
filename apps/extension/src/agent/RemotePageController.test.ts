import { afterEach, describe, expect, it, vi } from 'vitest'

import { RemotePageController, shouldShowAgentMask } from './RemotePageController'
import type { TabsController } from './TabsController'

describe('RemotePageController mask lifecycle', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('persists interaction suppression when hiding and clears it when showing', async () => {
		const set = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			storage: { local: { set } },
		})
		const controller = new RemotePageController({
			currentTabId: null,
		} as unknown as TabsController)

		await controller.hideMask()
		await controller.showMask()

		expect(set).toHaveBeenNthCalledWith(1, { isAgentInteractionPaused: true })
		expect(set).toHaveBeenNthCalledWith(2, { isAgentInteractionPaused: false })
	})

	it('suppresses the mask while human interaction is active', () => {
		const activeState = {
			isAgentRunning: true,
			agentInTouch: true,
			currentTabId: 7,
			myTabId: 7,
			isAgentInteractionPaused: false,
		}

		expect(shouldShowAgentMask(activeState)).toBe(true)
		expect(shouldShowAgentMask({ ...activeState, isAgentInteractionPaused: true })).toBe(false)
		expect(shouldShowAgentMask({ ...activeState, isAgentRunning: false })).toBe(false)
		expect(shouldShowAgentMask({ ...activeState, agentInTouch: false })).toBe(false)
		expect(shouldShowAgentMask({ ...activeState, currentTabId: 8 })).toBe(false)
		expect(shouldShowAgentMask({ ...activeState, currentTabId: null, myTabId: null })).toBe(false)
	})
})

describe('RemotePageController js execution routing', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	function stubChrome(sendMessage: ReturnType<typeof vi.fn>) {
		vi.stubGlobal('chrome', {
			runtime: { sendMessage },
			storage: { local: { set: vi.fn(async () => {}) } },
		})
	}

	it('puts world in payload and frameId on the message', async () => {
		const sendMessage = vi.fn(async () => ({ success: true, message: 'ok' }))
		stubChrome(sendMessage)
		const tabs = { currentTabId: 5, getTabInfo: async () => ({ url: 'https://a.com', title: '' }) }
		const c = new RemotePageController(tabs as unknown as TabsController)

		await c.executeJavascript('return 1', { world: 'main', frameId: 9 })

		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'PAGE_CONTROL',
				action: 'execute_javascript',
				targetTabId: 5,
				frameId: 9,
				payload: ['return 1', { world: 'main' }],
			})
		)
	})

	it('listFrames calls background list_frames for current tab', async () => {
		const frames = [
			{
				frameId: 0,
				url: 'https://top.com/',
				origin: 'https://top.com',
				sameOriginWithTop: true,
				parentFrameId: -1,
			},
		]
		const sendMessage = vi.fn(async () => frames)
		stubChrome(sendMessage)
		const c = new RemotePageController({ currentTabId: 5 } as unknown as TabsController)

		expect(await c.listFrames()).toEqual(frames)
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'PAGE_CONTROL',
				action: 'list_frames',
				targetTabId: 5,
			})
		)
	})

	it('listFrames returns [] when no current tab', async () => {
		stubChrome(vi.fn())
		const c = new RemotePageController({ currentTabId: null } as unknown as TabsController)

		expect(await c.listFrames()).toEqual([])
	})
})
