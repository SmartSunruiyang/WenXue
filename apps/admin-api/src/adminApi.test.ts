import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	canonicalJson as sharedCanonicalJson,
	compareSemver as sharedCompareSemver,
	matchesAudience as sharedMatchesAudience,
	validateAnnouncementInput as sharedValidateAnnouncementInput,
	validateReleasePublishInput as sharedValidateReleasePublishInput,
} from '@wenxue/client-operations'

import {
	buildAdminUsageSummary,
	compareSemver,
	handleAdminRequest,
	matchesAnnouncementAudience,
	resetDispatchRateLimits,
} from './adminApi.mjs'

const ADMIN_TOKEN = 'admin-access-token'
const USER_ID = 'user_123'
const TEST_NOW = 1782896640000
const EVENT_TOKEN_SECRET = 'test-release-event-token-secret-32-bytes-minimum'

afterEach(() => {
	resetDispatchRateLimits()
})

interface StoreState {
	authUsers?: import('./adminApi.mjs').UserAccount[]
	authStatus?: 'active' | 'disabled'
	authError?: Error
	authUpdates?: Array<{ userId: string; active: boolean }>
	adminRole?: 'admin' | 'viewer'
	adminStatus?: 'active' | 'disabled'
	audits: Record<string, unknown>[]
	announcements: Record<string, unknown>[]
	receipts: Record<string, unknown>[]
	candidates: Record<string, unknown>[]
	releases: Record<string, unknown>[]
	releaseEvents: Record<string, unknown>[]
	releaseEventQuotaCounts: Record<string, number>
	releaseCleanupCalls: number
	releaseCleanupError?: Error
	dispatchAudits: Record<string, unknown>[]
	announcementRevision: number
	announcementAccountRevisions: Record<string, number>
	announcementReceiptBatchCalls: number
	announcementReceiptBatchSizes: number[]
	announcementReceiptCleanupCalls: number
	announcementReceiptCleanupError?: Error
	releaseRevisions: Record<string, number>
	releaseSignals: Record<string, Record<string, unknown>>
	user: {
		_id: string
		uid: string
		active: boolean
		firstSeenAt: string
		lastSeenAt: string
		createdAt: string
		updatedAt: string
		note?: string
	}
}

function createStore(state: StoreState) {
	const usage = [
		{
			_id: `${USER_ID}:1`,
			uid: USER_ID,
			model: 'qwen-plus',
			inputTokens: 10,
			outputTokens: 5,
			totalTokens: 15,
			latencyMs: 100,
			ts: 1782633600000,
			content: 'must not leak',
		},
		{
			_id: `${USER_ID}:2`,
			uid: USER_ID,
			model: 'qwen3.7-plus',
			inputTokens: 2,
			outputTokens: 3,
			totalTokens: 5,
			latencyMs: 80,
			ts: 1782720000000,
		},
	]
	return {
		async listAuthUsers() {
			if (state.authError) throw state.authError
			return (
				state.authUsers ?? [
					{
						_id: USER_ID,
						uid: USER_ID,
						email: 'user@example.com',
						nickname: '小问',
						active: state.authStatus !== 'disabled',
						status: state.authStatus ?? ('active' as const),
					},
				]
			)
		},
		async getAuthUser(userId: string) {
			return (await this.listAuthUsers()).find((user) => user.uid === userId) ?? null
		},
		async updateAuthUserStatus(userId: string, active: boolean) {
			if (state.authError) throw state.authError
			state.authStatus = active ? 'active' : 'disabled'
			state.authUpdates = [...(state.authUpdates ?? []), { userId, active }]
		},
		async getAdminUser(uid: string) {
			if (uid !== 'admin-uid' || !state.adminRole || !state.adminStatus) return null
			return {
				_id: uid,
				role: state.adminRole,
				status: state.adminStatus,
				displayName: 'Ops',
			}
		},
		async listUsageRecords() {
			return usage
		},
		async listUserAccounts() {
			return [state.user]
		},
		async getUserAccount(userId: string) {
			return userId === state.user.uid ? state.user : null
		},
		async updateUserAccount(
			_userId: string,
			patch: Partial<Pick<StoreState['user'], 'active' | 'updatedAt' | 'note'>>,
		) {
			state.user = { ...state.user, ...patch }
			return state.user
		},
		async createUserPermissionAudit(record: Record<string, unknown>) {
			state.audits.push(record)
		},
		async listAnnouncements(filter: {
			status?: string
			expiresAfter?: string
			direction?: 'asc' | 'desc'
			limit?: number
			skip?: number
		}) {
			const records = state.announcements
				.filter(
					(record) =>
						(!filter.status || record.status === filter.status) &&
						(!filter.expiresAfter ||
							(typeof record.expiresAt === 'string' && record.expiresAt > filter.expiresAfter)),
				)
				.sort(
					(left, right) =>
						String(left.publishedAt).localeCompare(String(right.publishedAt)) *
						(filter.direction === 'asc' ? 1 : -1),
				)
			return records.slice(filter.skip ?? 0, (filter.skip ?? 0) + (filter.limit ?? 200))
		},
		async getAnnouncement(id: string) {
			return state.announcements.find((record) => record._id === id) ?? null
		},
		async createAnnouncement(record: Record<string, unknown>) {
			state.announcements.push(record)
		},
		async updateAnnouncement(id: string, patch: Record<string, unknown>) {
			const index = state.announcements.findIndex((record) => record._id === id)
			if (index < 0) return null
			state.announcements[index] = { ...state.announcements[index], ...patch }
			return state.announcements[index]
		},
		async listAnnouncementReceipts(uid: string, announcementIds: string[]) {
			state.announcementReceiptBatchCalls += 1
			state.announcementReceiptBatchSizes.push(announcementIds.length)
			const ids = new Set(announcementIds)
			return state.receipts.filter(
				(record) => record.uid === uid && ids.has(String(record.announcementId)),
			)
		},
		async commitAnnouncementAcknowledgement(record: Record<string, unknown>) {
			const existing = state.receipts.find((receipt) => receipt._id === record._id)
			if (existing) return { created: false, record: existing }
			state.receipts.push(record)
			const uid = String(record.uid)
			state.announcementAccountRevisions[uid] = (state.announcementAccountRevisions[uid] ?? 0) + 1
			return { created: true, record }
		},
		async cleanupExpiredAnnouncementReceipts() {
			state.announcementReceiptCleanupCalls += 1
			if (state.announcementReceiptCleanupError) {
				throw state.announcementReceiptCleanupError
			}
			return 0
		},
		async commitAnnouncementPublication(
			record: Record<string, unknown>,
			audit: Record<string, unknown>,
		) {
			const existing = state.announcements.find((value) => value._id === record._id)
			if (existing) return { created: false, record: existing }
			state.announcements.push(record)
			state.dispatchAudits.push(audit)
			state.announcementRevision += 1
			return { created: true, record }
		},
		async commitAnnouncementWithdrawal(
			record: Record<string, unknown>,
			audit: Record<string, unknown>,
		) {
			const index = state.announcements.findIndex((value) => value._id === record._id)
			if (index < 0) return { outcome: 'missing', record: null }
			if (state.announcements[index].status === 'withdrawn') {
				return { outcome: 'unchanged', record: state.announcements[index] }
			}
			state.announcements[index] = record
			state.dispatchAudits.push(audit)
			state.announcementRevision += 1
			return { outcome: 'updated', record }
		},
		async listReleaseCandidates(filter: { runtime?: string; channel?: string; limit?: number }) {
			return state.candidates
				.filter(
					(record) =>
						(!filter.runtime || record.runtime === filter.runtime) &&
						(!filter.channel || record.channel === filter.channel),
				)
				.slice(0, filter.limit)
		},
		async getReleaseCandidate(id: string) {
			return state.candidates.find((record) => record._id === id) ?? null
		},
		async findReleaseCandidate(runtime: string, channel: string, version: string) {
			return (
				state.candidates.find(
					(record) =>
						record.runtime === runtime && record.channel === channel && record.version === version,
				) ?? null
			)
		},
		async createReleaseCandidateIfAbsent(record: Record<string, unknown>) {
			if (
				state.candidates.some(
					(candidate) =>
						candidate._id === record._id ||
						(candidate.runtime === record.runtime &&
							candidate.channel === record.channel &&
							candidate.version === record.version),
				)
			) {
				return false
			}
			state.candidates.push(record)
			return true
		},
		async listReleaseRollouts(filter: { runtime?: string; channel?: string; limit?: number }) {
			return state.releases
				.filter(
					(record) =>
						(!filter.runtime || record.runtime === filter.runtime) &&
						(!filter.channel || record.channel === filter.channel),
				)
				.slice(0, filter.limit)
		},
		async getReleaseRollout(id: string) {
			return state.releases.find((record) => record._id === id) ?? null
		},
		async getReleaseActiveSlot(runtime: string, channel: string) {
			return state.releaseSignals[`${runtime}:${channel}`] ?? null
		},
		async createReleaseRollout(record: Record<string, unknown>) {
			state.releases.push(record)
		},
		async updateReleaseRollout(id: string, patch: Record<string, unknown>) {
			const index = state.releases.findIndex((record) => record._id === id)
			if (index < 0) return null
			state.releases[index] = { ...state.releases[index], ...patch }
			return state.releases[index]
		},
		async incrementReleaseSignal(runtime: string, channel: string) {
			const key = `${runtime}:${channel}`
			state.releaseRevisions[key] = (state.releaseRevisions[key] ?? 0) + 1
			return { revision: state.releaseRevisions[key] }
		},
		async commitReleasePublication(
			record: Record<string, unknown>,
			audit: Record<string, unknown>,
			legacyRolloutIds: string[] = [],
			versionGuard?: { candidateVersion: string; highestPublishedVersion?: string },
		) {
			const existing = state.releases.find((release) => release._id === record._id)
			if (existing) return { created: false, record: existing }
			const key = `${record.runtime}:${record.channel}`
			const signal = state.releaseSignals[key] ?? { _id: key, revision: 0 }
			const storedHighestVersion =
				typeof signal.highestVersion === 'string' ? signal.highestVersion : undefined
			const highestVersion = [storedHighestVersion, versionGuard?.highestPublishedVersion]
				.filter((value): value is string => Boolean(value))
				.sort((left, right) => compareSemver(right, left))[0]
			if (
				versionGuard &&
				highestVersion &&
				compareSemver(highestVersion, versionGuard.candidateVersion) >= 0
			) {
				const error = new Error('Release version must move forward')
				error.name = 'DispatchConflictError'
				throw error
			}
			const previousIds = new Set([
				...(typeof signal.currentRolloutId === 'string' ? [signal.currentRolloutId] : []),
				...legacyRolloutIds,
			])
			state.releases = state.releases.map((release) =>
				previousIds.has(String(release._id)) &&
				(release.status === 'active' || release.status === 'paused')
					? { ...release, status: 'superseded' }
					: release,
			)
			state.releases.push(record)
			state.dispatchAudits.push(audit)
			state.releaseRevisions[key] = (state.releaseRevisions[key] ?? 0) + 1
			state.releaseSignals[key] = {
				...signal,
				revision: state.releaseRevisions[key],
				currentRolloutId: record._id,
				activeRolloutId: record._id,
				...(versionGuard ? { highestVersion: versionGuard.candidateVersion } : {}),
			}
			return { created: true, record }
		},
		async commitReleaseState(
			record: Record<string, unknown>,
			audit: Record<string, unknown>,
			expectedStatus: string,
		) {
			const index = state.releases.findIndex((release) => release._id === record._id)
			if (index < 0) return { outcome: 'missing', record: null }
			if (state.releases[index].status === record.status) {
				return { outcome: 'unchanged', record: state.releases[index] }
			}
			if (state.releases[index].status !== expectedStatus) throw new Error('dispatch conflict')
			state.releases[index] = record
			state.dispatchAudits.push(audit)
			const key = `${record.runtime}:${record.channel}`
			state.releaseRevisions[key] = (state.releaseRevisions[key] ?? 0) + 1
			state.releaseSignals[key] = {
				...(state.releaseSignals[key] ?? { _id: key }),
				revision: state.releaseRevisions[key],
				currentRolloutId: record.status === 'withdrawn' ? null : record._id,
				activeRolloutId: record.status === 'active' ? record._id : null,
			}
			return { outcome: 'updated', record }
		},
		async createReleaseEventWithinQuota(
			record: Record<string, unknown>,
			quota: { id: string; limit: number; expiresAt: string },
		) {
			const existingIndex = state.releaseEvents.findIndex((event) => event._id === record._id)
			if (existingIndex >= 0) {
				if (
					state.releaseEvents[existingIndex].result === 'failure' &&
					record.result === 'success'
				) {
					state.releaseEvents[existingIndex] = {
						...record,
						createdAt: state.releaseEvents[existingIndex].createdAt,
					}
					return { outcome: 'updated' as const }
				}
				return { outcome: 'duplicate' as const }
			}
			const quotaCount = state.releaseEventQuotaCounts[quota.id] ?? 0
			if (quotaCount >= quota.limit) return { outcome: 'quota-exceeded' as const }
			state.releaseEventQuotaCounts[quota.id] = quotaCount + 1
			state.releaseEvents.push(record)
			return { outcome: 'created' as const }
		},
		async listReleaseEvents(filter: {
			releaseId?: string
			createdAfter?: string
			createdBefore?: string
			before?: { createdAt: string; id: string }
			limit?: number
		}) {
			const records = state.releaseEvents
				.filter(
					(record) =>
						(!filter.releaseId || record.releaseId === filter.releaseId) &&
						(!filter.createdAfter ||
							(typeof record.createdAt === 'string' && record.createdAt >= filter.createdAfter)) &&
						(!filter.createdBefore ||
							(typeof record.createdAt === 'string' && record.createdAt < filter.createdBefore)) &&
						(!filter.before ||
							(typeof record.createdAt === 'string' &&
								typeof record._id === 'string' &&
								(record.createdAt < filter.before.createdAt ||
									(record.createdAt === filter.before.createdAt &&
										record._id < filter.before.id)))),
				)
				.sort((left, right) => {
					const byCreatedAt = String(right.createdAt).localeCompare(String(left.createdAt))
					return byCreatedAt || String(right._id).localeCompare(String(left._id))
				})
			return records.slice(0, filter.limit ?? 1_000)
		},
		async cleanupExpiredReleaseEvents(expiredAt: string) {
			state.releaseCleanupCalls += 1
			if (state.releaseCleanupError) throw state.releaseCleanupError
			const before = state.releaseEvents.length
			state.releaseEvents = state.releaseEvents.filter(
				(record) => typeof record.expiresAt !== 'string' || record.expiresAt > expiredAt,
			)
			return before - state.releaseEvents.length
		},
		async createDispatchAudit(record: Record<string, unknown>) {
			state.dispatchAudits.push(record)
		},
	}
}

