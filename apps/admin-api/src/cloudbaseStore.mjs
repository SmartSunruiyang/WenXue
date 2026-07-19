import cloudbase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'

/** @typedef {import('./adminApi.mjs').AdminStore} AdminStore */

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const ADMIN_USERS_COLLECTION = 'admin_users'
const USER_ACCOUNTS_COLLECTION = 'user_accounts'
const USER_PERMISSION_AUDIT_COLLECTION = 'user_permission_audit'
const TOKEN_USAGE_COLLECTION = 'token_usage'
const CLIENT_ANNOUNCEMENTS_COLLECTION = 'client_announcements'
const CLIENT_ANNOUNCEMENT_RECEIPTS_COLLECTION = 'client_announcement_receipts'
const DESKTOP_ANNOUNCEMENT_SIGNAL_COLLECTION = 'desktop_announcement_signal'
const DESKTOP_RELEASE_CANDIDATES_COLLECTION = 'desktop_release_candidates'
const DESKTOP_RELEASE_ROLLOUTS_COLLECTION = 'desktop_release_rollouts'
const DESKTOP_RELEASE_EVENTS_COLLECTION = 'desktop_release_events'
const DESKTOP_RELEASE_SIGNAL_COLLECTION = 'desktop_release_signal'
const ADMIN_DISPATCH_AUDIT_COLLECTION = 'admin_dispatch_audit'
const ANNOUNCEMENT_RECEIPT_QUERY_CHUNK_SIZE = 50
const ANNOUNCEMENT_RECEIPT_CLEANUP_LIMIT = 20
const RELEASE_EVENT_CLEANUP_LIMIT = 20
const RELEASE_SLOT_DOCUMENT_LIMIT = 6
const RELEASE_SLOT_PUBLISHED_AT = '1970-01-01T00:00:00.000Z'
const TRANSACTION_CONFLICT_RETRY_BASE_MS = 25
const TRANSACTION_CONFLICT_RETRY_MAX_MS = 400
const TRANSACTION_CONFLICT_RETRY_ATTEMPTS = 5
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/**
 * @param {{ envId: string, apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number, transactionDatabase?: TransactionDatabase, sleepImpl?: (delayMs: number) => Promise<void>, randomImpl?: () => number }} input
 * @returns {AdminStore}
 */
