import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./logStore', () => ({
	appendBatch: vi.fn().mockResolvedValue(undefined),
	query: vi.fn().mockResolvedValue([{ id: 1, ts: 100, message: 'mock' }]),
	exportAll: vi.fn().mockResolvedValue([{ id: 1, ts: 100, message: 'mock' }]),
	clear: vi.fn().mockResolvedValue(undefined),
}))

import { handleLogControlMessage } from './log.background'
import { appendBatch, clear, exportAll, query } from './logStore'

const sender = {} as chrome.runtime.MessageSender

describe('handleLogControlMessage', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns undefined for non-LOG messages', () => {
		const result = handleLogControlMessage(
			{ type: 'TAB_CONTROL' } as any,
			sender,
			vi.fn(),
		)
		expect(result).toBeUndefined()
	})

	it('handles LOG_APPEND by calling appendBatch', async () => {
		const sendResponse = vi.fn()
		const entries = [{ ts: 1, level: 'info', source: 'system', context: 'background', message: 'hi' }]

		const result = handleLogControlMessage(
			{ type: 'LOG_APPEND', entries } as any,
			sender,
			sendResponse,
		)

		expect(result).toBe(true)
		expect(appendBatch).toHaveBeenCalledWith(entries)

		// Wait for the async resolution
		await vi.waitFor(() => {
			expect(sendResponse).toHaveBeenCalledWith({ ok: true })
		})
	})

	it('handles LOG_QUERY by calling query and returning entries', async () => {
		const sendResponse = vi.fn()
		const filter = { level: ['error'] }

		handleLogControlMessage(
			{ type: 'LOG_QUERY', filter } as any,
			sender,
			sendResponse,
		)

		await vi.waitFor(() => {
			expect(query).toHaveBeenCalledWith(filter)
			expect(sendResponse).toHaveBeenCalledWith({
				entries: [{ id: 1, ts: 100, message: 'mock' }],
			})
		})
	})

	it('handles LOG_EXPORT by calling exportAll', async () => {
		const sendResponse = vi.fn()

		handleLogControlMessage(
			{ type: 'LOG_EXPORT', filter: { source: ['llm'] } } as any,
			sender,
			sendResponse,
		)

		await vi.waitFor(() => {
			expect(exportAll).toHaveBeenCalledWith({ source: ['llm'] })
			expect(sendResponse).toHaveBeenCalledWith({
				entries: [{ id: 1, ts: 100, message: 'mock' }],
			})
		})
	})

	it('handles LOG_EXPORT without filter', async () => {
		const sendResponse = vi.fn()

		handleLogControlMessage(
			{ type: 'LOG_EXPORT' } as any,
			sender,
			sendResponse,
		)

		await vi.waitFor(() => {
			expect(exportAll).toHaveBeenCalledWith(undefined)
		})
	})

	it('handles LOG_CLEAR by calling clear', async () => {
		const sendResponse = vi.fn()

		handleLogControlMessage(
			{ type: 'LOG_CLEAR' } as any,
			sender,
			sendResponse,
		)

		await vi.waitFor(() => {
			expect(clear).toHaveBeenCalled()
			expect(sendResponse).toHaveBeenCalledWith({ ok: true })
		})
	})

	it('sends error response when a store call rejects', async () => {
		vi.mocked(appendBatch).mockRejectedValueOnce(new Error('db full'))
		const sendResponse = vi.fn()

		handleLogControlMessage(
			{ type: 'LOG_APPEND', entries: [] } as any,
			sender,
			sendResponse,
		)

		await vi.waitFor(() => {
			expect(sendResponse).toHaveBeenCalledWith({ error: 'Error: db full' })
		})
	})
})