function createState(overrides: Partial<StoreState> = {}): StoreState {
	return {
		adminRole: 'admin',
		adminStatus: 'active',
		audits: [],
		announcements: [],
		receipts: [],
		candidates: [],
		releases: [],
		releaseEvents: [],
		releaseEventQuotaCounts: {},
		releaseCleanupCalls: 0,
		dispatchAudits: [],
		announcementRevision: 0,
		announcementAccountRevisions: {},
		announcementReceiptBatchCalls: 0,
		announcementReceiptBatchSizes: [],
		announcementReceiptCleanupCalls: 0,
		releaseRevisions: {},
		releaseSignals: {},
		user: {
			_id: USER_ID,
			uid: USER_ID,
			active: true,
			firstSeenAt: '2026-06-30T00:00:00.000Z',
			lastSeenAt: '2026-07-01T12:00:00.000Z',
			createdAt: '2026-07-01T00:00:00.000Z',
			updatedAt: '2026-07-01T00:00:00.000Z',
		},
		...overrides,
	}
}

function createFetch(active = true) {
	return vi.fn(async () => Response.json({ active, sub: 'admin-uid' }))
}

async function request(
	path: string,
	state: StoreState,
	init: {
		method?: string
		body?: unknown
		query?: Record<string, string | undefined>
		headers?: Record<string, string>
		env?: Record<string, string | number>
		fetchImpl?: typeof fetch
		store?: Partial<ReturnType<typeof createStore>>
	} = {},
) {
	return handleAdminRequest({
		method: init.method ?? 'GET',
		path,
		query: init.query,
		headers:
			init.headers === undefined
				? {
						authorization: `Bearer ${ADMIN_TOKEN}`,
						'idempotency-key': 'test-idempotency-key-0001',
					}
				: init.headers,
		rawBody: init.body ? JSON.stringify(init.body) : '{}',
		env: {
			cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
			cloudbaseClientId: 'client-id',
			releaseEventTokenSecret: EVENT_TOKEN_SECRET,
			...init.env,
		},
		store: { ...createStore(state), ...init.store },
		fetchImpl: init.fetchImpl ?? createFetch(),
		now: () => TEST_NOW,
	})
}

function parseBody(response: { body: string }) {
	return response.body ? JSON.parse(response.body) : null
}

function createUserFetch(uid = USER_ID) {
	return vi.fn(async () => Response.json({ uid, status: 'ACTIVE' }))
}

function createAnnouncement(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'announcement-1',
		schemaVersion: 1,
		status: 'published',
		importance: 'normal',
		title: '系统消息',
		body: '请留意最近的服务变化。',
		audience: {},
		publishedAt: '2026-07-01T00:00:00.000Z',
		expiresAt: '2026-07-20T00:00:00.000Z',
		publishedBy: 'admin-uid',
		...overrides,
	}
}

function createReleaseManifest(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		releaseId: 'electron-stable-0.1.1',
		runtime: 'electron',
		channel: 'stable',
		version: '0.1.1',
		createdAt: '2026-07-01T00:00:00.000Z',
		manifestUrl: 'https://updates.example.test/electron/stable/0.1.1/manifest.json',
		sourceCoordinates: {
			repository: 'https://github.com/example/wenxue',
			commit: 'a'.repeat(40),
			browserVersion: '137.0.7151.70',
			extensionVersion: '0.1.1',
		},
		distribution: { mode: 'manual-unsigned' },
		tests: ['quality', 'manual-installer-integrity', 'manifest-tamper-rejection'].map((name) => ({
			name,
			status: 'passed',
			url: `https://ci.example.test/${name}`,
		})),
		artifacts: [
			createArtifact('darwin', 'arm64', 'dmg'),
			createArtifact('darwin', 'x64', 'dmg'),
			createArtifact('win32', 'x64', 'nsis'),
		],
		...overrides,
	}
}

function createArtifact(platform: string, arch: string, kind: string) {
	const extension = kind === 'nsis' ? 'exe' : kind
	const fileName = `wenxue-${platform}-${arch}.${extension}`
	return {
		platform,
		arch,
		kind,
		fileName,
		url: `https://updates.example.test/artifacts/${fileName}`,
		sha512: Buffer.alloc(64, 7).toString('base64'),
		size: 1024,
	}
}

function candidateRecord(manifest = createReleaseManifest()) {
	return {
		...manifest,
		_id: manifest.releaseId,
		manifestSignature: Buffer.alloc(64, 1).toString('base64'),
		status: 'verified',
		registeredAt: '2026-07-01T01:00:00.000Z',
	}
}

function keyFingerprint(publicKey: KeyObject) {
	return createHash('sha256')
		.update(publicKey.export({ type: 'spki', format: 'der' }))
		.digest('hex')
}

function signedReleaseRegistration(manifest: ReturnType<typeof createReleaseManifest>) {
	const { privateKey, publicKey } = generateKeyPairSync('ed25519')
	return {
		method: 'POST',
		headers: { authorization: 'Bearer ci-token' },
		env: {
			releaseCiToken: 'ci-token',
			releaseManifestPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
		},
		body: {
			manifestUrl: manifest.manifestUrl,
			manifest,
			manifestSignature: sign(
				null,
				Buffer.from(sharedCanonicalJson(manifest)),
				privateKey,
			).toString('base64'),
			publicKeyFingerprint: keyFingerprint(publicKey),
		},
	}
}