export function createCloudBaseAdminStore(input) {
	const client = createCloudBaseNoSqlClient(input)
	const transactionDatabase =
		input.transactionDatabase ?? cloudbase.init({ env: input.envId }).database()
	const sleepImpl = input.sleepImpl ?? sleep
	const randomImpl = input.randomImpl ?? Math.random

	return {
		async getAdminUser(uid) {
			return client.getById(ADMIN_USERS_COLLECTION, uid)
		},
		async listUsageRecords(filter) {
			const limit = filter.limit ?? 5000
			const result = await client.query(TOKEN_USAGE_COLLECTION, {
				query: buildUsageQuery(filter),
				order: [{ field: 'ts', direction: 'desc' }],
				limit,
			})
			return result.filter((record) => matchesUsageFilter(record, filter))
		},
		async listUserAccounts(filter) {
			const result = await client.query(USER_ACCOUNTS_COLLECTION, {
				query: filter.status ? { active: filter.status === 'active' } : {},
				limit: filter.limit ?? 500,
			})
			return result.filter((record) => {
				if (!filter.q) return true
				return String(record.uid ?? record._id ?? '').includes(filter.q)
			})
		},
		async getUserAccount(userId) {
			return client.getById(USER_ACCOUNTS_COLLECTION, userId)
		},
		async updateUserAccount(userId, patch) {
			return (
				(await client.updateById(USER_ACCOUNTS_COLLECTION, userId, patch)) ??
				(await client.getById(USER_ACCOUNTS_COLLECTION, userId))
			)
		},
		async createUserPermissionAudit(record) {
			await client.insert(USER_PERMISSION_AUDIT_COLLECTION, record)
		},
		async listAnnouncements(filter) {
			const query = /** @type {Record<string, unknown>} */ ({})
			if (filter.status) query.status = filter.status
			if (filter.expiresAfter) query.expiresAt = { $gt: filter.expiresAfter }
			return client.query(CLIENT_ANNOUNCEMENTS_COLLECTION, {
				query,
				order: [{ field: 'publishedAt', direction: filter.direction ?? 'desc' }],
				limit: filter.limit ?? 200,
				skip: filter.skip,
			})
		},
		async getAnnouncement(id) {
			return client.getById(CLIENT_ANNOUNCEMENTS_COLLECTION, id)
		},
		async createAnnouncement(record) {
			await client.insert(CLIENT_ANNOUNCEMENTS_COLLECTION, record)
		},
		async updateAnnouncement(id, patch) {
			return client.updateById(CLIENT_ANNOUNCEMENTS_COLLECTION, id, patch)
		},
		async listAnnouncementReceipts(uid, announcementIds) {
			const uniqueIds = [...new Set(announcementIds)]
			const receipts = []
			for (
				let offset = 0;
				offset < uniqueIds.length;
				offset += ANNOUNCEMENT_RECEIPT_QUERY_CHUNK_SIZE
			) {
				const ids = uniqueIds
					.slice(offset, offset + ANNOUNCEMENT_RECEIPT_QUERY_CHUNK_SIZE)
					.map((announcementId) => `${announcementId}:${uid}`)
				receipts.push(
					...(await client.query(CLIENT_ANNOUNCEMENT_RECEIPTS_COLLECTION, {
						query: { _id: { $in: ids } },
						limit: ids.length,
					})),
				)
			}
			return receipts
		},
		async commitAnnouncementAcknowledgement(record) {
			return transactionDatabase.runTransaction(
				/** @param {TransactionHandle} transaction */ async (transaction) => {
					const id = readRequiredRecordId(record)
					const existing = await transactionGet(
						transaction,
						CLIENT_ANNOUNCEMENT_RECEIPTS_COLLECTION,
						id,
					)
					if (existing) return { created: false, record: existing }
					const uid = readString(record.uid)
					if (!uid) throw new Error('Announcement receipt is missing uid')
					const storedRecord = {
						...record,
						expiresAt: cloudBaseDate(record.expiresAt, 'announcement receipt expiresAt'),
					}
					const signalId = announcementAccountSignalId(uid)
					const signal = await transactionGet(
						transaction,
						DESKTOP_ANNOUNCEMENT_SIGNAL_COLLECTION,
						signalId,
					)
					await transactionSet(transaction, CLIENT_ANNOUNCEMENT_RECEIPTS_COLLECTION, storedRecord)
					await transactionSet(transaction, DESKTOP_ANNOUNCEMENT_SIGNAL_COLLECTION, {
						...(signal ?? {}),
						_id: signalId,
						uid,
						revision: readRevision(signal) + 1,
						updatedAt: record.acknowledgedAt,
					})
					return { created: true, record: storedRecord }
				},
			)
		},
		async cleanupExpiredAnnouncementReceipts(expiredAt) {
			const expired = await client.query(CLIENT_ANNOUNCEMENT_RECEIPTS_COLLECTION, {
				query: {
					expiresAt: {
						$lte: strictEjsonDate(expiredAt, 'announcement receipt cleanup threshold'),
					},
				},
				order: [{ field: 'expiresAt', direction: 'asc' }],
				limit: ANNOUNCEMENT_RECEIPT_CLEANUP_LIMIT,
			})
			const ids = expired
				.map((record) => readString(record._id))
				.filter((id) => id !== null)
				.slice(0, ANNOUNCEMENT_RECEIPT_CLEANUP_LIMIT)
			const results = await Promise.allSettled(
				ids.map((id) => client.deleteById(CLIENT_ANNOUNCEMENT_RECEIPTS_COLLECTION, id)),
			)
			return results.filter((result) => result.status === 'fulfilled' && result.value).length
		},
		async commitAnnouncementPublication(record, audit) {
			return transactionDatabase.runTransaction(
				/** @param {TransactionHandle} transaction */ async (transaction) => {
					const existing = await transactionGet(
						transaction,
						CLIENT_ANNOUNCEMENTS_COLLECTION,
						readRequiredRecordId(record),
					)
					if (existing) return { created: false, record: existing }
					const signal = await transactionGet(
						transaction,
						DESKTOP_ANNOUNCEMENT_SIGNAL_COLLECTION,
						'global',
					)
					await transactionSet(transaction, CLIENT_ANNOUNCEMENTS_COLLECTION, record)
					await transactionSet(transaction, ADMIN_DISPATCH_AUDIT_COLLECTION, audit)
					await transactionSet(transaction, DESKTOP_ANNOUNCEMENT_SIGNAL_COLLECTION, {
						...(signal ?? {}),
						_id: 'global',
						revision: readRevision(signal) + 1,
						updatedAt: record.publishedAt,
					})
					return { created: true, record }
				},
			)
		},
		async commitAnnouncementWithdrawal(updated, audit) {
			return transactionDatabase.runTransaction(
				/** @param {TransactionHandle} transaction */ async (transaction) => {
					const id = readRequiredRecordId(updated)
					const current = await transactionGet(transaction, CLIENT_ANNOUNCEMENTS_COLLECTION, id)
					if (!current) return { outcome: 'missing', record: null }
					if (current.status === 'withdrawn') return { outcome: 'unchanged', record: current }
					if (current.status !== 'published') {
						throw new DispatchConflictError('Announcement state changed during withdrawal')
					}
					const signal = await transactionGet(
						transaction,
						DESKTOP_ANNOUNCEMENT_SIGNAL_COLLECTION,
						'global',
					)
					await transactionSet(transaction, CLIENT_ANNOUNCEMENTS_COLLECTION, updated)
					await transactionSet(transaction, ADMIN_DISPATCH_AUDIT_COLLECTION, audit)
					await transactionSet(transaction, DESKTOP_ANNOUNCEMENT_SIGNAL_COLLECTION, {
						...(signal ?? {}),
						_id: 'global',
						revision: readRevision(signal) + 1,
						updatedAt: updated.withdrawnAt,
					})
					return { outcome: 'updated', record: updated }
				},
			)
		},
		async listReleaseCandidates(filter) {
			const query = /** @type {Record<string, unknown>} */ ({ status: 'verified' })
			if (filter.runtime) query.runtime = filter.runtime
			if (filter.channel) query.channel = filter.channel
			return client.query(DESKTOP_RELEASE_CANDIDATES_COLLECTION, {
				query,
				order: [{ field: 'registeredAt', direction: 'desc' }],
				limit: filter.limit ?? 200,
			})
		},
		async getReleaseCandidate(id) {
			return client.getById(DESKTOP_RELEASE_CANDIDATES_COLLECTION, id)
		},
		async findReleaseCandidate(runtime, channel, version) {
			const records = await client.query(DESKTOP_RELEASE_CANDIDATES_COLLECTION, {
				query: { runtime, channel, version },
				limit: 2,
			})
			return records[0] ?? null
		},
		async createReleaseCandidateIfAbsent(record) {
			return client.insertIfAbsent(DESKTOP_RELEASE_CANDIDATES_COLLECTION, record)
		},
		async listReleaseRollouts(filter) {
			const query = /** @type {Record<string, unknown>} */ ({})
			if (filter.runtime) query.runtime = filter.runtime
			if (filter.channel) query.channel = filter.channel
			const limit = filter.limit ?? 200
			const records = await client.query(DESKTOP_RELEASE_ROLLOUTS_COLLECTION, {
				query,
				order: [{ field: 'publishedAt', direction: 'desc' }],
				limit: limit + RELEASE_SLOT_DOCUMENT_LIMIT,
			})
			return records.filter((record) => record.recordType !== 'release-slot').slice(0, limit)
		},
		async getReleaseRollout(id) {
			return client.getById(DESKTOP_RELEASE_ROLLOUTS_COLLECTION, id)
		},
		async getReleaseActiveSlot(runtime, channel) {
			return client.getById(
				DESKTOP_RELEASE_ROLLOUTS_COLLECTION,
				releaseSlotDocumentId(runtime, channel),
			)
		},
		async createReleaseRollout(record) {
			await client.insert(DESKTOP_RELEASE_ROLLOUTS_COLLECTION, record)
		},
		async updateReleaseRollout(id, patch) {
			return client.updateById(DESKTOP_RELEASE_ROLLOUTS_COLLECTION, id, patch)
		},
		async incrementReleaseSignal(runtime, channel, updatedAt) {
			return client.incrementById(
				DESKTOP_RELEASE_SIGNAL_COLLECTION,
				`${runtime}:${channel}`,
				updatedAt,
			)
		},
		async commitReleasePublication(release, audit, legacyRolloutIds = [], versionGuard) {
			return transactionDatabase.runTransaction(
				/** @param {TransactionHandle} transaction */ async (transaction) => {
					const releaseId = readRequiredRecordId(release)
					const existing = await transactionGet(
						transaction,
						DESKTOP_RELEASE_ROLLOUTS_COLLECTION,
						releaseId,
					)
					if (existing) return { created: false, record: existing }
					const signalId = `${release.runtime}:${release.channel}`
					const slotId = releaseSlotDocumentId(release.runtime, release.channel)
					const slot = await transactionGet(
						transaction,
						DESKTOP_RELEASE_ROLLOUTS_COLLECTION,
						slotId,
					)
					const storedHighestVersion = readString(slot?.highestVersion)
					if (storedHighestVersion && !SEMVER_PATTERN.test(storedHighestVersion)) {
						throw new DispatchConflictError('Release slot version guard is invalid')
					}
					const highestVersion = highestSemver([
						storedHighestVersion,
						versionGuard?.highestPublishedVersion,
					])
					if (
						versionGuard &&
						highestVersion &&
						compareSemverValues(highestVersion, versionGuard.candidateVersion) >= 0
					) {
						throw new DispatchConflictError('Release version must move forward')
					}
					const signal = await transactionGet(
						transaction,
						DESKTOP_RELEASE_SIGNAL_COLLECTION,
						signalId,
					)
					const previousIds = new Set(
						legacyRolloutIds.filter((id) => id !== releaseId).slice(0, 20),
					)
					const currentRolloutId = readString(slot?.currentRolloutId)
					if (currentRolloutId && currentRolloutId !== releaseId && previousIds.size < 20) {
						previousIds.add(currentRolloutId)
					}
					for (const previousId of previousIds) {
						const previous = await transactionGet(
							transaction,
							DESKTOP_RELEASE_ROLLOUTS_COLLECTION,
							previousId,
						)
						if (!previous || (previous.status !== 'active' && previous.status !== 'paused'))
							continue
						await transactionSet(transaction, DESKTOP_RELEASE_ROLLOUTS_COLLECTION, {
							...previous,
							status: 'superseded',
							updatedAt: release.publishedAt,
							updatedBy: release.publishedBy,
						})
					}
					await transactionSet(transaction, DESKTOP_RELEASE_ROLLOUTS_COLLECTION, release)
					await transactionSet(transaction, ADMIN_DISPATCH_AUDIT_COLLECTION, audit)
					await transactionSet(transaction, DESKTOP_RELEASE_ROLLOUTS_COLLECTION, {
						_id: slotId,
						recordType: 'release-slot',
						runtime: release.runtime,
						channel: release.channel,
						publishedAt: RELEASE_SLOT_PUBLISHED_AT,
						currentRolloutId: releaseId,
						activeRolloutId: releaseId,
						...(versionGuard ? { highestVersion: versionGuard.candidateVersion } : {}),
						updatedAt: release.publishedAt,
					})
					await transactionSet(transaction, DESKTOP_RELEASE_SIGNAL_COLLECTION, {
						...(signal ?? {}),
						_id: signalId,
						revision: readRevision(signal) + 1,
						updatedAt: release.publishedAt,
					})
					return { created: true, record: release }
				},
			)
		},
		async commitReleaseState(updated, audit, expectedStatus) {
			return transactionDatabase.runTransaction(
				/** @param {TransactionHandle} transaction */ async (transaction) => {
					const releaseId = readRequiredRecordId(updated)
					const current = await transactionGet(
						transaction,
						DESKTOP_RELEASE_ROLLOUTS_COLLECTION,
						releaseId,
					)
					if (!current) return { outcome: 'missing', record: null }
					if (current.status === updated.status) return { outcome: 'unchanged', record: current }
					if (current.status !== expectedStatus) {
						throw new DispatchConflictError('Release state changed during transition')
					}
					const signalId = `${updated.runtime}:${updated.channel}`
					const slotId = releaseSlotDocumentId(updated.runtime, updated.channel)
					const slot = await transactionGet(
						transaction,
						DESKTOP_RELEASE_ROLLOUTS_COLLECTION,
						slotId,
					)
					const signal = await transactionGet(
						transaction,
						DESKTOP_RELEASE_SIGNAL_COLLECTION,
						signalId,
					)
					const currentRolloutId = readString(slot?.currentRolloutId)
					const activeRolloutId = readString(slot?.activeRolloutId)
					const highestVersion = readString(slot?.highestVersion)
					if (currentRolloutId && currentRolloutId !== releaseId) {
						throw new DispatchConflictError('Another rollout controls this channel')
					}
					if (updated.status === 'paused' && activeRolloutId && activeRolloutId !== releaseId) {
						throw new DispatchConflictError('Another rollout is active')
					}
					if (updated.status === 'active' && activeRolloutId && activeRolloutId !== releaseId) {
						throw new DispatchConflictError('Another rollout is active')
					}
					await transactionSet(transaction, DESKTOP_RELEASE_ROLLOUTS_COLLECTION, updated)
					await transactionSet(transaction, ADMIN_DISPATCH_AUDIT_COLLECTION, audit)
					await transactionSet(transaction, DESKTOP_RELEASE_ROLLOUTS_COLLECTION, {
						_id: slotId,
						recordType: 'release-slot',
						runtime: updated.runtime,
						channel: updated.channel,
						publishedAt: RELEASE_SLOT_PUBLISHED_AT,
						currentRolloutId: updated.status === 'withdrawn' ? null : releaseId,
						activeRolloutId: updated.status === 'active' ? releaseId : null,
						...(highestVersion ? { highestVersion } : {}),
						updatedAt: updated.updatedAt,
					})
					await transactionSet(transaction, DESKTOP_RELEASE_SIGNAL_COLLECTION, {
						...(signal ?? {}),
						_id: signalId,
						revision: readRevision(signal) + 1,
						updatedAt: updated.updatedAt,
					})
					return { outcome: 'updated', record: updated }
				},
			)
		},
		async createReleaseEventWithinQuota(record, quota) {
			return runTransactionWithConflictRetry(
				transactionDatabase,
				/** @param {TransactionHandle} transaction */ async (transaction) => {
					const id = readRequiredRecordId(record)
					const existing = await transactionGet(transaction, DESKTOP_RELEASE_EVENTS_COLLECTION, id)
					if (existing?.result === 'success' || (existing && record.result !== 'success')) {
						return { outcome: 'duplicate' }
					}
					if (existing) {
						await transactionSet(transaction, DESKTOP_RELEASE_EVENTS_COLLECTION, {
							...record,
							...(existing.createdAt ? { createdAt: existing.createdAt } : {}),
							expiresAt: cloudBaseDate(
								existing.expiresAt ?? record.expiresAt,
								'release event expiresAt',
							),
						})
						return { outcome: 'updated' }
					}

					const quotaId = readRequiredRecordId({ _id: quota.id })
					const quotaLimit = Number(quota.limit)
					if (!Number.isSafeInteger(quotaLimit) || quotaLimit <= 0) {
						throw new Error('Release event quota limit is invalid')
					}
					const currentQuota = await transactionGet(
						transaction,
						DESKTOP_RELEASE_EVENTS_COLLECTION,
						quotaId,
					)
					const currentCount = Number(currentQuota?.count ?? 0)
					if (!Number.isSafeInteger(currentCount) || currentCount < 0) {
						throw new Error('Release event quota record is invalid')
					}
					if (currentCount >= quotaLimit) return { outcome: 'quota-exceeded' }

					await transactionSet(transaction, DESKTOP_RELEASE_EVENTS_COLLECTION, {
						...record,
						expiresAt: cloudBaseDate(record.expiresAt, 'release event expiresAt'),
					})
					await transactionSet(transaction, DESKTOP_RELEASE_EVENTS_COLLECTION, {
						_id: quotaId,
						recordType: 'release-event-quota',
						count: currentCount + 1,
						limit: quotaLimit,
						updatedAt: record.createdAt,
						expiresAt: cloudBaseDate(quota.expiresAt, 'release event quota expiresAt'),
					})
					return { outcome: 'created' }
				},
				{ sleepImpl, randomImpl },
			)
		},
		async listReleaseEvents(filter) {
			const baseQuery = /** @type {Record<string, unknown>} */ ({})
			if (filter.createdAfter || filter.createdBefore) {
				baseQuery.createdAt = {
					...(filter.createdAfter ? { $gte: filter.createdAfter } : {}),
					...(filter.createdBefore ? { $lt: filter.createdBefore } : {}),
				}
			}
			if (filter.releaseId) baseQuery.releaseId = filter.releaseId
			const query = filter.before
				? {
						$and: [
							baseQuery,
							{
								$or: [
									{ createdAt: { $lt: filter.before.createdAt } },
									{
										createdAt: filter.before.createdAt,
										_id: { $lt: filter.before.id },
									},
								],
							},
						],
					}
				: baseQuery
			return client.query(DESKTOP_RELEASE_EVENTS_COLLECTION, {
				query,
				order: [
					{ field: 'createdAt', direction: 'desc' },
					{ field: '_id', direction: 'desc' },
				],
				limit: filter.limit ?? 5_000,
			})
		},
		async cleanupExpiredReleaseEvents(expiredAt) {
			const expired = await client.query(DESKTOP_RELEASE_EVENTS_COLLECTION, {
				query: {
					expiresAt: { $lte: strictEjsonDate(expiredAt, 'release event cleanup threshold') },
				},
				order: [{ field: 'expiresAt', direction: 'asc' }],
				limit: RELEASE_EVENT_CLEANUP_LIMIT,
			})
			const ids = expired
				.map((record) => readString(record._id))
				.filter((id) => id !== null)
				.slice(0, RELEASE_EVENT_CLEANUP_LIMIT)
			const results = await Promise.allSettled(
				ids.map((id) => client.deleteById(DESKTOP_RELEASE_EVENTS_COLLECTION, id)),
			)
			return results.filter((result) => result.status === 'fulfilled' && result.value).length
		},
		async createDispatchAudit(record) {
			await client.insert(ADMIN_DISPATCH_AUDIT_COLLECTION, record)
		},
	}
}

