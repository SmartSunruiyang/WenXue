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

		expect(db.version).toBe(2)
		expect(Array.from(db.objectStoreNames)).toEqual(['logs', 'sessions'])
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

		expect(db.version).toBe(2)
		expect(await db.get('sessions', 'legacy-session')).toMatchObject({
			id: 'legacy-session',
			task: 'keep me',
		})
		expect(db.objectStoreNames.contains('logs')).toBe(true)
		expect(db.transaction('logs').store.indexNames.contains('by-ts')).toBe(true)
	})
})