function releaseEventToken(installIdHash: string, overrides: Record<string, unknown> = {}) {
	const encoded = Buffer.from(
		JSON.stringify({
			schemaVersion: 1,
			releaseId: 'electron-stable-0.1.1',
			installIdHash,
			runtime: 'electron',
			platform: 'darwin',
			arch: 'arm64',
			fromVersion: '0.1.0',
			expiresAt: TEST_NOW + 7 * 24 * 60 * 60 * 1000,
			...overrides,
		}),
	).toString('base64url')
	return `${encoded}.${createHmac('sha256', EVENT_TOKEN_SECRET).update(encoded).digest('base64url')}`
}

function releaseEventQuotaShard(installIdHash: string, shardCount: number) {
	const eventId = `event-${createHash('sha256')
		.update(`event\u0000electron-stable-0.1.1\u0000${installIdHash}:check:final`, 'utf8')
		.digest('hex')}`
	return createHash('sha256').update(eventId, 'utf8').digest().readUInt32BE(0) % shardCount
}

function rolloutRecord(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'rollout-1',
		runtime: 'electron',
		channel: 'stable',
		releaseId: 'electron-stable-0.1.1',
		status: 'active',
		percentage: 25,
		mode: 'optional',
		title: '问学 0.1.1',
		notes: '稳定性改进',
		publishedAt: '2026-07-01T01:00:00.000Z',
		publishedBy: 'admin-uid',
		updatedAt: '2026-07-01T01:00:00.000Z',
		updatedBy: 'admin-uid',
		...overrides,
	}
}

describe('AdminApi', () => {
	it('rejects requests without a CloudBase Auth bearer token', async () => {
		const response = await handleAdminRequest({
			method: 'GET',
			path: '/admin/v1/me',
			headers: {},
			env: {
				cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
				cloudbaseClientId: 'client-id',
			},
			store: createStore(createState()),
			fetchImpl: createFetch(),
		})

		expect(response.statusCode).toBe(401)
		expect(parseBody(response).error.message).toBe('Missing admin token')
	})

	it('requires an active admin_users record after CloudBase token introspection', async () => {
		const state = createState({ adminRole: undefined, adminStatus: undefined })
		const response = await request('/admin/v1/me', state)

		expect(response.statusCode).toBe(403)
		expect(parseBody(response).error.message).toBe('Admin user is not allowed')
	})

	it('reports invalid JSON from successful CloudBase introspection as an upstream error', async () => {
		const response = await handleAdminRequest({
			method: 'GET',
			path: '/admin/v1/me',
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
			env: {
				cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
				cloudbaseClientId: 'client-id',
			},
			store: createStore(createState()),
			fetchImpl: async () => new Response('<html>temporary proxy error</html>'),
		})

		expect(response.statusCode).toBe(502)
		expect(parseBody(response).error.message).toBe('CloudBase authentication returned invalid JSON')
	})

	it('does not expose unexpected backend error details to the browser', async () => {
		const response = await handleAdminRequest({
			method: 'GET',
			path: '/admin/v1/me',
			headers: {
				authorization: `Bearer ${ADMIN_TOKEN}`,
			},
			env: {
				cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
				cloudbaseClientId: 'client-id',
			},
			store: {
				...createStore(createState()),
				async getAdminUser() {
					throw new Error('secret id error: Bearer internal-api-key')
				},
			},
			fetchImpl: createFetch(),
		})

		expect(response.statusCode).toBe(500)
		expect(parseBody(response).error.message).toBe('Admin API internal error')
		expect(response.body).not.toMatch(/secret id|Bearer|internal-api-key/i)
	})

	it('returns a redacted aggregate tokens dashboard by user', async () => {
		const response = await request('/admin/v1/usage/summary', createState())
		const body = parseBody(response)

		expect(response.statusCode).toBe(200)
		expect(body.totalInputTokens).toBe(12)
		expect(body.totalOutputTokens).toBe(8)
		expect(body.totalTokens).toBe(20)
		expect(body.byUser).toEqual([expect.objectContaining({ key: USER_ID, totalTokens: 20 })])
		expect(body.byModel).toEqual([
			expect.objectContaining({ key: 'qwen-plus', totalTokens: 15 }),
			expect.objectContaining({ key: 'qwen3.7-plus', totalTokens: 5 }),
		])
		expect(JSON.stringify(body)).not.toMatch(/content|authorization|bearer|api[_-]?key/i)
	})

	it('times out when CloudBase auth sends headers but stalls its JSON body', async () => {
		const stalledBody = new ReadableStream<Uint8Array>({ start() {} })
		const response = await request('/admin/v1/usage/summary', createState(), {
			env: { requestTimeoutMs: 5 },
			fetchImpl: vi.fn(
				async () =>
					new Response(stalledBody, {
						status: 200,
						headers: { 'content-type': 'application/json' },
					}),
			),
		})

		expect(response.statusCode).toBe(504)
		expect(parseBody(response).error.message).toMatch(/timed out/i)
	})

	it('lets viewers read but not change user status', async () => {
		const state = createState({ adminRole: 'viewer' })
		const read = await request('/admin/v1/users', state)
		const write = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: {
				userId: USER_ID,
				status: 'disabled',
			},
		})

		expect(read.statusCode).toBe(200)
		expect(parseBody(read).users[0]).toMatchObject({
			userId: USER_ID,
			email: 'user@example.com',
			nickname: '小问',
			inputTokens: 12,
			outputTokens: 8,
			totalTokens: 20,
		})
		expect(write.statusCode).toBe(403)
		expect(parseBody(write).error.message).toBe('Admin role is required')
	})

	it('updates a user note and writes an audit record for admins', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const response = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: {
				userId: USER_ID,
				note: 'abnormal usage',
				reason: 'manual review',
			},
		})
		const body = parseBody(response)

		expect(response.statusCode).toBe(200)
		expect(body.user).toMatchObject({
			userId: USER_ID,
			status: 'active',
			note: 'abnormal usage',
		})
		expect(state.user).toMatchObject({
			active: true,
			note: 'abnormal usage',
		})
		expect(state.audits).toHaveLength(1)
		expect(state.audits[0]).toMatchObject({
			userId: USER_ID,
			adminUid: 'admin-uid',
			reason: 'manual review',
		})
	})

	it('updates authoritative CloudBase Auth status and audits the intent and result', async () => {
		const state = createState()
		const response = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: {
				userId: USER_ID,
				status: 'disabled',
				reason: 'manual review',
			},
		})

		expect(response.statusCode).toBe(200)
		expect(parseBody(response).user).toMatchObject({
			status: 'disabled',
			totalTokens: 20,
			updatedAt: new Date(TEST_NOW).toISOString(),
		})
		expect(state.authUpdates).toEqual([{ userId: USER_ID, active: false }])
		expect(state.user.active).toBe(true)
		expect(state.audits.map((audit) => audit.outcome)).toEqual(['requested', 'applied'])
	})

	it.each(['active', 'disabled'] as const)(
		'applies explicit %s status even when the read snapshot matches and a concurrent admin changes it',
		async (status) => {
			const state = createState({ authStatus: status })
			const response = await request('/admin/v1/users/status', state, {
				method: 'PATCH',
				body: { userId: USER_ID, status },
				store: {
					async getAuthUser() {
						const snapshot = { _id: USER_ID, uid: USER_ID, active: status === 'active', status }
						state.authStatus = status === 'active' ? 'disabled' : 'active'
						return snapshot
					},
				},
			})
			expect(response.statusCode).toBe(200)
			expect(state.authUpdates).toEqual([{ userId: USER_ID, active: status === 'active' }])
			expect(state.authStatus).toBe(status)
			expect(state.audits.map((audit) => audit.outcome)).toEqual(['requested', 'applied'])
		},
	)

	it('uses Auth users and status even when legacy records disagree or are missing', async () => {
		const state = createState({
			authUsers: [
				{
					_id: USER_ID,
					uid: USER_ID,
					active: false,
					status: 'disabled',
					email: 'user@example.com',
					nickname: '同名昵称',
				},
				{
					_id: 'new-uid',
					uid: 'new-uid',
					active: true,
					status: 'active',
					email: 'new@example.com',
					nickname: '同名昵称',
				},
			],
		})
		state.user.note = '业务备注'
		const users = parseBody(await request('/admin/v1/users', state)).users
		expect(users).toHaveLength(2)
		expect(users[0]).toMatchObject({
			userId: USER_ID,
			status: 'disabled',
			note: '业务备注',
			totalTokens: 20,
		})
		expect(users[1]).toMatchObject({
			userId: 'new-uid',
			status: 'active',
			email: 'new@example.com',
			nickname: '同名昵称',
		})
		expect(
			parseBody(await request('/admin/v1/users', state, { query: { status: 'active', q: 'NEW@' } }))
				.users,
		).toHaveLength(1)
		expect(parseBody(await request('/admin/v1/usage/summary', state)).userStatus).toEqual({
			active: 1,
			disabled: 1,
			total: 2,
		})
	})

	it.each(['admin-uid', 'internal-uid'])(
		'prevents disabling self or internal administrators: %s',
		async (uid) => {
			const state = createState({
				authUsers: [
					{
						_id: uid,
						uid,
						active: true,
						status: 'active',
						userType: uid === 'internal-uid' ? 'internalUser' : 'externalUser',
					},
				],
			})
			const response = await request('/admin/v1/users/status', state, {
				method: 'PATCH',
				body: { userId: uid, status: 'disabled' },
			})
			expect(response.statusCode).toBe(403)
			expect(state.authUpdates).toBeUndefined()
			expect(state.audits).toEqual([])
		},
	)

	it('returns the complete Auth directory by default and limits only when explicitly requested', async () => {
		const authUsers = Array.from({ length: 501 }, (_, index) => ({
			_id: `auth-${index}`,
			uid: `auth-${index}`,
			active: true,
			status: 'active' as const,
			email: `user-${index}@example.com`,
			nickname: `用户 ${index}`,
		}))
		const state = createState({ authUsers })
		const response = await request('/admin/v1/users', state)
		expect(response.statusCode).toBe(200)
		expect(parseBody(response).users).toHaveLength(501)
		expect(parseBody(response).users.at(-1)).toMatchObject({
			userId: 'auth-500',
			email: 'user-500@example.com',
		})
		const limited = await request('/admin/v1/users', state, { query: { limit: '10' } })
		expect(parseBody(limited).users).toHaveLength(10)
	})

	it('retains UID-joined historical timestamps and the latest Auth login', async () => {
		const state = createState({
			authUsers: [
				{
					_id: USER_ID,
					uid: USER_ID,
					active: true,
					status: 'active',
					email: 'user@example.com',
					nickname: '小问',
					lastSeenAt: '2026-09-22T00:00:00.000Z',
				},
			],
		})
		const response = await request('/admin/v1/users', state)
		expect(parseBody(response).users[0]).toMatchObject({
			email: 'user@example.com',
			nickname: '小问',
			firstSeenAt: state.user.firstSeenAt,
			createdAt: state.user.createdAt,
			lastSeenAt: '2026-09-22T00:00:00.000Z',
		})
	})

	it('preserves token totals and records an unconfirmed audit when note persistence fails after a status change', async () => {
		const state = createState()
		const response = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: { userId: USER_ID, status: 'disabled', note: 'new note' },
			store: {
				...createStore(state),
				updateUserAccount: vi.fn().mockRejectedValue(new Error('storage unavailable')),
			},
		})
		expect(response.statusCode).toBe(500)
		expect(state.authUpdates).toEqual([{ userId: USER_ID, active: false }])
		expect(state.audits.map((audit) => audit.outcome)).toEqual(['requested', 'unconfirmed'])
		expect(state.audits[0].operationId).toBe(state.audits[1].operationId)
	})

	it('does not use legacy users when the Auth directory is unavailable', async () => {
		const state = createState({ authError: new Error('unavailable') })
		const response = await request('/admin/v1/users', state)
		expect(response.statusCode).toBe(500)
		expect(parseBody(response)).not.toHaveProperty('users')
	})

	it('does not show orphaned legacy accounts or mutate an account absent from Auth', async () => {
		const state = createState({ authUsers: [] })
		expect(parseBody(await request('/admin/v1/users', state)).users).toEqual([])
		const response = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: { userId: USER_ID, note: 'orphan' },
		})
		expect(response.statusCode).toBe(404)
		expect(state.audits).toEqual([])
	})

	it('requires a durable audit intent before sending an Auth status mutation', async () => {
		const state = createState()
		const updateAuthUserStatus = vi.fn()
		const response = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: { userId: USER_ID, status: 'disabled' },
			store: {
				createUserPermissionAudit: vi.fn().mockRejectedValue(new Error('audit unavailable')),
				updateAuthUserStatus,
			},
		})
		expect(response.statusCode).toBe(500)
		expect(updateAuthUserStatus).not.toHaveBeenCalled()
	})

	it('does not report success or change notes when the Auth mutation fails', async () => {
		const state = createState()
		const updateUserAccount = vi.fn()
		const response = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: { userId: USER_ID, status: 'disabled', note: 'changed' },
			store: {
				updateAuthUserStatus: vi.fn().mockRejectedValue(new Error('Auth unavailable')),
				updateUserAccount,
			},
		})
		expect(response.statusCode).toBe(500)
		expect(updateUserAccount).not.toHaveBeenCalled()
		expect(state.audits.map((audit) => audit.outcome)).toEqual(['requested', 'unconfirmed'])
	})

	it('builds user status counts from user accounts', () => {
		const summary = buildAdminUsageSummary(
			[],
			[
				createState().user,
				{
					...createState().user,
					_id: 'user_disabled',
					uid: 'user_disabled',
					active: false,
				},
			],
		)

		expect(summary.userStatus).toEqual({ active: 1, disabled: 1, total: 2 })
	})
})