/**
 * @param {{ from?: number, to?: number, userId?: string, model?: string }} filter
 */
function buildUsageQuery(filter) {
	const query = /** @type {Record<string, unknown>} */ ({})
	if (filter.from !== undefined || filter.to !== undefined) {
		const ts = /** @type {Record<string, number>} */ ({})
		if (filter.from !== undefined) ts.$gte = filter.from
		if (filter.to !== undefined) ts.$lte = filter.to
		query.ts = ts
	}
	if (filter.userId) query.uid = filter.userId
	if (filter.model) query.model = filter.model
	return query
}

/**
 * @param {{ envId: string, apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} input
 */
function createCloudBaseNoSqlClient(input) {
	return {
		/**
		 * @param {string} collectionName
		 * @param {string} docId
		 * @returns {Promise<Record<string, unknown> | null>}
		 */
		async getById(collectionName, docId) {
			const response = await requestCloudBase(
				input,
				documentUrl(input.envId, collectionName, docId),
				{
					method: 'GET',
				},
			)
			if (response.status === 404) return null
			await assertCloudBaseOk(response, `read ${collectionName}`)
			const payload = normalizeEjson(await response.json())
			return isRecord(payload) ? payload : null
		},

		/**
		 * @param {string} collectionName
		 * @param {{ query?: Record<string, unknown>, order?: { field: string, direction: 'asc' | 'desc' }[], limit?: number, skip?: number }} options
		 * @returns {Promise<Record<string, unknown>[]>}
		 */
		async query(collectionName, options) {
			const url = collectionDocumentsUrl(input.envId, collectionName)
			url.searchParams.set('query', JSON.stringify(options.query ?? {}))
			if (options.order) {
				url.searchParams.set('order', JSON.stringify(options.order))
			}
			if (options.limit !== undefined) {
				url.searchParams.set('limit', String(options.limit))
			}
			if (options.skip !== undefined) {
				url.searchParams.set('skip', String(options.skip))
			}
			const response = await requestCloudBase(input, url, { method: 'GET' })
			await assertCloudBaseOk(response, `query ${collectionName}`)
			const payload = normalizeEjson(await response.json())
			return documents(payload)
		},

		/**
		 * @param {string} collectionName
		 * @param {string} docId
		 * @param {Record<string, unknown>} patch
		 * @returns {Promise<Record<string, unknown> | null>}
		 */
		async updateById(collectionName, docId, patch) {
			const response = await requestCloudBase(
				input,
				documentUrl(input.envId, collectionName, docId),
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						data: { $set: patch },
						replaceMode: false,
						returnDoc: true,
					}),
				},
			)
			if (response.status === 404) return null
			await assertCloudBaseOk(response, `update ${collectionName}`)
			const payload = normalizeEjson(await response.json())
			return isRecord(payload) && isRecord(payload.doc) ? payload.doc : null
		},

		/**
		 * @param {string} collectionName
		 * @param {string} docId
		 * @param {string} updatedAt
		 * @returns {Promise<Record<string, unknown> | null>}
		 */
		async incrementById(collectionName, docId, updatedAt) {
			const update = () =>
				requestCloudBase(input, documentUrl(input.envId, collectionName, docId), {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						data: {
							$inc: { revision: 1 },
							$set: { updatedAt },
						},
						replaceMode: false,
						returnDoc: true,
					}),
				})
			let response = await update()
			if (response.status === 404) {
				const inserted = await requestCloudBase(
					input,
					collectionDocumentsUrl(input.envId, collectionName),
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ data: [{ _id: docId, revision: 1, updatedAt }] }),
					},
				)
				if (inserted.status === 409) {
					response = await update()
				} else {
					await assertCloudBaseOk(inserted, `initialize ${collectionName}`)
					return { _id: docId, revision: 1, updatedAt }
				}
			}
			await assertCloudBaseOk(response, `increment ${collectionName}`)
			const payload = normalizeEjson(await response.json())
			return isRecord(payload) && isRecord(payload.doc) ? payload.doc : null
		},

		/**
		 * @param {string} collectionName
		 * @param {Record<string, unknown>} record
		 */
		async insert(collectionName, record) {
			const response = await requestCloudBase(
				input,
				collectionDocumentsUrl(input.envId, collectionName),
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ data: [record] }),
				},
			)
			await assertCloudBaseOk(response, `insert ${collectionName}`)
		},

		/**
		 * @param {string} collectionName
		 * @param {Record<string, unknown>} record
		 */
		async insertIfAbsent(collectionName, record) {
			const response = await requestCloudBase(
				input,
				collectionDocumentsUrl(input.envId, collectionName),
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ data: [record] }),
				},
			)
			if (response.status === 409) return false
			await assertCloudBaseOk(response, `insert ${collectionName}`)
			return true
		},

		/**
		 * @param {string} collectionName
		 * @param {string} docId
		 */
		async deleteById(collectionName, docId) {
			const response = await requestCloudBase(
				input,
				documentUrl(input.envId, collectionName, docId),
				{ method: 'DELETE' },
			)
			if (response.status === 404) return false
			await assertCloudBaseOk(response, `delete ${collectionName}`)
			return true
		},
	}
}

