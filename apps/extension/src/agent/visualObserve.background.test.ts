import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetGlobalCaptureStateForTests } from './questionSolver/capture'
import { handleVisualObserveMessage } from './visualObserve.background'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	resetGlobalCaptureStateForTests()
})

describe('handleVisualObserveMessage', () => {
	it('rejects callers using a different bridge protocol version', () => {
		const respond = vi.fn()

		handleVisualObserveMessage(
			{ type: 'VISUAL_OBSERVE', action: 'capture_visible_tab', protocolVersion: 1 },
			{} as any,
			respond,
		)

		expect(respond).toHaveBeenCalledWith({
			ok: false,
			protocolVersion: 2,
			code: 'protocol_mismatch',
			error: 'Visual observation protocol mismatch: expected 2.',
		})
	})

	it('reports the current bridge protocol without taking a screenshot', () => {
		const respond = vi.fn()

		const result = handleVisualObserveMessage(
			{ type: 'VISUAL_OBSERVE', action: 'get_protocol_version', protocolVersion: 2 },
			{} as any,
			respond,
		)

		expect(result).toBeUndefined()
		expect(respond).toHaveBeenCalledWith({ ok: true, protocolVersion: 2 })
	})

	it('captures the current visible tab and returns tab metadata', async () => {
		vi.stubGlobal('chrome', {
			tabs: {
				get: vi.fn(async () => ({
					id: 7,
					windowId: 2,
					active: true,
					url: 'https://example.com',
					title: 'Example',
				})),
				query: vi.fn(async () => [
					{
						id: 7,
						windowId: 2,
						active: true,
						url: 'https://example.com',
						title: 'Example',
					},
				]),
				captureVisibleTab: vi.fn(async () => 'data:image/png;base64,SCREENSHOT'),
			},
		})
		const respond = vi.fn()

		handleVisualObserveMessage(
			{
				type: 'VISUAL_OBSERVE',
				action: 'capture_visible_tab',
				protocolVersion: 2,
				targetTabId: 7,
			},
			{} as any,
			respond,
		)
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(2, {
			format: 'png',
		})
		expect(respond).toHaveBeenCalledWith({
			ok: true,
			protocolVersion: 2,
			dataUrl: 'data:image/png;base64,SCREENSHOT',
			tab: {
				id: 7,
				windowId: 2,
				url: 'https://example.com',
				title: 'Example',
			},
		})
	})

	it('rejects capture requests that do not name an Agent-managed target tab', async () => {
		vi.stubGlobal('chrome', {
			tabs: {
				query: vi.fn(async () => []),
				get: vi.fn(),
				captureVisibleTab: vi.fn(),
			},
		})
		const respond = vi.fn()

		handleVisualObserveMessage(
			{ type: 'VISUAL_OBSERVE', action: 'capture_visible_tab', protocolVersion: 2 },
			{} as any,
			respond,
		)
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled()
		expect(respond).toHaveBeenCalledWith({
			ok: false,
			protocolVersion: 2,
			code: 'invalid_request',
			error: 'Visual observation requires a valid target tab id.',
		})
	})

	it('normalizes capture failures', async () => {
		vi.stubGlobal('chrome', {
			tabs: {
				query: vi.fn(async () => [{ id: 7, windowId: 2, active: true }]),
				get: vi.fn(async () => ({ id: 7, windowId: 2, active: true })),
				captureVisibleTab: vi.fn(async () => {
					throw new Error('Cannot capture chrome:// pages')
				}),
			},
		})
		const respond = vi.fn()

		handleVisualObserveMessage(
			{
				type: 'VISUAL_OBSERVE',
				action: 'capture_visible_tab',
				protocolVersion: 2,
				targetTabId: 7,
			},
			{} as any,
			respond,
		)
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(respond).toHaveBeenCalledWith({
			ok: false,
			protocolVersion: 2,
			code: 'capture_failed',
			error: 'Cannot capture chrome:// pages',
		})
	})

	it('rejects a screenshot when the active tab changes during capture', async () => {
		vi.stubGlobal('chrome', {
			tabs: {
				get: vi.fn(async () => ({ id: 7, windowId: 2, active: true })),
				captureVisibleTab: vi.fn(async () => 'data:image/png;base64,SCREENSHOT'),
				query: vi
					.fn()
					.mockResolvedValueOnce([{ id: 7, windowId: 2, active: true }])
					.mockResolvedValue([{ id: 8, windowId: 2, active: true }]),
			},
		})
		const respond = vi.fn()

		handleVisualObserveMessage(
			{
				type: 'VISUAL_OBSERVE',
				action: 'capture_visible_tab',
				protocolVersion: 2,
				targetTabId: 7,
			},
			{} as any,
			respond,
		)

		await vi.waitFor(() =>
			expect(respond).toHaveBeenCalledWith({
				ok: false,
				protocolVersion: 2,
				code: 'tab_changed',
				error: 'The active tab changed while the screenshot was being captured.',
			}),
		)
	})

	it('rejects a screenshot when the target tab navigates during capture', async () => {
		vi.stubGlobal('chrome', {
			tabs: {
				get: vi.fn(async () => ({
					id: 7,
					windowId: 2,
					active: true,
					url: 'https://example.com/before',
				})),
				captureVisibleTab: vi.fn(async () => 'data:image/png;base64,SCREENSHOT'),
				query: vi.fn(async () => [
					{
						id: 7,
						windowId: 2,
						active: true,
						url: 'https://example.com/after',
					},
				]),
			},
		})
		const respond = vi.fn()

		handleVisualObserveMessage(
			{
				type: 'VISUAL_OBSERVE',
				action: 'capture_visible_tab',
				protocolVersion: 2,
				targetTabId: 7,
			},
			{} as any,
			respond,
		)

		await vi.waitFor(() =>
			expect(respond).toHaveBeenCalledWith({
				ok: false,
				protocolVersion: 2,
				code: 'tab_changed',
				error: 'The target tab changed while the screenshot was being captured.',
			}),
		)
	})
})