describe('AdminApi announcement dispatch', () => {
	it('publishes validated content, writes a redacted audit, and increments the signal', async () => {
		const state = createState()
		const response = await request('/admin/v1/announcements', state, {
			method: 'POST',
			body: {
				importance: 'important',
				title: '  服务提醒  ',
				body: '  今晚将进行短时维护。  ',
				detailUrl: 'https://status.example.test/notices/1',
				audience: {
					platforms: ['darwin', 'darwin'],
					minVersion: '0.1.0',
					maxVersion: '0.1.9',
					userIds: [USER_ID],
				},
			},
		})
		const body = parseBody(response)

		expect(response.statusCode).toBe(201)
		expect(body.announcement).toMatchObject({
			status: 'published',
			importance: 'important',
			title: '服务提醒',
			body: '今晚将进行短时维护。',
			audience: { platforms: ['darwin'], userIds: [USER_ID] },
			expiresAt: '2026-07-08T09:04:00.000Z',
		})
		expect(state.announcements).toHaveLength(1)
		expect(state.announcementRevision).toBe(1)
		expect(state.dispatchAudits).toEqual([
			expect.objectContaining({
				action: 'announcement.publish',
				after: expect.objectContaining({ targetUserCount: 1 }),
			}),
		])
		expect(JSON.stringify(state.dispatchAudits)).not.toContain(USER_ID)
		expect(JSON.stringify(state.dispatchAudits)).not.toContain('今晚将进行短时维护')
	})

	it('rejects invalid URLs, duplicate users, oversized targets, and long expiry', async () => {
		const base = {
			importance: 'normal',
			title: '提醒',
			body: '正文',
			audience: {},
		}
		const invalidUrl = await request('/admin/v1/announcements', createState(), {
			method: 'POST',
			body: { ...base, detailUrl: 'http://example.test' },
		})
		const duplicateUsers = await request('/admin/v1/announcements', createState(), {
			method: 'POST',
			body: { ...base, audience: { userIds: [USER_ID, USER_ID] } },
		})
		const tooManyUsers = await request('/admin/v1/announcements', createState(), {
			method: 'POST',
			body: {
				...base,
				audience: { userIds: Array.from({ length: 501 }, (_, index) => `user-${index}`) },
			},
		})
		const longExpiry = await request('/admin/v1/announcements', createState(), {
			method: 'POST',
			body: { ...base, expiresAt: '2026-08-15T00:00:00.000Z' },
		})

		expect(invalidUrl.statusCode).toBe(400)
		expect(duplicateUsers.statusCode).toBe(400)
		expect(tooManyUsers.statusCode).toBe(400)
		expect(longExpiry.statusCode).toBe(400)
	})

	it('allows viewers to list announcements but never publish them', async () => {
		const state = createState({
			adminRole: 'viewer',
			announcements: [createAnnouncement()],
		})
		const read = await request('/admin/v1/announcements', state)
		const write = await request('/admin/v1/announcements', state, {
			method: 'POST',
			body: {
				importance: 'normal',
				title: '提醒',
				body: '正文',
				audience: {},
			},
		})

		expect(read.statusCode).toBe(200)
		expect(parseBody(read).announcements).toHaveLength(1)
		expect(write.statusCode).toBe(403)
		expect(state.announcements).toHaveLength(1)
	})

	it('matches user, platform, and inclusive version dimensions with important-first ordering', async () => {
		const state = createState({
			announcements: [
				createAnnouncement({ _id: 'normal', publishedAt: '2026-07-01T00:00:00.000Z' }),
				createAnnouncement({
					_id: 'important',
					importance: 'important',
					publishedAt: '2026-07-01T01:00:00.000Z',
					audience: {
						platforms: ['darwin'],
						minVersion: '0.1.0',
						maxVersion: '0.1.1',
						userIds: [USER_ID],
					},
				}),
				createAnnouncement({ _id: 'wrong-platform', audience: { platforms: ['win32'] } }),
				createAnnouncement({ _id: 'wrong-version', audience: { minVersion: '0.2.0' } }),
				createAnnouncement({ _id: 'wrong-user', audience: { userIds: ['somebody-else'] } }),
				createAnnouncement({ _id: 'expired', expiresAt: '2026-06-30T00:00:00.000Z' }),
			],
		})
		const response = await request('/v1/client/announcements/pending', state, {
			query: { platform: 'darwin', version: '0.1.1' },
			headers: { authorization: 'Bearer user-token' },
			fetchImpl: createUserFetch(),
		})
		const announcements = parseBody(response).announcements

		expect(response.statusCode).toBe(200)
		expect(announcements.map((item: { id: string }) => item.id)).toEqual(['important', 'normal'])
		expect(announcements[0]).not.toHaveProperty('audience')
		expect(announcements[0]).not.toHaveProperty('publishedBy')
		expect(announcements[0]).not.toHaveProperty('status')
		expect(state.announcementReceiptBatchCalls).toBe(1)
		expect(state.announcementReceiptBatchSizes).toEqual([2])
		expect(state.announcementReceiptCleanupCalls).toBe(1)
	})

	it('checks receipts in bounded batches and stops after finding ten pending messages', async () => {
		const announcements = Array.from({ length: 65 }, (_, index) =>
			createAnnouncement({
				_id: `announcement-${String(index + 1).padStart(2, '0')}`,
				publishedAt: `2026-07-01T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(
					index % 60,
				).padStart(2, '0')}:00.000Z`,
			}),
		)
		const state = createState({
			announcements,
			receipts: announcements.slice(0, 50).map((announcement) => ({
				_id: `${String(announcement._id)}:${USER_ID}`,
				announcementId: announcement._id,
				uid: USER_ID,
			})),
		})

		const response = await request('/v1/client/announcements/pending', state, {
			query: { platform: 'darwin', version: '0.1.1' },
			headers: { authorization: 'Bearer user-token' },
			fetchImpl: createUserFetch(),
		})

		expect(parseBody(response).announcements).toHaveLength(10)
		expect(parseBody(response).announcements[0].id).toBe('announcement-51')
		expect(state.announcementReceiptBatchCalls).toBe(2)
		expect(state.announcementReceiptBatchSizes).toEqual([50, 15])
	})

	it.each(['pending', 'ack'])(
		'checks authoritative Auth state for %s when the user profile omits status',
		async (target) => {
			for (const condition of ['active', 'disabled', 'missing', 'failed'] as const) {
				const state = createState({ announcements: [createAnnouncement()] })
				const getAuthUser = vi.fn(async (uid: string) => {
					if (condition === 'failed') throw new Error('sensitive-control-plane-detail')
					if (condition === 'missing') return null
					return {
						_id: uid,
						uid,
						active: condition === 'active',
						status: condition,
					}
				})
				const response = await request(
					target === 'pending' ? '/v1/client/announcements/pending' : '/v1/client/announcement-ack',
					state,
					{
						method: target === 'pending' ? 'GET' : 'POST',
						query: { platform: 'darwin', version: '0.1.1' },
						body: { announcementId: 'announcement-1' },
						headers: { authorization: 'Bearer user-token' },
						fetchImpl: async () => Response.json({ sub: USER_ID, type: 'external' }),
						store: { getAuthUser },
					},
				)
				expect(response.statusCode).toBe(
					condition === 'active' ? 200 : condition === 'failed' ? 503 : 403,
				)
				expect(getAuthUser).toHaveBeenCalledOnce()
				expect(getAuthUser).toHaveBeenCalledWith(USER_ID, expect.any(Number))
				expect(response.body).not.toContain('sensitive-control-plane-detail')
				if (condition !== 'active') {
					expect(state.receipts).toHaveLength(0)
					expect(state.announcementReceiptBatchCalls).toBe(0)
				}
			}
		},
	)

	it.each(['ACTIVE', 'BLOCKED', null])(
		'keeps an explicit client profile status %s authoritative',
		async (status) => {
			const getAuthUser = vi.fn().mockRejectedValue(new Error('must not query'))
			const response = await request('/v1/client/announcements/pending', createState(), {
				query: { platform: 'darwin', version: '0.1.1' },
				headers: { authorization: 'Bearer user-token' },
				fetchImpl: async () => Response.json({ sub: USER_ID, status }),
				store: { getAuthUser },
			})
			expect(response.statusCode).toBe(status === 'ACTIVE' ? 200 : 403)
			expect(getAuthUser).not.toHaveBeenCalled()
		},
	)

	it('uses the remaining client authentication budget and rejects a mismatched Auth UID', async () => {
		vi.useFakeTimers()
		const getAuthUser = vi.fn().mockResolvedValue({ uid: 'wrong-user', active: true })
		try {
			const pending = request('/v1/client/announcements/pending', createState(), {
				query: { platform: 'darwin', version: '0.1.1' },
				headers: { authorization: 'Bearer user-token' },
				env: { requestTimeoutMs: 3_000 },
				fetchImpl: async () => {
					await new Promise((resolve) => setTimeout(resolve, 2_000))
					return Response.json({ sub: USER_ID })
				},
				store: { getAuthUser },
			})
			await vi.advanceTimersByTimeAsync(2_000)
			const response = await pending
			expect(response.statusCode).toBe(503)
			expect(getAuthUser).toHaveBeenCalledWith(USER_ID, 1_000)
		} finally {
			vi.useRealTimers()
		}
	})

	it('keeps pending delivery available when bounded receipt cleanup fails', async () => {
		const state = createState({
			announcements: [createAnnouncement()],
			announcementReceiptCleanupError: new Error('temporary cleanup failure'),
		})

		const response = await request('/v1/client/announcements/pending', state, {
			query: { platform: 'darwin', version: '0.1.1' },
			headers: { authorization: 'Bearer user-token' },
			fetchImpl: createUserFetch(),
		})

		expect(response.statusCode).toBe(200)
		expect(parseBody(response).announcements).toHaveLength(1)
		expect(state.announcementReceiptCleanupCalls).toBe(1)
	})

	it('acknowledges once per account and removes the message from future pending results', async () => {
		const state = createState({ announcements: [createAnnouncement()] })
		const init = {
			method: 'POST',
			body: { announcementId: 'announcement-1' },
			headers: { authorization: 'Bearer user-token' },
			fetchImpl: createUserFetch(),
		} as const
		const first = await request('/v1/client/announcement-ack', state, init)
		const second = await request('/v1/client/announcement-ack', state, init)
		const pending = await request('/v1/client/announcements/pending', state, {
			query: { platform: 'darwin', version: '0.1.1' },
			headers: { authorization: 'Bearer user-token' },
			fetchImpl: createUserFetch(),
		})

		expect(first.statusCode).toBe(200)
		expect(second.statusCode).toBe(200)
		expect(state.receipts).toHaveLength(1)
		expect(state.receipts[0]).toMatchObject({
			announcementId: 'announcement-1',
			uid: USER_ID,
			acknowledgedAt: '2026-07-01T09:04:00.000Z',
			expiresAt: '2026-07-21T00:00:00.000Z',
		})
		expect(state.announcementRevision).toBe(0)
		expect(state.announcementAccountRevisions).toEqual({ [USER_ID]: 1 })
		expect(state.announcementReceiptBatchCalls).toBe(1)
		expect(state.announcementReceiptCleanupCalls).toBe(1)
		expect(parseBody(pending).announcements).toEqual([])
	})

	it('withdraws idempotently and increments revision only for the state change', async () => {
		const state = createState({ announcements: [createAnnouncement()] })
		const first = await request('/admin/v1/announcement-withdraw', state, {
			method: 'POST',
			body: { id: 'announcement-1' },
		})
		const second = await request('/admin/v1/announcement-withdraw', state, {
			method: 'POST',
			body: { id: 'announcement-1' },
		})

		expect(first.statusCode).toBe(200)
		expect(second.statusCode).toBe(200)
		expect(parseBody(second).announcement.status).toBe('withdrawn')
		expect(state.announcementRevision).toBe(1)
		expect(state.dispatchAudits).toHaveLength(1)
	})
})