export class DispatchConflictError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message)
		this.name = 'DispatchConflictError'
	}
}

/** @typedef {{ runTransaction<T>(callback: (transaction: TransactionHandle) => Promise<T>, times?: number): Promise<T> }} TransactionDatabase */
/** @typedef {{ collection(name: string): { doc(id: string): { get(): Promise<{ data?: unknown }>, set(data: Record<string, unknown>): Promise<unknown> } } }} TransactionHandle */

/**
 * The CloudBase SDK retries transaction conflicts immediately. Release signals can fan out
 * thousands of events at once, so use bounded exponential backoff with jitter around a single
 * SDK attempt to avoid a hot quota shard turning transient conflicts into HTTP 500 responses.
 *
 * @template T
 * @param {TransactionDatabase} database
 * @param {(transaction: TransactionHandle) => Promise<T>} callback
 * @param {{ sleepImpl: (delayMs: number) => Promise<void>, randomImpl: () => number }} timing
 * @returns {Promise<T>}
 */
async function runTransactionWithConflictRetry(database, callback, timing) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await database.runTransaction(callback, 0)
		} catch (error) {
			if (!isTransactionConflict(error) || attempt >= TRANSACTION_CONFLICT_RETRY_ATTEMPTS) {
				throw error
			}
			const baseDelay = Math.min(
				TRANSACTION_CONFLICT_RETRY_BASE_MS * 2 ** attempt,
				TRANSACTION_CONFLICT_RETRY_MAX_MS,
			)
			const randomValue = Math.min(1, Math.max(0, timing.randomImpl()))
			await timing.sleepImpl(
				Math.min(
					TRANSACTION_CONFLICT_RETRY_MAX_MS,
					baseDelay + Math.floor(baseDelay * randomValue * 0.5),
				),
			)
		}
	}
}

