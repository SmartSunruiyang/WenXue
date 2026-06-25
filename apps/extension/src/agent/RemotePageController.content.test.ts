// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { dispatchJsExecution } from './RemotePageController.content'

describe('dispatchJsExecution', () => {
	it('routes isolated to the PageController eval', async () => {
		const pc = { executeJavascript: vi.fn(async () => ({ success: true, message: 'iso' })) }
		const main = vi.fn(async () => ({ success: true, message: 'main' }))
		const r = await dispatchJsExecution(pc as any, main, ['return 1', { world: 'isolated' }])
		expect(pc.executeJavascript).toHaveBeenCalledWith('return 1')
		expect(main).not.toHaveBeenCalled()
		expect(r.message).toBe('iso')
	})

	it('routes main to the main-world executor', async () => {
		const pc = { executeJavascript: vi.fn() }
		const main = vi.fn(async () => ({ success: true, message: 'main' }))
		const r = await dispatchJsExecution(pc as any, main, ['return 1', { world: 'main' }])
		expect(main).toHaveBeenCalledWith('return 1')
		expect(pc.executeJavascript).not.toHaveBeenCalled()
		expect(r.message).toBe('main')
	})
})