describe('AdminApi release dispatch', () => {
	it('registers, rereads, and publishes a signed two-target candidate', async () => {
		const manifest = createReleaseManifest({
			artifacts: [createArtifact('darwin', 'arm64', 'dmg'), createArtifact('win32', 'x64', 'nsis')],
		})
		const registration = signedReleaseRegistration(manifest)
		const state = createState()
		const first = await request('/internal/v1/release-candidates/register', state, registration)
		const replay = await request('/internal/v1/release-candidates/register', state, registration)
		const listed = await request('/admin/v1/release-candidates', state)
		const published = await request('/admin/v1/release-publish', state, {
			method: 'POST',
			body: {
				candidateId: manifest.releaseId,
				title: '问学 0.1.1',
				notes: '稳定性改进',
				percentage: 100,
				mode: 'optional',
			},
		})

		expect(first.statusCode).toBe(200)
		expect(replay.statusCode).toBe(200)
		expect(parseBody(replay).candidate).toEqual(parseBody(first).candidate)
		expect(state.candidates).toHaveLength(1)
		expect(listed.statusCode).toBe(200)
		expect(parseBody(listed).candidates).toEqual([parseBody(first).candidate])
		expect(parseBody(first).candidate.artifacts).toEqual(manifest.artifacts)
		expect(parseBody(first).candidate.manifestSignature).toBe(registration.body.manifestSignature)
		expect(published.statusCode).toBe(201)
		for (const [platform, arch, kind] of [
			['darwin', 'arm64', 'dmg'],
			['win32', 'x64', 'nsis'],
		]) {
			const policy = await request('/v1/client/update-policy', state, {
				query: {
					runtime: 'electron',
					platform,
					arch,
					channel: 'stable',
					version: '0.1.0',
					installIdHash: 'a'.repeat(64),
				},
			})
			expect(policy.statusCode).toBe(200)
			expect(parseBody(policy).policy.artifacts).toEqual([
				expect.objectContaining({ platform, arch, kind }),
			])
		}
	})

	it.each([
		['missing Windows', [createArtifact('darwin', 'arm64', 'dmg')]],
		[
			'missing macOS arm64',
			[createArtifact('darwin', 'x64', 'dmg'), createArtifact('win32', 'x64', 'nsis')],
		],
		[
			'duplicate target',
			[createArtifact('darwin', 'arm64', 'dmg'), createArtifact('darwin', 'arm64', 'dmg')],
		],
		[
			'wrong installer kind',
			[createArtifact('darwin', 'arm64', 'nsis'), createArtifact('win32', 'x64', 'nsis')],
		],
		[
			'unsupported extra target',
			[
				createArtifact('darwin', 'arm64', 'dmg'),
				createArtifact('win32', 'x64', 'nsis'),
				createArtifact('linux', 'x64', 'deb'),
			],
		],
	] as const)('rejects a signed matrix with %s', async (_reason, artifacts) => {
		const state = createState()
		const manifest = createReleaseManifest({ artifacts })
		const response = await request(
			'/internal/v1/release-candidates/register',
			state,
			signedReleaseRegistration(manifest),
		)
		expect(response.statusCode).toBe(400)
		expect(state.candidates).toHaveLength(0)
	})

	it('authenticates CI, verifies Ed25519, and registers an immutable candidate idempotently', async () => {
		const { privateKey, publicKey } = generateKeyPairSync('ed25519')
		const manifest = createReleaseManifest()
		const manifestSignature = sign(
			null,
			Buffer.from(sharedCanonicalJson(manifest)),
			privateKey,
		).toString('base64')
		const state = createState()
		const init = {
			method: 'POST',
			headers: { authorization: 'Bearer ci-token' },
			env: {
				releaseCiToken: 'ci-token',
				releaseManifestPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
			},
			body: {
				manifestUrl: manifest.manifestUrl,
				manifest,
				manifestSignature,
				publicKeyFingerprint: keyFingerprint(publicKey),
			},
		}
		const first = await request('/internal/v1/release-candidates/register', state, init)
		const second = await request('/internal/v1/release-candidates/register', state, init)
		const candidate = parseBody(first).candidate

		expect(first.statusCode).toBe(200)
		expect(second.statusCode).toBe(200)
		expect(candidate).toMatchObject({
			releaseId: 'electron-stable-0.1.1',
			distribution: { mode: 'manual-unsigned' },
			status: 'verified',
		})
		expect(candidate).not.toHaveProperty('signingIdentity')
		expect(candidate.artifacts).toHaveLength(3)
		expect(
			candidate.artifacts.every((artifact: Record<string, unknown>) => !('feedUrl' in artifact)),
		).toBe(true)
		expect(state.candidates).toHaveLength(1)
	})

	it('requires the manual-unsigned contract and rejects legacy signing evidence fields', async () => {
		const { publicKey } = generateKeyPairSync('ed25519')
		const env = {
			releaseCiToken: 'ci-token',
			releaseManifestPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
		}
		const requestCandidate = (manifest: Record<string, unknown>) =>
			request('/internal/v1/release-candidates/register', createState(), {
				method: 'POST',
				headers: { authorization: 'Bearer ci-token' },
				env,
				body: {
					manifestUrl: manifest.manifestUrl,
					manifest,
					manifestSignature: Buffer.alloc(64, 1).toString('base64'),
					publicKeyFingerprint: keyFingerprint(publicKey),
				},
			})
		const missingDistribution = await requestCandidate(
			createReleaseManifest({ distribution: undefined }),
		)
		const signedPlatformIdentity = await requestCandidate({
			...createReleaseManifest(),
			signingIdentity: { macos: 'Developer ID', windows: 'CN=WenXue' },
		})
		const externalAttestation = await requestCandidate(
			createReleaseManifest({
				tests: createReleaseManifest().tests.map((test, index) =>
					index === 0 ? { ...test, issuer: 'external-signer' } : test,
				),
			}),
		)

		expect(missingDistribution.statusCode).toBe(400)
		expect(signedPlatformIdentity.statusCode).toBe(400)
		expect(externalAttestation.statusCode).toBe(400)
	})

	it('rejects missing CI credentials, tampering, incomplete matrices, and version overwrites', async () => {
		const { privateKey, publicKey } = generateKeyPairSync('ed25519')
		const publicKeyValue = publicKey.export({ type: 'spki', format: 'pem' }).toString()
		const manifest = createReleaseManifest()
		const signature = sign(null, Buffer.from(sharedCanonicalJson(manifest)), privateKey).toString(
			'base64',
		)
		const state = createState()
		const missingToken = await request('/internal/v1/release-candidates/register', state, {
			method: 'POST',
			headers: {},
			env: { releaseCiToken: 'ci-token', releaseManifestPublicKey: publicKeyValue },
			body: {
				manifestUrl: manifest.manifestUrl,
				manifest,
				manifestSignature: signature,
				publicKeyFingerprint: keyFingerprint(publicKey),
			},
		})
		const tampered = await request('/internal/v1/release-candidates/register', state, {
			method: 'POST',
			headers: { authorization: 'Bearer ci-token' },
			env: { releaseCiToken: 'ci-token', releaseManifestPublicKey: publicKeyValue },
			body: {
				manifestUrl: manifest.manifestUrl,
				manifest: { ...manifest, version: '0.1.2' },
				manifestSignature: signature,
				publicKeyFingerprint: keyFingerprint(publicKey),
			},
		})
		const incompleteManifest = createReleaseManifest({
			artifacts: [createArtifact('darwin', 'arm64', 'dmg')],
		})
		const incomplete = await request('/internal/v1/release-candidates/register', state, {
			method: 'POST',
			headers: { authorization: 'Bearer ci-token' },
			env: { releaseCiToken: 'ci-token', releaseManifestPublicKey: publicKeyValue },
			body: {
				manifestUrl: incompleteManifest.manifestUrl,
				manifest: incompleteManifest,
				manifestSignature: sign(
					null,
					Buffer.from(sharedCanonicalJson(incompleteManifest)),
					privateKey,
				).toString('base64'),
				publicKeyFingerprint: keyFingerprint(publicKey),
			},
		})

		expect(missingToken.statusCode).toBe(401)
		expect(tampered.statusCode).toBe(400)
		expect(incomplete.statusCode).toBe(400)

		state.candidates.push(candidateRecord(manifest))
		const conflictingManifest = createReleaseManifest({ releaseId: 'different-id' })
		const conflict = await request('/internal/v1/release-candidates/register', state, {
			method: 'POST',
			headers: { authorization: 'Bearer ci-token' },
			env: { releaseCiToken: 'ci-token', releaseManifestPublicKey: publicKeyValue },
			body: {
				manifestUrl: conflictingManifest.manifestUrl,
				manifest: conflictingManifest,
				manifestSignature: sign(
					null,
					Buffer.from(sharedCanonicalJson(conflictingManifest)),
					privateKey,
				).toString('base64'),
				publicKeyFingerprint: keyFingerprint(publicKey),
			},
		})
		expect(conflict.statusCode).toBe(409)
	})

	it('publishes, supersedes, pauses, resumes, and withdraws rollout policies with audit signals', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const published = await request('/admin/v1/release-publish', state, {
			method: 'POST',
			body: {
				candidateId: 'electron-stable-0.1.1',
				title: '问学 0.1.1',
				notes: '稳定性改进',
				percentage: 25,
				mode: 'optional',
				minSupportedVersion: '0.1.0',
			},
		})
		const releaseId = parseBody(published).release.id
		const paused = await request('/admin/v1/release-state', state, {
			method: 'POST',
			body: { releaseId, action: 'pause' },
		})
		const resumed = await request('/admin/v1/release-state', state, {
			method: 'POST',
			body: { releaseId, action: 'resume' },
		})
		const withdrawn = await request('/admin/v1/release-state', state, {
			method: 'POST',
			body: { releaseId, action: 'withdraw' },
		})

		expect(published.statusCode).toBe(201)
		expect(parseBody(paused).release.status).toBe('paused')
		expect(parseBody(resumed).release.status).toBe('active')
		expect(parseBody(withdrawn).release.status).toBe('withdrawn')
		expect(state.releaseRevisions['electron:stable']).toBe(4)
		expect(state.dispatchAudits.map((audit) => audit.action)).toEqual([
			'release.publish',
			'release.pause',
			'release.resume',
			'release.withdraw',
		])
	})

	it('replays a successful release publication with the same idempotency key', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const body = {
			candidateId: 'electron-stable-0.1.1',
			title: '问学 0.1.1',
			notes: '稳定性改进',
			percentage: 25,
			mode: 'optional',
		}
		const first = await request('/admin/v1/release-publish', state, {
			method: 'POST',
			body,
		})
		const replay = await request('/admin/v1/release-publish', state, {
			method: 'POST',
			body,
		})
		const reusedForDifferentInput = await request('/admin/v1/release-publish', state, {
			method: 'POST',
			body: { ...body, notes: '不同的发布内容' },
		})

		expect(first.statusCode).toBe(201)
		expect(replay.statusCode).toBe(201)
		expect(parseBody(replay).release.id).toBe(parseBody(first).release.id)
		expect(reusedForDifferentInput.statusCode).toBe(409)
		expect(state.releases).toHaveLength(1)
		expect(state.dispatchAudits).toHaveLength(1)
		expect(state.releaseRevisions['electron:stable']).toBe(1)
	})

	it('allows an older registered candidate until a newer version has actually been published', async () => {
		const selected = candidateRecord()
		const newerManifest = createReleaseManifest({
			releaseId: 'electron-stable-0.1.2',
			version: '0.1.2',
			manifestUrl: 'https://updates.example.test/electron/stable/0.1.2/manifest.json',
		})
		const newer = candidateRecord(newerManifest)
		const unpublishedState = createState({ candidates: [selected, newer] })
		const publishSelected = await request('/admin/v1/release-publish', unpublishedState, {
			method: 'POST',
			body: {
				candidateId: selected._id,
				title: '问学 0.1.1',
				notes: '先灰度已准备好的版本',
				percentage: 5,
				mode: 'optional',
			},
		})
		expect(publishSelected.statusCode).toBe(201)

		const publishedState = createState({
			candidates: [selected, newer],
			releases: [rolloutRecord({ releaseId: newer._id })],
		})
		const downgrade = await request('/admin/v1/release-publish', publishedState, {
			method: 'POST',
			body: {
				candidateId: selected._id,
				title: '问学 0.1.1',
				notes: '不允许回退已发布版本',
				percentage: 5,
				mode: 'optional',
			},
		})
		expect(downgrade.statusCode).toBe(409)
	})

	it('rejects a concurrent downgrade against the transactional channel version guard', async () => {
		const selected = candidateRecord()
		const state = createState({
			candidates: [selected],
			releaseSignals: {
				'electron:stable': {
					_id: 'electron:stable',
					revision: 8,
					highestVersion: '0.1.2',
					currentRolloutId: 'newer-rollout',
					activeRolloutId: 'newer-rollout',
				},
			},
		})
		const response = await request('/admin/v1/release-publish', state, {
			method: 'POST',
			body: {
				candidateId: selected._id,
				title: '问学 0.1.1',
				notes: '并发发布不得覆盖较高版本',
				percentage: 5,
				mode: 'optional',
			},
		})

		expect(response.statusCode).toBe(409)
		expect(state.releases).toEqual([])
	})

	it('returns 30-day release health with stage counts and handoff failure rate', async () => {
		const state = createState({
			releases: [rolloutRecord()],
			releaseEvents: [
				{
					releaseId: 'electron-stable-0.1.1',
					stage: 'check',
					result: 'success',
					createdAt: '2026-06-10T00:00:00.000Z',
				},
				{
					releaseId: 'electron-stable-0.1.1',
					stage: 'download',
					result: 'success',
					createdAt: '2026-06-20T00:00:00.000Z',
				},
				{
					releaseId: 'electron-stable-0.1.1',
					stage: 'handoff',
					result: 'success',
					createdAt: '2026-06-21T00:00:00.000Z',
				},
				{
					releaseId: 'electron-stable-0.1.1',
					stage: 'handoff',
					result: 'failure',
					createdAt: '2026-06-22T00:00:00.000Z',
				},
				{
					releaseId: 'electron-stable-0.1.1',
					stage: 'handoff',
					result: 'start',
					createdAt: '2026-06-23T00:00:00.000Z',
				},
			],
		})

		const response = await request('/admin/v1/releases', state)

		expect(parseBody(response).releases[0].health).toEqual({
			windowStartedAt: '2026-06-01T09:04:00.000Z',
			updatedAt: '2026-06-23T00:00:00.000Z',
			sampleCount: 4,
			truncated: false,
			stages: {
				check: { success: 1, failure: 0 },
				download: { success: 1, failure: 0 },
				handoff: { success: 1, failure: 1 },
			},
			handoffFailureRate: 0.5,
		})
	})

	it('paginates release health by a stable createdAt and id cursor', async () => {
		const state = createState({
			releases: [rolloutRecord()],
			releaseEvents: Array.from({ length: 1_001 }, (_, index) => ({
				_id: `event-${String(index).padStart(4, '0')}`,
				releaseId: 'electron-stable-0.1.1',
				stage: 'check',
				result: 'success',
				createdAt: '2026-06-20T00:00:00.000Z',
			})),
		})

		const response = await request('/admin/v1/releases', state)

		expect(response.statusCode).toBe(200)
		expect(parseBody(response).releases[0].health).toMatchObject({
			sampleCount: 1_001,
			truncated: false,
			stages: { check: { success: 1_001, failure: 0 } },
		})
	})

	it('truncates release health at two thousand events', async () => {
		const state = createState({
			releases: [rolloutRecord()],
			releaseEvents: Array.from({ length: 2_001 }, (_, index) => ({
				_id: `event-${String(index).padStart(4, '0')}`,
				releaseId: 'electron-stable-0.1.1',
				stage: 'download',
				result: 'success',
				createdAt: '2026-06-20T00:00:00.000Z',
			})),
		})

		const response = await request('/admin/v1/releases', state)

		expect(response.statusCode).toBe(200)
		expect(parseBody(response).releases[0].health).toMatchObject({
			sampleCount: 2_000,
			truncated: true,
			stages: { download: { success: 2_000, failure: 0 } },
		})
	})

	it('does not mark an exact two-thousand-event health sample as truncated', async () => {
		const state = createState({
			releases: [rolloutRecord()],
			releaseEvents: Array.from({ length: 2_000 }, (_, index) => ({
				_id: `event-${String(index).padStart(4, '0')}`,
				releaseId: 'electron-stable-0.1.1',
				stage: 'check',
				result: 'success',
				createdAt: '2026-06-20T00:00:00.000Z',
			})),
		})

		const response = await request('/admin/v1/releases', state)

		expect(response.statusCode).toBe(200)
		expect(parseBody(response).releases[0].health).toMatchObject({
			sampleCount: 2_000,
			truncated: false,
		})
	})

	it('marks active rollouts beyond the bounded health coverage as unavailable', async () => {
		const state = createState({
			releases: Array.from({ length: 7 }, (_, index) =>
				rolloutRecord({
					_id: `rollout-${index + 1}`,
					releaseId: `electron-stable-0.1.${index + 1}`,
				}),
			),
		})

		const response = await request('/admin/v1/releases', state)
		const releases = parseBody(response).releases

		expect(response.statusCode).toBe(200)
		expect(releases.slice(0, 6).every((release: { health?: unknown }) => release.health)).toBe(true)
		expect(releases[6]).toMatchObject({ healthUnavailableReason: 'limit' })
		expect(releases[6]).not.toHaveProperty('health')
	})

	it('does not rescan raw health events for historical withdrawn rollouts', async () => {
		const state = createState({
			releases: [rolloutRecord({ status: 'withdrawn' })],
			releaseEvents: [
				{
					_id: 'historical-event',
					releaseId: 'electron-stable-0.1.1',
					stage: 'handoff',
					result: 'failure',
					createdAt: '2026-06-20T00:00:00.000Z',
				},
			],
		})

		const response = await request('/admin/v1/releases', state)

		expect(response.statusCode).toBe(200)
		expect(parseBody(response).releases[0]).not.toHaveProperty('health')
		expect(parseBody(response).releases[0]).toMatchObject({
			healthUnavailableReason: 'historical',
		})
	})

	it('requires mandatory releases to be 100 percent and blocks non-forward versions', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const mandatory = await request('/admin/v1/release-publish', state, {
			method: 'POST',
			body: {
				candidateId: 'electron-stable-0.1.1',
				title: '问学 0.1.1',
				notes: '必须更新',
				percentage: 25,
				mode: 'mandatory',
			},
		})
		const invalidMinimum = await request('/admin/v1/release-publish', state, {
			method: 'POST',
			body: {
				candidateId: 'electron-stable-0.1.1',
				title: '问学 0.1.1',
				notes: '必须更新',
				percentage: 100,
				mode: 'mandatory',
				minSupportedVersion: '0.1.1',
			},
		})

		expect(mandatory.statusCode).toBe(400)
		expect(invalidMinimum.statusCode).toBe(400)
	})

	it('returns only an active, newer policy and platform-specific artifacts', async () => {
		const state = createState({
			candidates: [candidateRecord()],
			releases: [rolloutRecord()],
		})
		const available = await request('/v1/client/update-policy', state, {
			query: {
				runtime: 'electron',
				platform: 'darwin',
				arch: 'arm64',
				channel: 'stable',
				version: '0.1.0',
				installIdHash: 'a'.repeat(64),
			},
			headers: { 'x-forwarded-for': 'spoofed, 203.0.113.10' },
		})
		const current = await request('/v1/client/update-policy', state, {
			query: {
				runtime: 'electron',
				platform: 'darwin',
				arch: 'arm64',
				channel: 'stable',
				version: '0.1.1',
				installIdHash: 'a'.repeat(64),
			},
		})

		expect(available.statusCode).toBe(200)
		expect(parseBody(available).policy).toMatchObject({
			releaseId: 'electron-stable-0.1.1',
			version: '0.1.1',
			percentage: 25,
			distribution: { mode: 'manual-unsigned' },
			validUntil: '2026-07-02T09:04:00.000Z',
		})
		expect(parseBody(available).policy.artifacts).toEqual([
			expect.objectContaining({ platform: 'darwin', arch: 'arm64', kind: 'dmg' }),
		])
		expect(parseBody(current)).toEqual({ policy: null })
	})

	it('applies mandatory mode only below minSupportedVersion and keeps 24-hour validity', async () => {
		const state = createState({
			candidates: [candidateRecord()],
			releases: [
				rolloutRecord({ mode: 'mandatory', percentage: 100, minSupportedVersion: '0.1.0' }),
			],
		})
		const baseQuery = {
			runtime: 'electron',
			platform: 'darwin',
			arch: 'arm64',
			channel: 'stable',
			installIdHash: 'b'.repeat(64),
		}
		const belowThreshold = await request('/v1/client/update-policy', state, {
			query: { ...baseQuery, version: '0.0.9' },
		})
		const atThreshold = await request('/v1/client/update-policy', state, {
			query: { ...baseQuery, version: '0.1.0' },
		})

		expect(parseBody(belowThreshold).policy).toMatchObject({
			mode: 'mandatory',
			checkedAt: '2026-07-01T09:04:00.000Z',
			validUntil: '2026-07-02T09:04:00.000Z',
		})
		expect(parseBody(atThreshold).policy.mode).toBe('optional')
	})

	it('accepts only anonymous update event fields and assigns 30-day retention', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const accepted = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: {
				releaseId: 'electron-stable-0.1.1',
				installIdHash: 'a'.repeat(64),
				eventToken: releaseEventToken('a'.repeat(64)),
				runtime: 'electron',
				platform: 'darwin',
				arch: 'arm64',
				fromVersion: '0.1.0',
				stage: 'download',
				result: 'success',
			},
		})
		const rejected = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: {
				releaseId: 'electron-stable-0.1.1',
				installIdHash: 'a'.repeat(64),
				eventToken: releaseEventToken('a'.repeat(64)),
				runtime: 'electron',
				platform: 'darwin',
				arch: 'arm64',
				fromVersion: '0.1.0',
				stage: 'download',
				result: 'failure',
				uid: USER_ID,
			},
		})

		expect(accepted.statusCode).toBe(202)
		expect(state.releaseEvents[0]).toMatchObject({
			installIdHash: 'a'.repeat(64),
			expiresAt: '2026-07-31T09:04:00.000Z',
		})
		expect(rejected.statusCode).toBe(400)
		expect(state.releaseEvents).toHaveLength(1)
		expect(state.releaseCleanupCalls).toBe(1)
	})

	it('accepts an update event when opportunistic retention cleanup fails', async () => {
		const state = createState({
			candidates: [candidateRecord()],
			releaseCleanupError: new Error('temporary cleanup failure'),
		})
		const response = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: {
				releaseId: 'electron-stable-0.1.1',
				installIdHash: 'c'.repeat(64),
				eventToken: releaseEventToken('c'.repeat(64)),
				runtime: 'electron',
				platform: 'darwin',
				arch: 'arm64',
				fromVersion: '0.1.0',
				stage: 'handoff',
				result: 'success',
			},
		})

		expect(response.statusCode).toBe(202)
		expect(state.releaseEvents).toHaveLength(1)
		expect(state.releaseCleanupCalls).toBe(1)
	})

	it('rejects missing, tampered, or target-mismatched update event tokens', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const installIdHash = 'e'.repeat(64)
		const validBody = {
			releaseId: 'electron-stable-0.1.1',
			installIdHash,
			eventToken: releaseEventToken(installIdHash),
			runtime: 'electron',
			platform: 'darwin',
			arch: 'arm64',
			fromVersion: '0.1.0',
			stage: 'download',
			result: 'success',
		}
		const missing = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: { ...validBody, eventToken: undefined },
		})
		const tamperedToken = `${validBody.eventToken.slice(0, -1)}${
			validBody.eventToken.endsWith('a') ? 'b' : 'a'
		}`
		const tampered = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: { ...validBody, eventToken: tamperedToken },
		})
		const mismatched = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: { ...validBody, eventToken: releaseEventToken('f'.repeat(64)) },
		})

		expect(missing.statusCode).toBe(400)
		expect(tampered.statusCode).toBe(401)
		expect(mismatched.statusCode).toBe(401)
		expect(state.releaseEvents).toEqual([])
	})

	it('deduplicates conflicting final outcomes for one handoff and stage', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const installIdHash = '9'.repeat(64)
		const body = {
			releaseId: 'electron-stable-0.1.1',
			installIdHash,
			eventToken: releaseEventToken(installIdHash),
			runtime: 'electron',
			platform: 'darwin',
			arch: 'arm64',
			fromVersion: '0.1.0',
			stage: 'handoff',
			result: 'success',
		}
		const first = await request('/v1/client/update-events', state, {
			method: 'POST',
			body,
		})
		const conflictingDuplicate = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: { ...body, result: 'failure', errorCode: 'INSTALLER_OPEN_FAILED' },
		})

		expect(first.statusCode).toBe(202)
		expect(conflictingDuplicate.statusCode).toBe(202)
		expect(state.releaseEvents).toHaveLength(1)
		expect(state.releaseEvents[0]).toMatchObject({ stage: 'handoff', result: 'success' })
	})

	it('enforces the shared daily release event quota without charging exact duplicates', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const installIdHash = '7'.repeat(64)
		const eventToken = releaseEventToken(installIdHash)
		const body = {
			releaseId: 'electron-stable-0.1.1',
			installIdHash,
			eventToken,
			runtime: 'electron',
			platform: 'darwin',
			arch: 'arm64',
			fromVersion: '0.1.0',
			stage: 'check',
			result: 'success',
		}
		const first = await request('/v1/client/update-events', state, {
			method: 'POST',
			body,
			env: { releaseEventDailyQuota: 1 },
		})
		const duplicate = await request('/v1/client/update-events', state, {
			method: 'POST',
			body,
			env: { releaseEventDailyQuota: 1 },
		})
		const overQuota = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: { ...body, stage: 'download' },
			env: { releaseEventDailyQuota: 1 },
		})

		expect(first.statusCode).toBe(202)
		expect(duplicate.statusCode).toBe(202)
		expect(overQuota.statusCode).toBe(429)
		expect(Number(overQuota.headers['retry-after'])).toBeGreaterThan(0)
		expect(state.releaseEvents).toHaveLength(1)
		expect(Object.values(state.releaseEventQuotaCounts)).toEqual([1])
		expect(Object.keys(state.releaseEventQuotaCounts)).toEqual(['release-event-quota:2026-07-01:0'])
	})

	it('uses another quota shard when the deterministic first shard is full', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const installHashes = Array.from({ length: 16 }, (_, index) =>
			index.toString(16).padStart(64, '0'),
		)
		const firstInstallIdHash = installHashes[0]
		const firstShard = releaseEventQuotaShard(firstInstallIdHash, 2)
		const secondInstallIdHash = installHashes.find(
			(value) => value !== firstInstallIdHash && releaseEventQuotaShard(value, 2) === firstShard,
		)
		if (!secondInstallIdHash) throw new Error('Expected a deterministic same-shard fixture')
		const submit = (installIdHash: string) =>
			request('/v1/client/update-events', state, {
				method: 'POST',
				env: { releaseEventDailyQuota: 2 },
				body: {
					releaseId: 'electron-stable-0.1.1',
					installIdHash,
					eventToken: releaseEventToken(installIdHash),
					runtime: 'electron',
					platform: 'darwin',
					arch: 'arm64',
					fromVersion: '0.1.0',
					stage: 'check',
					result: 'success',
				},
			})

		const first = await submit(firstInstallIdHash)
		const overflow = await submit(secondInstallIdHash)

		expect(first.statusCode).toBe(202)
		expect(overflow.statusCode).toBe(202)
		expect(state.releaseEvents).toHaveLength(2)
		expect(Object.values(state.releaseEventQuotaCounts).sort()).toEqual([1, 1])
	})

	it('upgrades a failed final outcome after a successful retry', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const installIdHash = '8'.repeat(64)
		const body = {
			releaseId: 'electron-stable-0.1.1',
			installIdHash,
			eventToken: releaseEventToken(installIdHash),
			runtime: 'electron',
			platform: 'darwin',
			arch: 'arm64',
			fromVersion: '0.1.0',
			stage: 'handoff',
			result: 'failure',
			errorCode: 'INSTALLER_OPEN_FAILED',
		}
		await request('/v1/client/update-events', state, { method: 'POST', body })
		await request('/v1/client/update-events', state, {
			method: 'POST',
			body: { ...body, result: 'success', errorCode: undefined },
		})

		expect(state.releaseEvents).toHaveLength(1)
		expect(state.releaseEvents[0]).toMatchObject({ stage: 'handoff', result: 'success' })
		expect(state.releaseEvents[0].errorCode).toBeUndefined()
	})

	it('rejects update event stage and result combinations outside the desktop contract', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const response = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: {
				releaseId: 'electron-stable-0.1.1',
				installIdHash: 'd'.repeat(64),
				eventToken: releaseEventToken('d'.repeat(64)),
				runtime: 'electron',
				platform: 'darwin',
				arch: 'arm64',
				fromVersion: '0.1.0',
				stage: 'check',
				result: 'start',
			},
		})
		const legacyInstall = await request('/v1/client/update-events', state, {
			method: 'POST',
			body: {
				releaseId: 'electron-stable-0.1.1',
				installIdHash: 'd'.repeat(64),
				eventToken: releaseEventToken('d'.repeat(64)),
				runtime: 'electron',
				platform: 'darwin',
				arch: 'arm64',
				fromVersion: '0.1.0',
				stage: 'install',
				result: 'success',
			},
		})

		expect(response.statusCode).toBe(400)
		expect(legacyInstall.statusCode).toBe(400)
		expect(state.releaseEvents).toEqual([])
	})

	it('rate limits anonymous events per trusted ingress hop with Retry-After', async () => {
		const state = createState({ candidates: [candidateRecord()] })
		const eventBody = {
			releaseId: 'electron-stable-0.1.1',
			installIdHash: 'b'.repeat(64),
			eventToken: releaseEventToken('b'.repeat(64)),
			runtime: 'electron',
			platform: 'darwin',
			arch: 'arm64',
			fromVersion: '0.1.0',
			stage: 'download',
			result: 'success',
		}
		for (let index = 0; index < 60; index += 1) {
			const accepted = await request('/v1/client/update-events', state, {
				method: 'POST',
				headers: { 'x-forwarded-for': `spoofed-${index}, 203.0.113.20` },
				body: {
					...eventBody,
					installIdHash: index.toString(16).padStart(64, '0'),
					eventToken: releaseEventToken(index.toString(16).padStart(64, '0')),
				},
			})
			expect(accepted.statusCode).toBe(202)
		}
		const limited = await request('/v1/client/update-events', state, {
			method: 'POST',
			headers: { 'x-forwarded-for': 'another-spoof, 203.0.113.20' },
			body: eventBody,
		})

		expect(limited.statusCode).toBe(429)
		expect(limited.headers['retry-after']).toBe('60')
		expect(state.releaseEvents).toHaveLength(60)
	})
})