/** @param {unknown} error */
function isTransactionConflict(error) {
	if (!isRecord(error)) return false
	return [error.code, error.errorCode, error.errCode].includes('DATABASE_TRANSACTION_CONFLICT')
}

/** @param {number} delayMs */
function sleep(delayMs) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs))
}

/**
 * @param {TransactionHandle} transaction
 * @param {string} collection
 * @param {string} id
 */
async function transactionGet(transaction, collection, id) {
	const result = await transaction.collection(collection).doc(id).get()
	throwTransactionOperationError(result, `read ${collection}`)
	return isRecord(result?.data) ? result.data : null
}

/**
 * @param {TransactionHandle} transaction
 * @param {string} collection
 * @param {Record<string, unknown>} record
 */
async function transactionSet(transaction, collection, record) {
	const id = readRequiredRecordId(record)
	const data = { ...record }
	delete data._id
	const result = await transaction.collection(collection).doc(id).set(data)
	throwTransactionOperationError(result, `write ${collection}`)
}

/** @param {unknown} result @param {string} operation */
function throwTransactionOperationError(result, operation) {
	if (!isRecord(result)) return
	const code = readString(result.code ?? result.errorCode ?? result.errCode)
	if (!code) return
	throw Object.assign(new Error(`CloudBase transaction ${operation} failed: ${code}`), { code })
}

