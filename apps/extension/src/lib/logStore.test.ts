import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LogDraft } from './logTypes'

const DB_NAME = 'page-agent-ext'
const openDatabases: Array<{ close(): void }> = []

function draft(overrides: Partial<LogDraft> = {}): LogDraft {
	return {
		ts: 1,
		level: 'info',
		source: 'system',
		context: 'background',
		message: 'message',
		...overrides,
	}
}

async function deleteDatabase() {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DB_NAME)
		request.onerror = () => reject(request.error)
		request.onsuccess = () => resolve()
	})
}

async function loadStore() {
	const store = await import('./logStore')
	const { getDB } = await import('./db')
	const db = await getDB()
	openDatabases.push(db)
	return { ...store, db }
}

describe('logStore', () => {
	beforeEach(async () => {
		vi.resetModules()
		await deleteDatabase()
	})

	afterEach(async () => {
		for (const db of openDatabases.splice(0)) {
			db.close()
		}
		vi.restoreAllMocks()
		vi.resetModules()
		await deleteDatabase()
	})

	it('treats an empty append as a no-op and lets IndexedDB assign ids', async () => {
		const { appendBatch, query } = await loadStore()

		await appendBatch([])
		await appendBatch([draft()])

		expect(await query({})).toEqual([{ ...draft(), id: 1 }])
	})

	it('adds a batch in one readwrite transaction', async () => {
		const { appendBatch, db, query } = await loadStore()
		const transaction = vi.spyOn(db, 'transaction')

		await appendBatch([
			draft({ message: 'first' }),
			draft({ message: 'second' }),
			draft({ message: 'third' }),
		])

		expect(transaction).toHaveBeenCalledTimes(1)
		expect(transaction).toHaveBeenCalledWith('logs', 'readwrite')
		expect((await query({})).map((entry) => entry.id)).toEqual([3, 2, 1])
	})

	it('queries newest first and uses descending ids as the stable order for equal timestamps', async () => {
		const { appendBatch, db, query } = await loadStore()
		await appendBatch([
			draft({ ts: 20, message: 'same-ts older id' }),
			draft({ ts: 10, message: 'oldest timestamp' }),
			draft({ ts: 20, message: 'same-ts newer id' }),
			draft({ ts: 30, message: 'newest timestamp' }),
		])
		const getAll = vi.spyOn(db, 'getAll').mockRejectedValue(new Error('getAll is forbidden'))
		const openCursor = vi.spyOn(IDBIndex.prototype, 'openCursor')

		const entries = await query({ sinceTs: 10, untilTs: 30 })

		expect(getAll).not.toHaveBeenCalled()
		expect(openCursor).toHaveBeenCalledWith(expect.any(IDBKeyRange), 'prev')
		expect(entries.map((entry) => entry.message)).toEqual([
			'newest timestamp',
			'same-ts newer id',
			'same-ts older id',
			'oldest timestamp',
		])
		expect(entries.every((entry) => Number.isInteger(entry.id))).toBe(true)
	})

	it('filters by level and source arrays', async () => {
		const { appendBatch, query } = await loadStore()
		await appendBatch([
			draft({ level: 'debug', source: 'agent', message: 'debug-agent' }),
			draft({ level: 'warn', source: 'llm', message: 'warn-llm' }),
			draft({ level: 'error', source: 'page', message: 'error-page' }),
			draft({ level: 'info', source: 'agent', message: 'info-agent' }),
		])

		const entries = await query({
			level: ['debug', 'warn', 'error'],
			source: ['agent', 'llm'],
		})

		expect(entries.map((entry) => entry.message)).toEqual(['warn-llm', 'debug-agent'])
		expect(await query({ level: [] })).toEqual([])
		expect(await query({ source: [] })).toEqual([])
	})

	it('includes both timestamp boundaries', async () => {
		const { appendBatch, query } = await loadStore()
		await appendBatch([
			draft({ ts: 99, message: 'before' }),
			draft({ ts: 100, message: 'since boundary' }),
			draft({ ts: 200, message: 'until boundary' }),
			draft({ ts: 201, message: 'after' }),
		])

		const entries = await query({ sinceTs: 100, untilTs: 200 })

		expect(entries.map((entry) => entry.message)).toEqual(['until boundary', 'since boundary'])
	})

	it('searches message text case-insensitively', async () => {
		const { appendBatch, query } = await loadStore()
		await appendBatch([
			draft({ message: 'Agent Started' }),
			draft({ message: 'agent stopped' }),
			draft({ message: 'unrelated' }),
		])

		const entries = await query({ text: 'AGENT' })

		expect(entries.map((entry) => entry.message)).toEqual(['agent stopped', 'Agent Started'])
	})

	it('applies beforeId exclusively and normalizes limits safely', async () => {
		const { appendBatch, query } = await loadStore()
		await appendBatch(
			Array.from({ length: 6 }, (_, index) =>
				draft({ ts: index + 1, message: `entry-${index + 1}` })
			)
		)

		expect((await query({ limit: 2 })).map((entry) => entry.id)).toEqual([6, 5])
		expect((await query({ beforeId: 5, limit: 2 })).map((entry) => entry.id)).toEqual([4, 3])
		expect(await query({ limit: 0 })).toEqual([])
		expect(await query({ limit: -10 })).toEqual([])
	})

	it('stops advancing the cursor as soon as the requested limit is collected', async () => {
		const { appendBatch, query } = await loadStore()
		await appendBatch([
			draft({ ts: 1, message: 'first' }),
			draft({ ts: 2, message: 'second' }),
			draft({ ts: 3, message: 'third' }),
		])
		const cursorContinue = vi.spyOn(IDBCursor.prototype, 'continue')

		expect(await query({ limit: 1 })).toHaveLength(1)
		expect(cursorContinue).not.toHaveBeenCalled()
	})

	it('paginates timestamp order without gaps when ids arrive out of timestamp order', async () => {
		const { appendBatch, query } = await loadStore()
		await appendBatch([
			draft({ ts: 300, message: 'newest-low-id' }),
			draft({ ts: 100, message: 'oldest' }),
			draft({ ts: 300, message: 'newest-high-id' }),
			draft({ ts: 200, message: 'middle-high-id' }),
		])

		const firstPage = await query({ limit: 2 })
		const secondPage = await query({ limit: 2, beforeId: firstPage.at(-1)!.id })

		expect([...firstPage, ...secondPage].map((entry) => entry.message)).toEqual([
			'newest-high-id',
			'newest-low-id',
			'middle-high-id',
			'oldest',
		])
		expect(new Set([...firstPage, ...secondPage].map((entry) => entry.id))).toHaveLength(4)
		expect(await query({ beforeId: 9999 })).toEqual([])
	})

	it('uses a default query limit of 500 but exports every matching entry', async () => {
		const { appendBatch, exportAll, query } = await loadStore()
		await appendBatch(
			Array.from({ length: 501 }, (_, index) =>
				draft({
					ts: index,
					level: index % 2 === 0 ? 'info' : 'warn',
					message: `entry-${index}`,
				})
			)
		)

		expect(await query({})).toHaveLength(500)
		expect(await exportAll()).toHaveLength(501)
		expect(await exportAll({ limit: 1 })).toHaveLength(501)
		expect(await exportAll({ level: ['warn'] })).toHaveLength(250)
	})

	it('clears all log entries', async () => {
		const { appendBatch, clear, exportAll } = await loadStore()
		await appendBatch([draft(), draft({ message: 'another' })])

		await clear()

		expect(await exportAll()).toEqual([])
	})

	const DAY = 86_400_000

	it('purges entries older than retentionDays', async () => {
		const { appendBatch, purge, query } = await loadStore()
		const now = 10 * DAY
		await appendBatch([
			draft({ ts: now - 4 * DAY, message: 'old' }),
			draft({ ts: now - 1 * DAY, message: 'recent' }),
		])

		const { removed } = await purge({ retentionDays: 3, maxEntries: 9999, now })

		expect(removed).toBe(1)
		const remaining = await query({})
		expect(remaining).toHaveLength(1)
		expect(remaining[0].message).toBe('recent')
	})

	it('trims oldest entries beyond maxEntries', async () => {
		const { appendBatch, purge, query } = await loadStore()
		const now = 10 * DAY
		await appendBatch([
			draft({ ts: now - 3, message: 'oldest' }),
			draft({ ts: now - 2, message: 'middle' }),
			draft({ ts: now - 1, message: 'newest' }),
		])

		const { removed } = await purge({ retentionDays: 9999, maxEntries: 2, now })

		expect(removed).toBe(1)
		const remaining = await query({})
		expect(remaining).toHaveLength(2)
		expect(remaining.map((r) => r.message)).toEqual(['newest', 'middle'])
	})

	it('combines time and size purge in one call', async () => {
		const { appendBatch, purge, query } = await loadStore()
		const now = 10 * DAY
		await appendBatch([
			draft({ ts: now - 5 * DAY, message: 'expired-1' }),
			draft({ ts: now - 4 * DAY, message: 'expired-2' }),
			draft({ ts: now - 1 * DAY, message: 'recent-1' }),
			draft({ ts: now - 0.5 * DAY, message: 'recent-2' }),
			draft({ ts: now, message: 'recent-3' }),
		])

		const { removed } = await purge({ retentionDays: 3, maxEntries: 2, now })

		// 2 expired (ts < now - 3*DAY) + 1 excess (3 remaining, maxEntries=2 → trim 1 oldest)
		expect(removed).toBe(3)
		const remaining = await query({})
		expect(remaining).toHaveLength(2)
		expect(remaining.map((r) => r.message)).toEqual(['recent-3', 'recent-2'])
	})

	it('returns removed=0 when nothing to purge', async () => {
		const { appendBatch, purge, query } = await loadStore()
		await appendBatch([draft({ ts: 1000 })])

		const { removed } = await purge({ retentionDays: 9999, maxEntries: 9999, now: 2000 })

		expect(removed).toBe(0)
		expect(await query({})).toHaveLength(1)
	})
})
