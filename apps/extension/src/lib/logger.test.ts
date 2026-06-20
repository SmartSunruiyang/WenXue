import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./logStore', () => ({
	appendBatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./logRedaction', () => ({
	redact: vi.fn((v: unknown) => v),
}))

import { appendBatch } from './logStore'
import { redact } from './logRedaction'

describe('logger', () => {
	let loggerModule: typeof import('./logger')

	beforeEach(async () => {
		vi.useFakeTimers()
		vi.resetModules()
		vi.clearAllMocks()
		loggerModule = await import('./logger')
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('batches entries and flushes when flushSize is reached', async () => {
		loggerModule.configureLogger({ context: 'sidepanel', sink: 'direct', flushSize: 3, flushMs: 60_000 })

		loggerModule.logger.info('system', 'one')
		loggerModule.logger.info('system', 'two')
		expect(appendBatch).not.toHaveBeenCalled()

		loggerModule.logger.info('system', 'three')
		expect(appendBatch).toHaveBeenCalledTimes(1)
		expect(appendBatch).toHaveBeenCalledWith([
			expect.objectContaining({ message: 'one', level: 'info', source: 'system', context: 'sidepanel' }),
			expect.objectContaining({ message: 'two' }),
			expect.objectContaining({ message: 'three' }),
		])
	})

	it('flushes after flushMs timeout', async () => {
		loggerModule.configureLogger({ context: 'hub', sink: 'direct', flushSize: 100, flushMs: 500 })

		loggerModule.logger.warn('llm', 'slow')

		expect(appendBatch).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(500)

		expect(appendBatch).toHaveBeenCalledTimes(1)
		expect(appendBatch).toHaveBeenCalledWith([
			expect.objectContaining({ message: 'slow', level: 'warn' }),
		])
	})

	it('redacts data before buffering', () => {
		vi.mocked(redact).mockReturnValueOnce({ safe: true })
		loggerModule.configureLogger({ context: 'background', sink: 'direct', flushSize: 1 })

		loggerModule.logger.info('agent', 'task', { apiKey: 'sk-secret' })

		expect(redact).toHaveBeenCalledWith({ apiKey: 'sk-secret' })
		expect(appendBatch).toHaveBeenCalledWith([
			expect.objectContaining({ data: { safe: true } }),
		])
	})

	it('uses message sink when configured', async () => {
		const sendMessage = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal('chrome', { runtime: { sendMessage } })

		loggerModule.configureLogger({ context: 'content', sink: 'message', flushSize: 1 })

		loggerModule.logger.error('chaoxing', 'extract failed')

		expect(sendMessage).toHaveBeenCalledWith({
			type: 'LOG_APPEND',
			entries: [expect.objectContaining({ message: 'extract failed', level: 'error' })],
		})
		expect(appendBatch).not.toHaveBeenCalled()
	})

	it('swallows errors from appendBatch without throwing', async () => {
		vi.mocked(appendBatch).mockRejectedValueOnce(new Error('idb down'))
		loggerModule.configureLogger({ context: 'background', sink: 'direct', flushSize: 1 })

		// Should not throw
		expect(() => {
			loggerModule.logger.info('system', 'test')
		}).not.toThrow()

		// Wait for the flush to complete
		await vi.waitFor(() => {
			expect(appendBatch).toHaveBeenCalled()
		})
	})

	it('includes ts in each entry', () => {
		const now = 1719000000000
		vi.setSystemTime(now)
		loggerModule.configureLogger({ context: 'background', sink: 'direct', flushSize: 1 })

		loggerModule.logger.debug('agent', 'step')

		expect(appendBatch).toHaveBeenCalledWith([
			expect.objectContaining({ ts: now }),
		])
	})

	it('flushLogger manually flushes remaining buffer', async () => {
		loggerModule.configureLogger({ context: 'hub', sink: 'direct', flushSize: 100, flushMs: 60_000 })

		loggerModule.logger.info('tabs', 'created')
		loggerModule.logger.info('tabs', 'closed')

		expect(appendBatch).not.toHaveBeenCalled()

		await loggerModule.flushLogger()

		expect(appendBatch).toHaveBeenCalledTimes(1)
		expect(appendBatch).toHaveBeenCalledWith([
			expect.objectContaining({ message: 'created' }),
			expect.objectContaining({ message: 'closed' }),
		])
	})
})
