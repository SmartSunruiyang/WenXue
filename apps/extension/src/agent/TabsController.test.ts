import { afterEach, describe, expect, it, vi } from 'vitest'

import { TabsController } from './TabsController'

afterEach(() => {
	vi.unstubAllGlobals()
})

function createInitHarness() {
	const sendMessage = vi.fn(async (message: { action: string }) => {
		switch (message.action) {
			case 'get_active_tab':
				return { tab: { id: 7, windowId: 4 } }
			case 'get_window_tabs':
				return {
					tabs: [
						{
							id: 7,
							windowId: 4,
							url: 'https://example.com/initial',
							title: 'Initial',
							status: 'complete',
							pinned: false,
						},
						{
							id: 8,
							windowId: 4,
							url: 'https://example.com/other',
							title: 'Other',
							status: 'complete',
							pinned: false,
						},
					],
				}
			case 'get_tab_info':
				return {
					url: 'https://example.com/initial',
					title: 'Initial',
					status: 'complete',
					pinned: false,
				}
			case 'create_tab_group':
				return { success: true, groupId: 3 }
			default:
				return { success: true }
		}
	})
	vi.stubGlobal('chrome', {
		runtime: {
			sendMessage,
			connect: vi.fn(() => ({
				onMessage: { addListener: vi.fn() },
				onDisconnect: { addListener: vi.fn() },
				disconnect: vi.fn(),
			})),
		},
		storage: { local: { set: vi.fn(async () => {}) } },
	})
	return sendMessage
}

