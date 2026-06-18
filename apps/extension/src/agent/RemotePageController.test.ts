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
