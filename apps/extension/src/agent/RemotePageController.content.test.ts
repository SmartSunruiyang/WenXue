// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	detectProtectedInterruptionInDocument,
	dispatchJsExecution,
} from './RemotePageController.content'

afterEach(() => {
	vi.useRealTimers()
})

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
		expect(main).toHaveBeenCalledWith('return 1', expect.any(AbortSignal))
		expect(pc.executeJavascript).not.toHaveBeenCalled()
		expect(r.message).toBe('main')
	})

	it('returns a timeout result after 10 seconds', async () => {
		vi.useFakeTimers()
		const pc = { executeJavascript: vi.fn(() => new Promise<any>(() => {})) }
		const main = vi.fn()

		const r = dispatchJsExecution(pc as any, main, ['return slow()', { world: 'isolated' }])
		await vi.advanceTimersByTimeAsync(10_000)

		await expect(r).resolves.toEqual({
			success: false,
			message: '❌ 执行超时（10s）',
		})
	})

	it('aborts main-world execution when the timeout wins', async () => {
		vi.useFakeTimers()
		const pc = { executeJavascript: vi.fn() }
		const main = vi.fn((_script: string, _signal?: AbortSignal) => new Promise<any>(() => {}))

		const r = dispatchJsExecution(pc as any, main as any, ['return slow()', { world: 'main' }])
		await vi.advanceTimersByTimeAsync(10_000)

		await expect(r).resolves.toEqual({
			success: false,
			message: '❌ 执行超时（10s）',
		})
		expect((main.mock.calls[0][1] as AbortSignal).aborted).toBe(true)
	})
})

describe('protected visual interruption probe', () => {
	it('reports only the kind of visible verification or login-secret controls', () => {
		document.body.innerHTML = `
			<div class="yidun_slider"><span>Drag to verify 7391</span></div>
			<input type="password" value="secret">
		`

		expect(detectProtectedInterruptionInDocument()).toEqual({
			blocked: true,
			kind: 'slider',
		})
	})

	it('ignores hidden challenge templates', () => {
		document.body.innerHTML = '<div class="captcha-dialog" hidden>1234</div>'

		expect(detectProtectedInterruptionInDocument()).toEqual({ blocked: false })
	})
})