describe('TabsController.init', () => {
	it('includes every eligible window tab by default', async () => {
		const sendMessage = createInitHarness()
		const controller = new TabsController()

		await controller.init('Compare tabs')

		expect(sendMessage).toHaveBeenCalledWith({
			type: 'TAB_CONTROL',
			action: 'get_window_tabs',
			payload: { windowId: 4 },
		})
		expect(sendMessage.mock.calls.some(([message]) => message.action === 'get_tab_info')).toBe(
			false,
		)
		expect(await controller.summarizeTabs()).toContain('https://example.com/other')
	})

	it('preserves an explicit request to include only the initial tab', async () => {
		const sendMessage = createInitHarness()
		const controller = new TabsController()

		await controller.init('Use this tab', { experimentalIncludeAllTabs: false })

		expect(sendMessage.mock.calls.some(([message]) => message.action === 'get_window_tabs')).toBe(
			false,
		)
		expect(sendMessage).toHaveBeenCalledWith({
			type: 'TAB_CONTROL',
			action: 'get_tab_info',
			payload: { tabId: 7 },
		})
		expect(await controller.summarizeTabs()).not.toContain('https://example.com/other')
	})

	it('preserves includeInitialTab false while including other eligible tabs by default', async () => {
		const sendMessage = createInitHarness()
		const controller = new TabsController()

		await controller.init('Use other tabs', { includeInitialTab: false })

		const summary = await controller.summarizeTabs()
		expect(summary).not.toContain('https://example.com/initial')
		expect(summary).toContain('https://example.com/other')
		expect(sendMessage.mock.calls.some(([message]) => message.action === 'create_tab_group')).toBe(
			false,
		)
	})
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

	it('ignores an activation that completes after the controller is disposed', async () => {
		let resolveActivation!: (value: { success: boolean }) => void
		const activation = new Promise<{ success: boolean }>((resolve) => {
			resolveActivation = resolve
		})
		const storageSet = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			runtime: { sendMessage: vi.fn(() => activation) },
			storage: { local: { set: storageSet } },
		})
		const controller = new TabsController()
		;(controller as unknown as { tabs: { id: number; isInitial: boolean }[] }).tabs = [
			{ id: 7, isInitial: false },
		]

		const switching = controller.switchToTab(7)
		controller.dispose()
		resolveActivation({ success: true })

		await expect(switching).rejects.toThrow('no longer current')
		expect(storageSet).not.toHaveBeenCalled()
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
		;(controller as unknown as { windowId: number }).windowId = 4
		const failure = new Error('activation failed')
		vi.spyOn(controller, 'switchToTab').mockRejectedValue(failure)
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		;(controller as unknown as { connectTabEvents: () => void }).connectTabEvents()
		onMessage({
			action: 'created',
			payload: {
				tab: { id: 7, windowId: 4, url: 'https://example.com', pinned: false },
			},
		})

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(expect.any(String), failure))
	})

	it('ignores created tabs from other windows or ineligible pages', async () => {
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
		;(controller as unknown as { windowId: number }).windowId = 4
		const switchToTab = vi.spyOn(controller, 'switchToTab').mockResolvedValue('switched')
		;(controller as unknown as { connectTabEvents: () => void }).connectTabEvents()

		onMessage({
			action: 'created',
			payload: { tab: { id: 8, windowId: 5, url: 'https://example.com', pinned: false } },
		})
		onMessage({
			action: 'created',
			payload: { tab: { id: 9, windowId: 4, url: 'https://example.com', pinned: true } },
		})
		onMessage({
			action: 'created',
			payload: { tab: { id: 10, windowId: 4, url: 'chrome://settings', pinned: false } },
		})

		expect(switchToTab).not.toHaveBeenCalled()
	})

	it('tracks a same-window tab once an eligible URL appears in an update', async () => {
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
		;(controller as unknown as { windowId: number }).windowId = 4
		const switchToTab = vi.spyOn(controller, 'switchToTab').mockResolvedValue('switched')
		;(controller as unknown as { connectTabEvents: () => void }).connectTabEvents()

		onMessage({
			action: 'updated',
			payload: {
				tabId: 11,
				tab: {
					id: 11,
					windowId: 4,
					url: 'https://example.com/new',
					title: 'New',
					status: 'complete',
					pinned: false,
				},
			},
		})

		await vi.waitFor(() => expect(switchToTab).toHaveBeenCalledWith(11))
	})

	it('does not re-add an explicitly excluded initial tab after an update', () => {
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
		Object.assign(controller as unknown as Record<string, unknown>, {
			experimentalIncludeAllTabs: true,
			includeInitialTab: false,
			initialTabId: 7,
			windowId: 4,
		})
		const switchToTab = vi.spyOn(controller, 'switchToTab').mockResolvedValue('switched')
		;(controller as unknown as { connectTabEvents: () => void }).connectTabEvents()

		onMessage({
			action: 'updated',
			payload: {
				tabId: 7,
				tab: {
					id: 7,
					windowId: 4,
					url: 'https://example.com/initial',
					pinned: false,
				},
			},
		})

		expect(switchToTab).not.toHaveBeenCalled()
		expect((controller as unknown as { tabs: unknown[] }).tabs).toEqual([])
	})

	it('removes a tracked tab that becomes ineligible and activates a replacement', async () => {
		let onMessage!: (message: unknown) => void
		const sendMessage = vi.fn(async () => ({ success: true }))
		const storageSet = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage,
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
		Object.assign(controller as unknown as Record<string, unknown>, {
			experimentalIncludeAllTabs: true,
			windowId: 4,
			tabs: [
				{ id: 7, isInitial: false, url: 'https://example.com/old' },
				{ id: 8, isInitial: false, url: 'https://example.com/replacement' },
			],
		})
		controller.currentTabId = 7
		;(controller as unknown as { connectTabEvents: () => void }).connectTabEvents()

		onMessage({
			action: 'updated',
			payload: {
				tabId: 7,
				tab: { id: 7, windowId: 4, url: 'chrome://settings', pinned: false },
			},
		})

		await vi.waitFor(() => expect(controller.currentTabId).toBe(8))
		expect((controller as unknown as { tabs: { id: number }[] }).tabs).toEqual([
			expect.objectContaining({ id: 8 }),
		])
		expect(sendMessage).toHaveBeenCalledWith({
			type: 'TAB_CONTROL',
			action: 'activate_tab',
			payload: { tabId: 8 },
		})
	})

	it('does not commit a removed tab when an earlier activation resolves late', async () => {
		let onMessage!: (message: unknown) => void
		let resolveActivation!: (value: { success: boolean }) => void
		const activation = new Promise<{ success: boolean }>((resolve) => {
			resolveActivation = resolve
		})
		const storageSet = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(() => activation),
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
			{ id: 7, isInitial: false },
		]
		;(controller as unknown as { connectTabEvents: () => void }).connectTabEvents()

		const switching = controller.switchToTab(7)
		onMessage({ action: 'removed', payload: { tabId: 7 } })
		resolveActivation({ success: true })

		await expect(switching).rejects.toThrow('no longer current')
		expect(storageSet).not.toHaveBeenCalledWith({ currentTabId: 7 })
		expect(controller.currentTabId).toBeNull()
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
