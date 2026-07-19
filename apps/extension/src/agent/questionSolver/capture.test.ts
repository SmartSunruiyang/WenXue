import { describe, expect, it, vi } from 'vitest'

import {
	captureVisibleManagedTabPng,
	computeQuestionCrop,
	GlobalCaptureLimiter,
	TabEffectLock,
} from './capture'

describe('question solver capture primitives', () => {
	it('enforces at least 550ms between capture starts', async () => {
		let now = 1_000
		const waits: number[] = []
		const limiter = new GlobalCaptureLimiter(
			() => now,
			async (ms) => {
				waits.push(ms)
				now += ms
			},
		)
		await limiter.acquire()
		now += 100
		await limiter.acquire()
		expect(waits).toEqual([450])
	})

	it('never activates a background tab to take an ordinary screenshot', async () => {
		const captureVisibleTab = vi.fn()
		const api = {
			tabs: {
				get: vi.fn(async () => ({ id: 7, windowId: 2, active: false })),
				query: vi.fn(),
				captureVisibleTab,
			},
		}
		await expect(
			captureVisibleManagedTabPng({
				targetTabId: 7,
				api: api as any,
				limiter: new GlobalCaptureLimiter(),
			}),
		).rejects.toMatchObject({ code: 'tab_not_visible' })
		expect(captureVisibleTab).not.toHaveBeenCalled()
		expect(api.tabs).not.toHaveProperty('update')
	})

	it('captures a lossless PNG and verifies the tab binding after capture', async () => {
		const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,PNG')
		const tab = {
			id: 7,
			windowId: 2,
			active: true,
			url: 'https://example.test/',
			title: 'Example',
		}
		const result = await captureVisibleManagedTabPng({
			targetTabId: 7,
			api: {
				tabs: {
					get: vi.fn(async () => tab),
					query: vi.fn(async () => [tab]),
					captureVisibleTab,
				},
			} as any,
			limiter: new GlobalCaptureLimiter(),
		})
		expect(result).toEqual({ dataUrl: 'data:image/png;base64,PNG', tab })
		expect(captureVisibleTab).toHaveBeenCalledWith(2, { format: 'png' })
	})

	it('maps child-frame CSS coordinates through measured bitmap ratios with context', () => {
		expect(
			computeQuestionCrop({
				preparation: {
					transactionId: 'tx',
					anchorKey: 'anchor',
					localRectCssPx: { x: 10, y: 20, width: 100, height: 50 },
					viewportCssPx: { width: 800, height: 600 },
					fullyVisibleInFrame: true,
					scrollWasChanged: false,
				},
				frameTopLeftCssPx: { x: 200, y: 100 },
				bitmap: { width: 1600, height: 1200 },
				contextCssPx: 20,
			}),
		).toEqual({ x: 380, y: 200, width: 280, height: 180 })
	})

	it('serializes effects per tab in FIFO order', async () => {
		const lock = new TabEffectLock()
		const order: string[] = []
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const first = lock.runExclusive(1, async () => {
			order.push('first-start')
			await gate
			order.push('first-end')
		})
		const second = lock.runExclusive(1, async () => {
			order.push('second')
		})
		await Promise.resolve()
		expect(order).toEqual(['first-start'])
		release()
		await Promise.all([first, second])
		expect(order).toEqual(['first-start', 'first-end', 'second'])
	})
})