/** @param {Record<string, unknown>} record */
function readRequiredRecordId(record) {
	const id = readString(record._id)
	if (!id) throw new Error('Transactional record is missing _id')
	return id
}

/** @param {Record<string, unknown> | null} signal */
function readRevision(signal) {
	return typeof signal?.revision === 'number' && Number.isSafeInteger(signal.revision)
		? signal.revision
		: 0
}

/** @param {unknown} runtime @param {unknown} channel */
function releaseSlotDocumentId(runtime, channel) {
	const normalizedRuntime = readString(runtime)
	const normalizedChannel = readString(channel)
	if (!normalizedRuntime || !normalizedChannel) throw new Error('Release slot target is invalid')
	return `release-slot:${normalizedRuntime}:${normalizedChannel}`
}

/** @param {string} uid */
function announcementAccountSignalId(uid) {
	return `user:${createHash('sha256').update(uid, 'utf8').digest('hex')}`
}

/**
 * @param {{ envId: string, apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} input
 * @param {URL} url
 * @param {RequestInit} init
 */
async function requestCloudBase(input, url, init) {
	if (!input.apiKey) {
		throw new Error('CLOUDBASE_ADMIN_API_KEY is not configured')
	}
	const headers = new Headers(init.headers)
	headers.set('authorization', `Bearer ${input.apiKey}`)
	return fetchWithTimeout(
		input.fetchImpl ?? fetch,
		url,
		{
			...init,
			headers,
		},
		input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
}

/**
 * @param {Response} response
 * @param {string} operation
 */
async function assertCloudBaseOk(response, operation) {
	if (response.ok) return
	throw new Error(`CloudBase admin database ${operation} failed with ${response.status}`)
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {URL} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal })
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error('CloudBase admin database request timed out')
		}
		throw error
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * @param {string} envId
 * @param {string} collectionName
 */