describe('Dispatch contract compatibility', () => {
	it('normalizes accepted announcement and release publish fixtures like the shared package', async () => {
		const announcementInput = {
			importance: 'normal',
			title: '  版本提醒  ',
			body: '  请及时保存工作。  ',
			audience: { platforms: ['darwin', 'darwin'], userIds: [USER_ID] },
		}
		const sharedAnnouncement = sharedValidateAnnouncementInput(announcementInput, {
			now: 1782896640000,
		})
		const announcementResponse = await request('/admin/v1/announcements', createState(), {
			method: 'POST',
			body: announcementInput,
		})
		expect(sharedAnnouncement.ok).toBe(true)
		if (!sharedAnnouncement.ok) throw new Error('Shared announcement fixture must be valid')
		expect(parseBody(announcementResponse).announcement).toMatchObject(sharedAnnouncement.value)

		const publishInput = {
			candidateId: 'electron-stable-0.1.1',
			title: '  问学 0.1.1  ',
			notes: '  稳定性改进  ',
			percentage: 25,
			mode: 'optional',
			minSupportedVersion: '0.1.0',
		}
		const sharedPublish = sharedValidateReleasePublishInput(publishInput)
		const publishResponse = await request(
			'/admin/v1/release-publish',
			createState({ candidates: [candidateRecord()] }),
			{ method: 'POST', body: publishInput },
		)
		expect(sharedPublish.ok).toBe(true)
		if (!sharedPublish.ok) throw new Error('Shared publish fixture must be valid')
		expect(parseBody(publishResponse).release).toMatchObject({
			title: sharedPublish.value.title,
			notes: sharedPublish.value.notes,
			percentage: sharedPublish.value.percentage,
			mode: sharedPublish.value.mode,
			minSupportedVersion: sharedPublish.value.minSupportedVersion,
		})
	})

	it('uses the same semantic-version ordering fixtures as the shared package', () => {
		const versions = [
			['1.0.0', '1.0.0', 0],
			['1.0.1', '1.0.0', 1],
			['1.0.0-beta.2', '1.0.0-beta.11', -1],
			['1.0.0', '1.0.0-rc.1', 1],
		] as const
		for (const [left, right, expected] of versions) {
			expect(compareSemver(left, right)).toBe(expected)
			expect(compareSemver(left, right)).toBe(sharedCompareSemver(left, right))
		}
	})

	it('uses the same three-dimensional audience AND semantics as the shared package', () => {
		const context = { userId: USER_ID, platform: 'darwin' as const, version: '0.1.1' }
		const audiences = [
			{},
			{ platforms: ['darwin' as const] },
			{ platforms: ['win32' as const] },
			{ minVersion: '0.1.1', maxVersion: '0.1.1', userIds: [USER_ID] },
			{ minVersion: '0.1.2', userIds: [USER_ID] },
		]
		for (const audience of audiences) {
			expect(matchesAnnouncementAudience(context, audience)).toBe(
				sharedMatchesAudience(context, audience),
			)
		}
	})
})
