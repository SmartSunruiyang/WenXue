import type { HistoricalEvent } from '@page-agent/core'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import type { LogEntry } from './logTypes'

const DB_NAME = 'page-agent-ext'
const DB_VERSION = 2

export interface SessionRecord {
	id: string
	task: string
	history: HistoricalEvent[]
	status: 'completed' | 'error'
	createdAt: number
}

interface PageAgentDB extends DBSchema {
	sessions: {
		key: string
		value: SessionRecord
		indexes: { 'by-created': number }
	}
	logs: {
		key: number
		value: LogEntry
		indexes: { 'by-ts': number }
	}
}

let dbPromise: Promise<IDBPDatabase<PageAgentDB>> | null = null

export function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<PageAgentDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion) {
				if (oldVersion < 1) {
					const store = db.createObjectStore('sessions', { keyPath: 'id' })
					store.createIndex('by-created', 'createdAt')
				}
				if (oldVersion < 2) {
					const store = db.createObjectStore('logs', {
						keyPath: 'id',
						autoIncrement: true,
					})
					store.createIndex('by-ts', 'ts')
				}
			},
		})
	}
	return dbPromise
}

export async function saveSession(
	session: Omit<SessionRecord, 'id' | 'createdAt'>
): Promise<SessionRecord> {
	const db = await getDB()
	const record: SessionRecord = {
		...session,
		id: crypto.randomUUID(),
		createdAt: Date.now(),
	}
	await db.put('sessions', record)
	return record
}

/** List sessions, newest first */
export async function listSessions(): Promise<SessionRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('sessions', 'by-created')
	return all.reverse()
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
	const db = await getDB()
	return db.get('sessions', id)
}

export async function deleteSession(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('sessions', id)
}

export async function clearSessions(): Promise<void> {
	const db = await getDB()
	await db.clear('sessions')
}