function collectionDocumentsUrl(envId, collectionName) {
	return new URL(
		`https://${envId}.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)/collections/${collectionName}/documents`,
	)
}

/**
 * @param {string} envId
 * @param {string} collectionName
 * @param {string} docId
 */
function documentUrl(envId, collectionName, docId) {
	return new URL(
		`${collectionDocumentsUrl(envId, collectionName).toString()}/${encodeURIComponent(docId)}`,
	)
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>[]}
 */
function documents(payload) {
	if (!isRecord(payload)) return []
	if (Array.isArray(payload.list)) {
		return payload.list.filter(isRecord)
	}
	if (Array.isArray(payload.data)) {
		return payload.data.filter(isRecord)
	}
	return []
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizeEjson(value) {
	if (Array.isArray(value)) {
		return value.map(normalizeEjson)
	}
	if (!isRecord(value)) {
		return value
	}
	const objectId = readString(value.$oid)
	if (objectId && Object.keys(value).length === 1) {
		return objectId
	}
	const number = readEjsonNumber(value)
	if (number !== null && Object.keys(value).length === 1) {
		return number
	}
	const date = readEjsonDate(value)
	if (date && Object.keys(value).length === 1) {
		return date
	}
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeEjson(item)]))
}

/**
 * @param {unknown} value
 */
