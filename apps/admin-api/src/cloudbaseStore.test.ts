import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { createCloudBaseAdminStore } from './cloudbaseStore.mjs'

const ENV_ID = 'wenxue-d8gz76tacc3659f05'
const API_KEY = 'admin-api-key'
const USER_ID = 'user_123'

interface RequestCall {
	url: string
	init?: RequestInit
}

function createFetch(responses: Response[]) {
	const calls: RequestCall[] = []
	const fetchImpl: typeof fetch = async (input, init) => {
		calls.push({
			url: input instanceof Request ? input.url : String(input),
			init,
		})
		const response = responses.shift()
		if (!response) {
			throw new Error('Unexpected fetch call')
		}
		return response
	}
	return { calls, fetchImpl }
}

function readHeader(headers: HeadersInit | undefined, name: string) {
	return new Headers(headers).get(name)
}

function readJsonBody(init: RequestInit | undefined) {
	if (typeof init?.body !== 'string') {
		throw new Error('Expected JSON request body')
	}
	return JSON.parse(init.body) as Record<string, unknown>
}

interface TransactionSeed {
	collection: string
	record: Record<string, unknown>
}

interface TransactionWrite {
	collection: string
	id: string
	data: Record<string, unknown>
}

interface TestTransaction {
	collection(name: string): {
		doc(id: string): {
			get(): Promise<{ data?: unknown }>
			set(data: Record<string, unknown>): Promise<Record<string, unknown>>
		}
	}
}

function createTransactionDatabase(seed: TransactionSeed[] = []) {
	const documents = new Map(
		seed.map(({ collection, record }) => [`${collection}/${String(record._id)}`, { ...record }]),
	)
	const writes: TransactionWrite[] = []
	const transaction: TestTransaction = {
		collection(collection) {
			return {
				doc(id) {
					return {
						async get() {
							return { data: documents.get(`${collection}/${id}`) ?? null }
						},
						async set(data) {
							writes.push({ collection, id, data })
							documents.set(`${collection}/${id}`, { _id: id, ...data })
							return { updated: 1 }
						},
					}
				},
			}
		},
	}
	return {
		documents,
		writes,
		transactionDatabase: {
			async runTransaction<T>(callback: (transaction: TestTransaction) => Promise<T>) {
				return callback(transaction)
			},
		},
	}
}

