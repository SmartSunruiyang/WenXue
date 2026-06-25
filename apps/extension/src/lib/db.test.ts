import 'fake-indexeddb/auto'

import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DB_NAME = 'page-agent-ext'
const openDatabases: Array<{ close(): void }> = []

async function deleteDatabase() {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DB_NAME)
		request.onerror = () => reject(request.error)
		request.onsuccess = () => resolve()
	})
}

describe('PageAgentDB', () => {
	beforeEach(async () => {
		vi.resetModules()
		await deleteDatabase()
	})

	afterEach(async () => {
		for (const db of openDatabases.splice(0)) {
			db.close()
		}
		vi.resetModules()
		await deleteDatabase()
	})

	it('creates sessions and logs stores with the logs timestamp index', async () => {
		const { getDB } = await import('./db')
		const db = await getDB()
		openDatabases.push(db)

		expect(db.version).toBe(3)
		expect(Array.from(db.objectStoreNames)).toEqual(['logs', 'sessions'])
		expect(Array.from(db.transaction('sessions').store.indexNames)).toEqual([
			'by-conversation',
			'by-created',
		])
		expect(Array.from(db.transaction('logs').store.indexNames)).toEqual(['by-ts'])
	})

	it('preserves sessions when upgrading a version 1 database', async () => {
		const legacyDB = await openDB(DB_NAME, 1, {
			upgrade(db) {
				const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
				sessions.createIndex('by-created', 'createdAt')
			},
		})
		await legacyDB.put('sessions', {
			id: 'legacy-session',
			task: 'keep me',
			history: [],
			status: 'completed',
			createdAt: 1,
		})
		legacyDB.close()

		const { getDB } = await import('./db')
		const db = await getDB()
		openDatabases.push(db)

		expect(db.version).toBe(3)
		expect(await db.get('sessions', 'legacy-session')).toMatchObject({
			conversationId: 'legacy-session',
			id: 'legacy-session',
			task: 'keep me',
			updatedAt: 1,
		})
		expect(db.objectStoreNames.contains('logs')).toBe(true)
		expect(db.transaction('logs').store.indexNames.contains('by-ts')).toBe(true)
	})

	it('upserts one record per conversationId', async () => {
		const { getDB, listSessions, saveSession, updateSession } = await import('./db')
		openDatabases.push(await getDB())

		const first = await saveSession({
			conversationId: 'c1',
			task: 'A',
			history: [],
			status: 'completed',
		})
		await updateSession('c1', {
			task: 'B',
			history: [{ type: 'user_message', content: 'B' } as never],
			status: 'completed',
		})

		const all = await listSessions()
		const c1 = all.filter((record) => record.conversationId === 'c1')
		expect(c1).toHaveLength(1)
		expect(c1[0].id).toBe(first.id)
		expect(c1[0].task).toBe('B')
		expect(c1[0].updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
	})
})