function readEjsonNumber(value) {
	if (!isRecord(value)) return null
	const encoded =
		readString(value.$numberInt) ??
		readString(value.$numberLong) ??
		readString(value.$numberDouble) ??
		readString(value.$numberDecimal)
	if (!encoded) return null
	const parsed = Number(encoded)
	return Number.isFinite(parsed) ? parsed : null
}

/**
 * @param {unknown} value
 */
function readEjsonDate(value) {
	if (!isRecord(value) || !isRecord(value.$date)) return null
	const timestamp = readEjsonNumber(value.$date)
	return timestamp === null ? null : new Date(timestamp).toISOString()
}

/**
 * @param {Record<string, unknown>} record
 * @param {{ from?: number, to?: number, userId?: string, model?: string }} filter
 */
function matchesUsageFilter(record, filter) {
	const ts = typeof record.ts === 'number' ? record.ts : null
	const uid = typeof record.uid === 'string' ? record.uid : null
	const model = typeof record.model === 'string' ? record.model : null
	if (filter.from !== undefined && (ts === null || ts < filter.from)) return false
	if (filter.to !== undefined && (ts === null || ts > filter.to)) return false
	if (filter.userId && uid !== filter.userId) return false
	if (filter.model && model !== filter.model) return false
	return true
}

/** @param {Array<string | null | undefined>} values */
function highestSemver(values) {
	/** @type {string | undefined} */
	let highest
	for (const value of values) {
		if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) continue
		if (!highest || compareSemverValues(value, highest) > 0) highest = value
	}
	return highest
}

/** @param {string} left @param {string} right */
function compareSemverValues(left, right) {
	const leftMatch = SEMVER_PATTERN.exec(left)
	const rightMatch = SEMVER_PATTERN.exec(right)
	if (!leftMatch || !rightMatch) throw new DispatchConflictError('Invalid release version guard')
	const leftCore = [Number(leftMatch[1]), Number(leftMatch[2]), Number(leftMatch[3])]
	const rightCore = [Number(rightMatch[1]), Number(rightMatch[2]), Number(rightMatch[3])]
	for (let index = 0; index < 3; index += 1) {
		if (leftCore[index] !== rightCore[index]) return leftCore[index] < rightCore[index] ? -1 : 1
	}
	const leftPrerelease = leftMatch[4]?.split('.') ?? []
	const rightPrerelease = rightMatch[4]?.split('.') ?? []
	if (leftPrerelease.length === 0 && rightPrerelease.length === 0) return 0
	if (leftPrerelease.length === 0) return 1
	if (rightPrerelease.length === 0) return -1
	for (let index = 0; index < Math.max(leftPrerelease.length, rightPrerelease.length); index += 1) {
		const leftPart = leftPrerelease[index]
		const rightPart = rightPrerelease[index]
		if (leftPart === undefined) return -1
		if (rightPart === undefined) return 1
		if (leftPart === rightPart) continue
		const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
		const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
		if (leftNumber !== null && rightNumber !== null) return leftNumber < rightNumber ? -1 : 1
		if (leftNumber !== null) return -1
		if (rightNumber !== null) return 1
		return leftPart < rightPart ? -1 : 1
	}
	return 0
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 */
function readString(value) {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * CloudBase's REST database API accepts Strict EJSON for BSON dates. TTL expiry fields
 * must be stored as real BSON Dates so server-side indexes and cleanup queries can use them.
 * @param {unknown} value
 * @param {string} name
 */
function strictEjsonDate(value, name) {
	return { $date: { $numberLong: String(cloudBaseDate(value, name).getTime()) } }
}

/**
 * The Node SDK serializes Date values to BSON dates for transactional writes.
 * @param {unknown} value
 * @param {string} name
 */
function cloudBaseDate(value, name) {
	const timestamp = value instanceof Date ? value.getTime() : Date.parse(readString(value) ?? '')
	if (!Number.isFinite(timestamp)) throw new Error(`${name} is invalid`)
	return new Date(timestamp)
}