describe('createCloudBaseAdminStore', () => {
	it('reads admin users through the NoSQL REST document endpoint', async () => {
		const { calls, fetchImpl } = createFetch([
			Response.json({
				_id: 'admin-uid',
				role: 'admin',
				status: 'active',
			}),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(store.getAdminUser('admin-uid')).resolves.toMatchObject({
			_id: 'admin-uid',
			role: 'admin',
		})

		expect(calls).toHaveLength(1)
		expect(calls[0].url).toContain('/collections/admin_users/documents/admin-uid')
		expect(calls[0].init?.method).toBe('GET')
		expect(readHeader(calls[0].init?.headers, 'authorization')).toBe(`Bearer ${API_KEY}`)
	})

	it('rejects a successful NoSQL response that is not valid JSON', async () => {
		const { fetchImpl } = createFetch([new Response('<html>temporary proxy error</html>')])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(store.getAdminUser('admin-uid')).rejects.toThrow(
			'CloudBase admin database returned invalid JSON',
		)
	})

	it('queries usage records with REST filters and normalizes strict EJSON numbers', async () => {
		const { calls, fetchImpl } = createFetch([
			Response.json({
				list: [
					{
						_id: 'usage-1',
						uid: USER_ID,
						model: 'qwen-plus',
						inputTokens: { $numberInt: '7' },
						outputTokens: { $numberInt: '5' },
						totalTokens: { $numberInt: '12' },
						ts: { $numberLong: '1782896640000' },
					},
				],
			}),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		const records = await store.listUsageRecords({
			limit: 25,
			userId: USER_ID,
			model: 'qwen-plus',
			from: 1782890000000,
			to: 1782900000000,
		})

		expect(records).toEqual([
			expect.objectContaining({
				uid: USER_ID,
				inputTokens: 7,
				outputTokens: 5,
				totalTokens: 12,
				ts: 1782896640000,
			}),
		])
		const url = new URL(calls[0].url)
		expect(JSON.parse(url.searchParams.get('query') ?? '')).toEqual({
			ts: { $gte: 1782890000000, $lte: 1782900000000 },
			uid: USER_ID,
			model: 'qwen-plus',
		})
		expect(url.searchParams.get('order')).toBe(
			'[{"field":"ts","direction":"desc"},{"field":"_id","direction":"desc"}]',
		)
		expect(url.searchParams.get('limit')).toBe('25')
	})

	it('paginates usage records instead of truncating lifetime totals at one page', async () => {
		const firstPage = Array.from({ length: 500 }, (_, index) => ({
			_id: `usage-${500 - index}`,
			uid: USER_ID,
			model: 'qwen3.7-plus',
			ts: 500 - index,
		}))
		const { calls, fetchImpl } = createFetch([
			Response.json({ list: firstPage }),
			Response.json({ list: [{ _id: 'usage-0', uid: USER_ID, model: 'qwen3.7-plus', ts: 0 }] }),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(store.listUsageRecords({})).resolves.toHaveLength(501)
		expect(calls).toHaveLength(2)
		expect(new URL(calls[0].url).searchParams.get('limit')).toBe('500')
		const secondUrl = new URL(calls[1].url)
		expect(secondUrl.searchParams.has('skip')).toBe(false)
		expect(JSON.parse(secondUrl.searchParams.get('query') ?? '{}')).toEqual({
			$and: [
				{},
				{
					$or: [{ ts: { $lt: 1 } }, { ts: 1, _id: { $lt: 'usage-1' } }],
				},
			],
		})
	})

	it('times out when a NoSQL response body stalls after headers', async () => {
		const stalledBody = new ReadableStream<Uint8Array>({ start() {} })
		const fetchImpl: typeof fetch = async () =>
			new Response(stalledBody, {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			fetchImpl,
			timeoutMs: 5,
		})

		await expect(store.getAdminUser('admin-uid')).rejects.toThrow(/timed out/i)
	})

	it('upserts business notes without creating an authorization status for new Auth users', async () => {
		const transaction = createTransactionDatabase()
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			transactionDatabase: transaction.transactionDatabase,
		})
		await expect(
			store.updateUserAccount(USER_ID, {
				note: 'manual review',
				updatedAt: '2026-07-01T00:00:00.000Z',
			}),
		).resolves.toMatchObject({ uid: USER_ID, note: 'manual review' })
		expect(transaction.writes).toHaveLength(1)
		expect(transaction.writes[0]).toMatchObject({
			collection: 'user_accounts',
			id: USER_ID,
			data: { uid: USER_ID, note: 'manual review' },
		})
		expect(transaction.writes[0].data).not.toHaveProperty('active')
		expect(transaction.writes[0].data).not.toHaveProperty('status')
	})

	it('inserts user permission audit records through the REST collection endpoint', async () => {
		const { calls, fetchImpl } = createFetch([
			Response.json({ insertedIds: ['audit-1'] }, { status: 201 }),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await store.createUserPermissionAudit({
			_id: 'audit-1',
			userId: USER_ID,
		})

		expect(calls).toHaveLength(1)
		expect(calls[0].url).toContain('/collections/user_permission_audit/documents')
		expect(calls[0].init?.method).toBe('POST')
		expect(readJsonBody(calls[0].init)).toEqual({
			data: [
				{
					_id: 'audit-1',
					userId: USER_ID,
				},
			],
		})
	})

	it('fails before making CloudBase requests when the API key is missing', async () => {
		const { calls, fetchImpl } = createFetch([])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, fetchImpl })

		await expect(store.getAdminUser('admin-uid')).rejects.toThrow(
			'CLOUDBASE_ADMIN_API_KEY is not configured',
		)
		expect(calls).toHaveLength(0)
	})

	it('queries announcements and receipt batches without exposing collections to callers', async () => {
		const announcementIds = Array.from({ length: 51 }, (_, index) => `announcement-${index + 1}`)
		const { calls, fetchImpl } = createFetch([
			Response.json({ list: [{ _id: 'announcement-1', status: 'published' }] }),
			Response.json({ list: [{ _id: 'announcement-1:user-1', uid: 'user-1' }] }),
			Response.json({ list: [{ _id: 'announcement-51:user-1', uid: 'user-1' }] }),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await store.listAnnouncements({ status: 'published', limit: 10 })
		await expect(store.listAnnouncementReceipts('user-1', announcementIds)).resolves.toHaveLength(2)

		const announcementUrl = new URL(calls[0].url)
		expect(announcementUrl.pathname).toContain('/collections/client_announcements/documents')
		expect(JSON.parse(announcementUrl.searchParams.get('query') ?? '')).toEqual({
			status: 'published',
		})
		expect(announcementUrl.searchParams.get('order')).toBe(
			'[{"field":"publishedAt","direction":"desc"}]',
		)
		const firstReceiptUrl = new URL(calls[1].url)
		expect(firstReceiptUrl.pathname).toContain(
			'/collections/client_announcement_receipts/documents',
		)
		expect(JSON.parse(firstReceiptUrl.searchParams.get('query') ?? '')).toEqual({
			_id: {
				$in: announcementIds.slice(0, 50).map((id) => `${id}:user-1`),
			},
		})
		expect(firstReceiptUrl.searchParams.get('limit')).toBe('50')
		const secondReceiptUrl = new URL(calls[2].url)
		expect(JSON.parse(secondReceiptUrl.searchParams.get('query') ?? '')).toEqual({
			_id: { $in: ['announcement-51:user-1'] },
		})
		expect(secondReceiptUrl.searchParams.get('limit')).toBe('1')
	})

	it('commits a TTL receipt and its account signal revision atomically exactly once', async () => {
		const transaction = createTransactionDatabase([
			{
				collection: 'desktop_announcement_signal',
				record: { _id: 'global', revision: 4, updatedAt: '2026-07-01T00:00:00.000Z' },
			},
		])
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			fetchImpl: createFetch([]).fetchImpl,
			transactionDatabase: transaction.transactionDatabase,
		})
		const receipt = {
			_id: 'announcement-1:user-1',
			announcementId: 'announcement-1',
			uid: 'user-1',
			acknowledgedAt: '2026-07-01T01:00:00.000Z',
			expiresAt: '2026-07-09T00:00:00.000Z',
		}

		await expect(store.commitAnnouncementAcknowledgement(receipt)).resolves.toMatchObject({
			created: true,
		})
		await expect(store.commitAnnouncementAcknowledgement(receipt)).resolves.toMatchObject({
			created: false,
		})

		expect(transaction.documents.get('client_announcement_receipts/announcement-1:user-1')).toEqual(
			{
				...receipt,
				expiresAt: new Date(receipt.expiresAt),
			},
		)
		expect(transaction.documents.get('desktop_announcement_signal/global')).toMatchObject({
			revision: 4,
			updatedAt: '2026-07-01T00:00:00.000Z',
		})
		const accountSignalId = `user:${createHash('sha256').update('user-1').digest('hex')}`
		expect(
			transaction.documents.get(`desktop_announcement_signal/${accountSignalId}`),
		).toMatchObject({
			uid: 'user-1',
			revision: 1,
			updatedAt: receipt.acknowledgedAt,
		})
		expect(
			transaction.writes.filter(
				(write) =>
					write.collection === 'desktop_announcement_signal' && write.id === accountSignalId,
			),
		).toHaveLength(1)
	})

	it('opportunistically deletes at most 20 expired announcement receipts', async () => {
		const expired = Array.from({ length: 21 }, (_, index) => ({
			_id: `announcement-${index + 1}:user-1`,
			expiresAt: '2026-07-01T00:00:00.000Z',
		}))
		const { calls, fetchImpl } = createFetch([
			Response.json({ list: expired }),
			...Array.from({ length: 20 }, () => new Response(null, { status: 204 })),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(
			store.cleanupExpiredAnnouncementReceipts('2026-07-17T00:00:00.000Z'),
		).resolves.toBe(20)

		const queryUrl = new URL(calls[0].url)
		expect(queryUrl.pathname).toContain('/collections/client_announcement_receipts/documents')
		expect(JSON.parse(queryUrl.searchParams.get('query') ?? '')).toEqual({
			expiresAt: { $lte: { $date: { $numberLong: '1784246400000' } } },
		})
		expect(queryUrl.searchParams.get('order')).toBe('[{"field":"expiresAt","direction":"asc"}]')
		expect(queryUrl.searchParams.get('limit')).toBe('20')
		expect(calls.slice(1)).toHaveLength(20)
		expect(calls.slice(1).every((call) => call.init?.method === 'DELETE')).toBe(true)
	})

	it('initializes a missing release signal with a public-safe revision document', async () => {
		const updatedAt = '2026-07-01T00:00:00.000Z'
		const { calls, fetchImpl } = createFetch([
			Response.json({ code: 'DOCUMENT_NOT_FOUND' }, { status: 404 }),
			Response.json({ insertedIds: ['electron:stable'] }, { status: 201 }),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(store.incrementReleaseSignal('electron', 'stable', updatedAt)).resolves.toEqual({
			_id: 'electron:stable',
			revision: 1,
			updatedAt,
		})
		expect(calls[0].url).toContain(
			'/collections/desktop_release_signal/documents/electron%3Astable',
		)
		expect(readJsonBody(calls[1].init)).toEqual({
			data: [{ _id: 'electron:stable', revision: 1, updatedAt }],
		})
	})

	it('keeps channel slot documents out of rollout listings', async () => {
		const { calls, fetchImpl } = createFetch([
			Response.json({
				list: [
					{ _id: 'rollout-1', runtime: 'electron', channel: 'stable' },
					{
						_id: 'release-slot:electron:stable',
						recordType: 'release-slot',
						runtime: 'electron',
						channel: 'stable',
					},
				],
			}),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(
			store.listReleaseRollouts({ runtime: 'electron', channel: 'stable', limit: 20 }),
		).resolves.toEqual([{ _id: 'rollout-1', runtime: 'electron', channel: 'stable' }])
		expect(new URL(calls[0].url).searchParams.get('limit')).toBe('26')
	})

	it('reads the active channel slot from the rollout collection', async () => {
		const { calls, fetchImpl } = createFetch([
			Response.json({
				_id: 'release-slot:electron:stable',
				recordType: 'release-slot',
				activeRolloutId: 'rollout-1',
			}),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(store.getReleaseActiveSlot('electron', 'stable')).resolves.toMatchObject({
			activeRolloutId: 'rollout-1',
		})
		expect(calls[0].url).toContain(
			'/collections/desktop_release_rollouts/documents/release-slot%3Aelectron%3Astable',
		)
	})

	it('preserves the highest channel version when a rollout changes state', async () => {
		const transaction = createTransactionDatabase([
			{
				collection: 'desktop_release_rollouts',
				record: {
					_id: 'rollout-1',
					runtime: 'electron',
					channel: 'stable',
					status: 'active',
				},
			},
			{
				collection: 'desktop_release_rollouts',
				record: {
					_id: 'release-slot:electron:stable',
					currentRolloutId: 'rollout-1',
					activeRolloutId: 'rollout-1',
					highestVersion: '0.1.2',
				},
			},
			{
				collection: 'desktop_release_signal',
				record: { _id: 'electron:stable', revision: 7 },
			},
		])
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			fetchImpl: createFetch([]).fetchImpl,
			transactionDatabase: transaction.transactionDatabase,
		})

		await store.commitReleaseState(
			{
				_id: 'rollout-1',
				runtime: 'electron',
				channel: 'stable',
				status: 'paused',
				updatedAt: '2026-07-01T02:00:00.000Z',
				updatedBy: 'admin-1',
			},
			{ _id: 'audit-pause', action: 'release.pause' },
			'active',
		)

		expect(
			transaction.documents.get('desktop_release_rollouts/release-slot:electron:stable'),
		).toMatchObject({
			currentRolloutId: 'rollout-1',
			activeRolloutId: null,
			highestVersion: '0.1.2',
		})
	})

	it('rejects a transactional release downgrade from the channel slot', async () => {
		const transaction = createTransactionDatabase([
			{
				collection: 'desktop_release_rollouts',
				record: {
					_id: 'release-slot:electron:stable',
					highestVersion: '0.1.2',
				},
			},
		])
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			fetchImpl: createFetch([]).fetchImpl,
			transactionDatabase: transaction.transactionDatabase,
		})

		await expect(
			store.commitReleasePublication(
				{
					_id: 'rollout-older',
					runtime: 'electron',
					channel: 'stable',
					publishedAt: '2026-07-01T03:00:00.000Z',
					publishedBy: 'admin-1',
				},
				{ _id: 'audit-publish', action: 'release.publish' },
				[],
				{ candidateVersion: '0.1.1' },
			),
		).rejects.toThrow('Release version must move forward')
		expect(transaction.writes).toEqual([])
	})

	it('uses dedicated collections for candidates, rollout audits, and anonymous events', async () => {
		const { calls, fetchImpl } = createFetch([
			Response.json({ list: [] }),
			Response.json({ insertedIds: ['audit-1'] }, { status: 201 }),
		])
		const transaction = createTransactionDatabase()
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			fetchImpl,
			transactionDatabase: transaction.transactionDatabase,
		})

		await store.listReleaseCandidates({ runtime: 'electron', channel: 'stable', limit: 20 })
		await store.createReleaseEventWithinQuota(
			{
				_id: 'event-1',
				releaseId: 'release-1',
				result: 'success',
				createdAt: '2026-07-01T00:00:00.000Z',
				expiresAt: '2026-07-31T00:00:00.000Z',
			},
			{
				id: 'release-event-quota:2026-07-01:0',
				limit: 100,
				expiresAt: '2026-08-01T00:00:00.000Z',
			},
		)
		await store.createDispatchAudit({ _id: 'audit-1', action: 'release.publish' })

		const candidateUrl = new URL(calls[0].url)
		expect(candidateUrl.pathname).toContain('/collections/desktop_release_candidates/documents')
		expect(JSON.parse(candidateUrl.searchParams.get('query') ?? '')).toEqual({
			status: 'verified',
			runtime: 'electron',
			channel: 'stable',
		})
		expect(transaction.documents.get('desktop_release_events/event-1')).toMatchObject({
			_id: 'event-1',
			releaseId: 'release-1',
		})
		expect(
			transaction.documents.get('desktop_release_events/release-event-quota:2026-07-01:0'),
		).toMatchObject({
			recordType: 'release-event-quota',
			count: 1,
			limit: 100,
		})
		expect(transaction.documents.get('desktop_release_events/event-1')?.expiresAt).toBeInstanceOf(
			Date,
		)
		expect(
			transaction.documents.get('desktop_release_events/release-event-quota:2026-07-01:0')
				?.expiresAt,
		).toBeInstanceOf(Date)
		expect(calls[1].url).toContain('/collections/admin_dispatch_audit/documents')
	})

	it('uses a BSON Date in successful event transactions and preserves first final timing', async () => {
		const firstExpiry = new Date('2026-07-31T00:00:00.000Z')
		const transaction = createTransactionDatabase([
			{
				collection: 'desktop_release_events',
				record: {
					_id: 'event-final',
					releaseId: 'release-1',
					result: 'failure',
					createdAt: '2026-07-01T00:00:00.000Z',
					expiresAt: firstExpiry,
				},
			},
		])
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			fetchImpl: createFetch([]).fetchImpl,
			transactionDatabase: transaction.transactionDatabase,
		})

		await expect(
			store.createReleaseEventWithinQuota(
				{
					_id: 'event-final',
					releaseId: 'release-1',
					result: 'success',
					createdAt: '2026-07-02T00:00:00.000Z',
					expiresAt: '2026-08-01T00:00:00.000Z',
				},
				{
					id: 'release-event-quota:2026-07-02:0',
					limit: 100,
					expiresAt: '2026-09-01T00:00:00.000Z',
				},
			),
		).resolves.toEqual({ outcome: 'updated' })

		const stored = transaction.documents.get('desktop_release_events/event-final')
		expect(stored).toMatchObject({
			result: 'success',
			createdAt: '2026-07-01T00:00:00.000Z',
		})
		expect(stored?.expiresAt).toBeInstanceOf(Date)
		expect((stored?.expiresAt as Date).toISOString()).toBe(firstExpiry.toISOString())
	})

	it('enforces a transactional daily event quota without charging duplicates', async () => {
		const transaction = createTransactionDatabase()
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			fetchImpl: createFetch([]).fetchImpl,
			transactionDatabase: transaction.transactionDatabase,
		})
		const quota = {
			id: 'release-event-quota:2026-07-01:0',
			limit: 1,
			expiresAt: '2026-08-01T00:00:00.000Z',
		}
		const first = {
			_id: 'event-1',
			releaseId: 'release-1',
			result: 'success',
			createdAt: '2026-07-01T00:00:00.000Z',
			expiresAt: '2026-07-31T00:00:00.000Z',
		}

		await expect(store.createReleaseEventWithinQuota(first, quota)).resolves.toEqual({
			outcome: 'created',
		})
		await expect(store.createReleaseEventWithinQuota(first, quota)).resolves.toEqual({
			outcome: 'duplicate',
		})
		await expect(
			store.createReleaseEventWithinQuota({ ...first, _id: 'event-2' }, quota),
		).resolves.toEqual({ outcome: 'quota-exceeded' })

		expect(
			transaction.documents.get('desktop_release_events/release-event-quota:2026-07-01:0'),
		).toMatchObject({ count: 1 })
		expect(transaction.documents.has('desktop_release_events/event-2')).toBe(false)
	})

	it('replays conflicted event transactions with exponential backoff', async () => {
		const committed = new Map<string, Record<string, unknown>>()
		const delays: number[] = []
		const sdkRetryCounts: Array<number | undefined> = []
		let attempts = 0
		const transactionDatabase = {
			async runTransaction<T>(
				callback: (transaction: TestTransaction) => Promise<T>,
				times?: number,
			) {
				attempts += 1
				sdkRetryCounts.push(times)
				const local = new Map([...committed].map(([key, value]) => [key, { ...value }] as const))
				const transaction: TestTransaction = {
					collection(collection) {
						return {
							doc(id) {
								return {
									async get() {
										return { data: local.get(`${collection}/${id}`) ?? null }
									},
									async set(data) {
										local.set(`${collection}/${id}`, { _id: id, ...data })
										return { updated: 1 }
									},
								}
							},
						}
					},
				}
				const result = await callback(transaction)
				if (attempts < 3) {
					throw Object.assign(new Error('transaction conflict'), {
						code: 'DATABASE_TRANSACTION_CONFLICT',
					})
				}
				committed.clear()
				for (const [key, value] of local) committed.set(key, value)
				return result
			},
		}
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: API_KEY,
			fetchImpl: createFetch([]).fetchImpl,
			transactionDatabase,
			sleepImpl: async (delayMs: number) => {
				delays.push(delayMs)
			},
			randomImpl: () => 0,
		})

		await expect(
			store.createReleaseEventWithinQuota(
				{
					_id: 'event-retried',
					releaseId: 'release-1',
					result: 'success',
					createdAt: '2026-07-01T00:00:00.000Z',
					expiresAt: '2026-07-31T00:00:00.000Z',
				},
				{
					id: 'release-event-quota:2026-07-01:0',
					limit: 100,
					expiresAt: '2026-08-01T00:00:00.000Z',
				},
			),
		).resolves.toEqual({ outcome: 'created' })

		expect(attempts).toBe(3)
		expect(sdkRetryCounts).toEqual([0, 0, 0])
		expect(delays).toEqual([25, 50])
		expect(committed.get('desktop_release_events/event-retried')).toMatchObject({
			releaseId: 'release-1',
		})
		expect(committed.get('desktop_release_events/release-event-quota:2026-07-01:0')).toMatchObject({
			count: 1,
		})
	})

	it('preserves read and write operation conflict codes for outer retries', async () => {
		for (const conflictingOperation of ['read', 'write'] as const) {
			const committed = createTransactionDatabase()
			const delays: number[] = []
			const sdkRetryCounts: Array<number | undefined> = []
			let attempts = 0
			const transactionDatabase = {
				async runTransaction<T>(
					callback: (transaction: TestTransaction) => Promise<T>,
					times?: number,
				) {
					attempts += 1
					sdkRetryCounts.push(times)
					if (attempts > 1) {
						return committed.transactionDatabase.runTransaction(callback)
					}
					const conflictResult = {
						code: 'DATABASE_TRANSACTION_CONFLICT',
					} as unknown as { data?: unknown }
					const transaction: TestTransaction = {
						collection() {
							return {
								doc() {
									return {
										async get() {
											return conflictingOperation === 'read' ? conflictResult : { data: null }
										},
										async set() {
											return conflictingOperation === 'write'
												? (conflictResult as unknown as Record<string, unknown>)
												: { updated: 1 }
										},
									}
								},
							}
						},
					}
					return callback(transaction)
				},
			}
			const store = createCloudBaseAdminStore({
				envId: ENV_ID,
				apiKey: API_KEY,
				fetchImpl: createFetch([]).fetchImpl,
				transactionDatabase,
				sleepImpl: async (delayMs: number) => {
					delays.push(delayMs)
				},
				randomImpl: () => 0,
			})

			await expect(
				store.createReleaseEventWithinQuota(
					{
						_id: `event-${conflictingOperation}`,
						releaseId: 'release-1',
						result: 'success',
						createdAt: '2026-07-01T00:00:00.000Z',
						expiresAt: '2026-07-31T00:00:00.000Z',
					},
					{
						id: 'release-event-quota:2026-07-01:0',
						limit: 100,
						expiresAt: '2026-08-01T00:00:00.000Z',
					},
				),
			).resolves.toEqual({ outcome: 'created' })

			expect(attempts).toBe(2)
			expect(sdkRetryCounts).toEqual([0, 0])
			expect(delays).toEqual([25])
		}
	})

	it('opportunistically deletes at most 20 expired release events', async () => {
		const expired = Array.from({ length: 21 }, (_, index) => ({
			_id: `event-${index + 1}`,
			expiresAt: '2026-07-01T00:00:00.000Z',
		}))
		const { calls, fetchImpl } = createFetch([
			Response.json({ list: expired }),
			...Array.from({ length: 20 }, () => new Response(null, { status: 204 })),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(store.cleanupExpiredReleaseEvents('2026-07-17T00:00:00.000Z')).resolves.toBe(20)

		const queryUrl = new URL(calls[0].url)
		expect(queryUrl.pathname).toContain('/collections/desktop_release_events/documents')
		expect(JSON.parse(queryUrl.searchParams.get('query') ?? '')).toEqual({
			expiresAt: { $lte: { $date: { $numberLong: '1784246400000' } } },
		})
		expect(queryUrl.searchParams.get('limit')).toBe('20')
		expect(calls.slice(1)).toHaveLength(20)
		expect(calls.slice(1).every((call) => call.init?.method === 'DELETE')).toBe(true)
		expect(calls.at(-1)?.url).toContain('/documents/event-20')
	})

	it('queries the bounded 30-day event window used for release health', async () => {
		const { calls, fetchImpl } = createFetch([Response.json({ list: [] })])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await store.listReleaseEvents({
			createdAfter: '2026-06-17T00:00:00.000Z',
			createdBefore: '2026-07-17T00:00:00.000Z',
			limit: 5_000,
		})

		const url = new URL(calls[0].url)
		expect(url.pathname).toContain('/collections/desktop_release_events/documents')
		expect(JSON.parse(url.searchParams.get('query') ?? '')).toEqual({
			createdAt: {
				$gte: '2026-06-17T00:00:00.000Z',
				$lt: '2026-07-17T00:00:00.000Z',
			},
		})
		expect(url.searchParams.get('order')).toBe(
			'[{"field":"createdAt","direction":"desc"},{"field":"_id","direction":"desc"}]',
		)
		expect(url.searchParams.get('limit')).toBe('5000')
	})

	it('queries the next health page with a stable tuple cursor instead of skip', async () => {
		const { calls, fetchImpl } = createFetch([Response.json({ list: [] })])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await store.listReleaseEvents({
			releaseId: 'release-1',
			createdAfter: '2026-06-17T00:00:00.000Z',
			createdBefore: '2026-07-17T00:00:00.000Z',
			before: { createdAt: '2026-07-01T00:00:00.000Z', id: 'event-0500' },
			limit: 1_000,
		})

		const url = new URL(calls[0].url)
		expect(JSON.parse(url.searchParams.get('query') ?? '')).toEqual({
			$and: [
				{
					createdAt: {
						$gte: '2026-06-17T00:00:00.000Z',
						$lt: '2026-07-17T00:00:00.000Z',
					},
					releaseId: 'release-1',
				},
				{
					$or: [
						{ createdAt: { $lt: '2026-07-01T00:00:00.000Z' } },
						{
							createdAt: '2026-07-01T00:00:00.000Z',
							_id: { $lt: 'event-0500' },
						},
					],
				},
			],
		})
		expect(url.searchParams.has('skip')).toBe(false)
	})
})
