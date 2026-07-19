import { describe, expect, it, vi } from 'vitest'

import { delayWithAbort, raceWithAbort } from './asyncControl'

describe('question solver abort control', () => {
	it('removes the abort listener after a raced operation settles normally', async () => {
		const signal = new AbortController().signal
		const remove = vi.spyOn(signal, 'removeEventListener')

		await expect(raceWithAbort(Promise.resolve('done'), signal)).resolves.toBe('done')
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
	})

	it('clears the timer listener after a normal delay and rejects promptly on abort', async () => {
		vi.useFakeTimers()
		const normalSignal = new AbortController().signal
		const remove = vi.spyOn(normalSignal, 'removeEventListener')
		const waiting = delayWithAbort(10, normalSignal)
		await vi.advanceTimersByTimeAsync(10)
		await expect(waiting).resolves.toBeUndefined()
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))

		const controller = new AbortController()
		const aborted = delayWithAbort(10_000, controller.signal)
		controller.abort(new DOMException('stopped', 'AbortError'))
		await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
		vi.useRealTimers()
	})
})
