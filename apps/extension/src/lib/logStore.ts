import { getDB } from './db'
import type { LogDraft, LogEntry, LogQueryFilter } from './logTypes'

const DEFAULT_QUERY_LIMIT = 500

export async function appendBatch(entries: LogDraft[]): Promise<void> {
	if (entries.length === 0) return

	const db = await getDB()
	const transaction = db.transaction('logs', 'readwrite')
	await Promise.all([
		...entries.map((entry) => transaction.store.add(entry as LogEntry)),
		transaction.done,
	])
}

export async function query(filter: LogQueryFilter): Promise<LogEntry[]> {
	return findMatches(filter, filter.limit ?? DEFAULT_QUERY_LIMIT)
}

export async function exportAll(filter: LogQueryFilter = {}): Promise<LogEntry[]> {
	return findMatches(filter, undefined)
}

export async function clear(): Promise<void> {
	const db = await getDB()
	await db.clear('logs')
}

const DAY_MS = 86_400_000

export async function purge(opts: {
	retentionDays: number
	maxEntries: number
	now: number
}): Promise<{ removed: number }> {
	const db = await getDB()
	const tx = db.transaction('logs', 'readwrite')
	const idx = tx.store.index('by-ts')
	let removed = 0

	// 1. 删除过期条目（ts < now - retentionDays * DAY）
	const cutoff = opts.now - opts.retentionDays * DAY_MS
	let cursor = await idx.openCursor(IDBKeyRange.upperBound(cutoff, true))
	while (cursor) {
		await cursor.delete()
		removed++
		cursor = await cursor.continue()
	}

	// 2. 超量裁剪：按最旧优先删至 maxEntries 以内
	const remaining = await tx.store.count()
	let over = remaining - opts.maxEntries
	if (over > 0) {
		let trimCursor = await idx.openCursor(null, 'next') // oldest first
		while (trimCursor && over > 0) {
			await trimCursor.delete()
			removed++
			over--
			trimCursor = await trimCursor.continue()
		}
	}

	await tx.done
	return { removed }
}

async function findMatches(
	filter: LogQueryFilter,
	limit: number | undefined
): Promise<LogEntry[]> {
	const maxResults = limit === undefined ? Infinity : Math.max(0, Math.floor(limit))
	if (!(maxResults > 0)) return []

	const db = await getDB()
	const beforeEntry =
		filter.beforeId === undefined ? undefined : await db.get('logs', filter.beforeId)
	if (filter.beforeId !== undefined && beforeEntry === undefined) return []

	const upperTs =
		beforeEntry === undefined
			? filter.untilTs
			: filter.untilTs === undefined
				? beforeEntry.ts
				: Math.min(filter.untilTs, beforeEntry.ts)
	if (filter.sinceTs !== undefined && upperTs !== undefined && filter.sinceTs > upperTs) {
		return []
	}

	const range = timestampRange(filter.sinceTs, upperTs)
	const text = filter.text?.toLocaleLowerCase()
	const entries: LogEntry[] = []
	const transaction = db.transaction('logs', 'readonly')
	let cursor = await transaction.store.index('by-ts').openCursor(range, 'prev')

	while (cursor && entries.length < maxResults) {
		const entry = cursor.value
		const isAtOrAfterBeforeId =
			beforeEntry !== undefined && entry.ts === beforeEntry.ts && entry.id >= beforeEntry.id
		const matches =
			!isAtOrAfterBeforeId &&
			(!filter.level || filter.level.includes(entry.level)) &&
			(!filter.source || filter.source.includes(entry.source)) &&
			(text === undefined || entry.message.toLocaleLowerCase().includes(text))

		if (matches) {
			entries.push(entry)
			if (entries.length >= maxResults) break
		}
		cursor = await cursor.continue()
	}

	await transaction.done
	return entries
}

function timestampRange(
	sinceTs: number | undefined,
	untilTs: number | undefined
): IDBKeyRange | undefined {
	if (sinceTs !== undefined && untilTs !== undefined) {
		return IDBKeyRange.bound(sinceTs, untilTs)
	}
	if (sinceTs !== undefined) return IDBKeyRange.lowerBound(sinceTs)
	if (untilTs !== undefined) return IDBKeyRange.upperBound(untilTs)
	return undefined
}
