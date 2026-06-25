import type { HistoricalEvent } from '@page-agent/core'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import type { LogEntry } from './logTypes'

const DB_NAME = 'page-agent-ext'
const DB_VERSION = 3

export interface SessionRecord {
	id: string
	conversationId: string
	task: string
	history: HistoricalEvent[]
	status: 'completed' | 'error'
	createdAt: number
	updatedAt: number
}

interface PageAgentDB extends DBSchema {
	sessions: {
		key: string
		value: SessionRecord
		indexes: { 'by-created': number; 'by-conversation': string }
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
			upgrade(db, oldVersion, _newVersion, transaction) {
				let sessionsStore
				if (oldVersion < 1) {
					sessionsStore = db.createObjectStore('sessions', { keyPath: 'id' })
					sessionsStore.createIndex('by-created', 'createdAt')
					sessionsStore.createIndex('by-conversation', 'conversationId')
				} else {
					sessionsStore = transaction.objectStore('sessions')
				}
				if (oldVersion < 2) {
					const store = db.createObjectStore('logs', {
						keyPath: 'id',
						autoIncrement: true,
					})
					store.createIndex('by-ts', 'ts')
				}
				if (oldVersion > 0 && oldVersion < 3) {
					if (!sessionsStore.indexNames.contains('by-conversation')) {
						sessionsStore.createIndex('by-conversation', 'conversationId')
					}
					void migrateLegacySessions(sessionsStore)
				}
			},
		})
	}
	return dbPromise
}

async function migrateLegacySessions(
	store: ReturnType<IDBPDatabase<PageAgentDB>['transaction']>['store'],
): Promise<void> {
	let cursor = await store.openCursor()
	while (cursor) {
		const value = cursor.value
		if (!value.conversationId || !value.updatedAt) {
			await cursor.update({
				...value,
				conversationId: value.conversationId ?? value.id,
				updatedAt: value.updatedAt ?? value.createdAt,
			})
		}
		cursor = await cursor.continue()
	}
}

export async function saveSession(
	session: Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<SessionRecord> {
	const db = await getDB()
	const now = Date.now()
	const record: SessionRecord = {
		...session,
		id: crypto.randomUUID(),
		createdAt: now,
		updatedAt: now,
	}
	await db.put('sessions', record)
	return record
}

export async function updateSession(
	conversationId: string,
	patch: Pick<SessionRecord, 'task' | 'history' | 'status'>,
): Promise<SessionRecord> {
	const existing = await getByConversation(conversationId)
	if (!existing) {
		return saveSession({ conversationId, ...patch })
	}

	const db = await getDB()
	const updated: SessionRecord = {
		...existing,
		...patch,
		updatedAt: Date.now(),
	}
	await db.put('sessions', updated)
	return updated
}

export async function getByConversation(
	conversationId: string,
): Promise<SessionRecord | undefined> {
	const db = await getDB()
	return db.getFromIndex('sessions', 'by-conversation', conversationId)
}

/** List sessions, newest first */
export async function listSessions(): Promise<SessionRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('sessions', 'by-created')
	return all.sort((a, b) => b.updatedAt - a.updatedAt)
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
