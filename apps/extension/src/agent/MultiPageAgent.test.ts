import { describe, expect, it, vi } from 'vitest'

import { createAgentRuntimeLifecycle } from './MultiPageAgent'

describe('createAgentRuntimeLifecycle', () => {
	it('starts and stops idempotently, then starts again after pause', async () => {
		const setStorage = vi.fn(async () => {})
		const setInterval = vi.fn((_callback: () => void, _delay: number) => 7)
		const clearInterval = vi.fn()
		const runtime = createAgentRuntimeLifecycle({
			setStorage,
			setInterval,
			clearInterval,
			now: () => 123,
		})

		await runtime.start()
		await runtime.start()

		expect(setInterval).toHaveBeenCalledOnce()
		expect(setStorage).toHaveBeenCalledWith({ isAgentRunning: true })
		expect(setStorage).toHaveBeenCalledTimes(1)

		const heartbeat = setInterval.mock.calls[0][0]
		heartbeat()
		expect(setStorage).toHaveBeenCalledWith({ agentHeartbeat: 123 })

		await runtime.stop()
		await runtime.stop()

		expect(clearInterval).toHaveBeenCalledOnce()
		expect(clearInterval).toHaveBeenCalledWith(7)
		expect(setStorage).toHaveBeenCalledWith({ isAgentRunning: false })

		await runtime.start()

		expect(setInterval).toHaveBeenCalledTimes(2)
		expect(setStorage.mock.calls.filter(([value]) => value.isAgentRunning === true)).toHaveLength(2)
	})
})
