import {
	createHash,
	createHmac,
	createPublicKey,
	randomUUID,
	timingSafeEqual,
	verify,
} from 'node:crypto'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_USER_LIMIT = 500
const DEFAULT_ANNOUNCEMENT_LIMIT = 200
const ANNOUNCEMENT_PAGE_LIMIT = 1_000
const MAX_ACTIVE_ANNOUNCEMENTS = 10_000
const DEFAULT_RELEASE_LIMIT = 200
const RELEASE_EVENT_PAGE_LIMIT = 1_000
const MAX_RELEASE_EVENT_HEALTH_EVENTS = 2_000
const MAX_RELEASE_HEALTH_ROLLOUTS = 6
const ANNOUNCEMENT_DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const ANNOUNCEMENT_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
const ANNOUNCEMENT_RECEIPT_EXPIRY_BUFFER_MS = 24 * 60 * 60 * 1000
const ANNOUNCEMENT_RECEIPT_BATCH_SIZE = 50
const ANNOUNCEMENT_RECEIPT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const UPDATE_POLICY_FRESHNESS_MS = 24 * 60 * 60 * 1000
const UPDATE_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const UPDATE_EVENT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const UPDATE_EVENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_RELEASE_EVENT_DAILY_QUOTA = 100_000
const MAX_RELEASE_EVENT_DAILY_QUOTA = 1_000_000
const RELEASE_EVENT_QUOTA_SHARDS = 32
const SENSITIVE_PATTERN = /prompt|content|api[_-]?key|authorization|bearer|raw.?token/i
const EVENT_SENSITIVE_PATTERN = /uid|user|prompt|content|cookie|session|authorization|bearer|token/i
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const ALLOWED_PERCENTAGES = new Set([1, 5, 25, 50, 100])
const PUBLIC_RATE_WINDOW_MS = 60_000
const PUBLIC_RATE_MAX_KEYS = 2048
const PUBLIC_RATE_LIMITS = {
	// Release revisions are intentionally fanned out to every online desktop. Shared
	// campus/office NATs therefore need a much wider read allowance than telemetry.
	updatePolicy: { perIp: 5_000, global: 50_000 },
	updateEvents: { perIp: 60, global: 2_000 },
}
/** @type {Record<UpdateEventStage, ReadonlySet<string>>} */
const UPDATE_EVENT_RESULTS = {
	check: new Set(['success', 'failure']),
	download: new Set(['start', 'success', 'failure']),
	handoff: new Set(['start', 'success', 'failure']),
}
const REQUIRED_RELEASE_TEST_EVIDENCE = new Set([
	'quality',
	'manual-installer-integrity',
	'manifest-tamper-rejection',
])

/** @typedef {'normal' | 'important'} AnnouncementImportance */
/** @typedef {'darwin' | 'win32'} DesktopPlatform */
/** @typedef {'arm64' | 'x64'} DesktopArchitecture */
/** @typedef {'electron' | 'chromium'} DesktopRuntime */
/** @typedef {'dev' | 'beta' | 'stable'} ReleaseChannel */
/** @typedef {'optional' | 'mandatory'} UpdateMode */
/** @typedef {'active' | 'paused' | 'withdrawn' | 'superseded'} ReleaseStatus */
/** @typedef {'check' | 'download' | 'handoff'} UpdateEventStage */
/** @typedef {'start' | 'success' | 'failure'} UpdateEventResult */
/** @typedef {{ platforms?: DesktopPlatform[], minVersion?: string, maxVersion?: string, userIds?: string[] }} AnnouncementAudience */
/** @typedef {{ importance: AnnouncementImportance, title: string, body: string, detailUrl?: string, audience: AnnouncementAudience, expiresAt: string }} NormalizedAnnouncementInput */
/** @typedef {{ _id: string, schemaVersion: number, status: 'published' | 'withdrawn', importance: AnnouncementImportance, title: string, body: string, detailUrl?: string, audience: AnnouncementAudience, publishedAt: string, expiresAt: string, publishedBy: string, withdrawnAt?: string, withdrawnBy?: string }} AnnouncementRecord */
/** @typedef {{ platform: DesktopPlatform, arch: DesktopArchitecture, kind: string, fileName: string, url: string, sha512: string, size: number }} ReleaseArtifact */
/** @typedef {{ mode: 'manual-unsigned' | 'platform-unsigned' }} ReleaseDistribution */
/** @typedef {{ name: string, status: 'passed', url: string }} ReleaseTestEvidence */
/** @typedef {{ _id: string, schemaVersion: number, runtime: DesktopRuntime, version: string, channel: ReleaseChannel, createdAt: string, manifestUrl: string, manifestSignature: string, artifacts: ReleaseArtifact[], sourceCoordinates: Record<string, unknown>, distribution: ReleaseDistribution, tests: ReleaseTestEvidence[], status: 'verified', registeredAt: string }} ReleaseCandidateRecord */
/** @typedef {{ _id: string, runtime: DesktopRuntime, channel: ReleaseChannel, releaseId: string, status: ReleaseStatus, percentage: number, mode: UpdateMode, minSupportedVersion?: string, title: string, notes: string, publishedAt: string, publishedBy: string, updatedAt: string, updatedBy: string }} ReleaseRolloutRecord */
/** @typedef {{ count: number, resetAt: number }} PublicRateEntry */
/** @type {Map<string, PublicRateEntry>} */
const publicRateState = new Map()
let nextReleaseEventCleanupAt = 0
let nextAnnouncementReceiptCleanupAt = 0

/** @typedef {'admin' | 'viewer'} AdminRole */
/** @typedef {'active' | 'disabled'} AdminUserStatus */
/** @typedef {'active' | 'disabled'} UserAccountStatus */
/** @typedef {{ uid: string }} AdminIdentity */
/** @typedef {{ _id: string, role: AdminRole, status: AdminUserStatus, displayName?: string }} AdminUser */
/** @typedef {{ _id: string, uid: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number, latencyMs?: number, ts: number, createdAt?: string }} UsageRecord */
/** @typedef {{ _id: string, uid: string, active: boolean, status: UserAccountStatus, email?: string, nickname?: string, userType?: string, firstSeenAt?: string, lastSeenAt?: string, createdAt?: string, updatedAt?: string, note?: string }} UserAccount */
/** @typedef {{ userId: string, status: UserAccountStatus, email: string, nickname: string, userType: string, firstSeenAt: string, lastSeenAt: string, createdAt: string, updatedAt: string, note?: string, inputTokens: number, outputTokens: number, totalTokens: number }} UserAccountView */
/** @typedef {{ totalInputTokens: number, totalOutputTokens: number, totalTokens: number, byDay: UsageBucket[], byModel: UsageBucket[], byUser: UsageBucket[], recent: UsageRecordView[], userStatus: { active: number, disabled: number, total: number } }} AdminUsageSummary */
/** @typedef {{ key: string, label: string, inputTokens: number, outputTokens: number, totalTokens: number }} UsageBucket */
/** @typedef {{ id: string, ts: number, userId: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number, latencyMs: number }} UsageRecordView */
/** @typedef {{
 * getAdminUser(uid: string): Promise<unknown | null>,
 * listUsageRecords(filter: { status?: UserAccountStatus, from?: number, to?: number, limit?: number, userId?: string, model?: string }): Promise<unknown[]>,
 * listAuthUsers(): Promise<UserAccount[]>,
 * getAuthUser(userId: string, timeoutMs?: number): Promise<UserAccount | null>,
 * updateAuthUserStatus(userId: string, active: boolean): Promise<void>,
 * listUserAccounts(filter: { status?: UserAccountStatus, q?: string, limit?: number }): Promise<unknown[]>,
 * getUserAccount(userId: string): Promise<unknown | null>,
 * updateUserAccount(userId: string, patch: Partial<Pick<UserAccount, 'updatedAt' | 'note'>>): Promise<unknown | null>,
 * createUserPermissionAudit(record: Record<string, unknown>): Promise<void>,
 * listAnnouncements(filter: { status?: string, expiresAfter?: string, direction?: 'asc' | 'desc', limit?: number, skip?: number }): Promise<unknown[]>,
 * getAnnouncement(id: string): Promise<unknown | null>,
 * createAnnouncement(record: Record<string, unknown>): Promise<void>,
 * updateAnnouncement(id: string, patch: Record<string, unknown>): Promise<unknown | null>,
 * listAnnouncementReceipts(uid: string, announcementIds: string[]): Promise<unknown[]>,
 * commitAnnouncementAcknowledgement(record: Record<string, unknown>): Promise<{ created: boolean, record: unknown }>,
 * cleanupExpiredAnnouncementReceipts(expiredAt: string): Promise<number>,
 * commitAnnouncementPublication(record: Record<string, unknown>, audit: Record<string, unknown>): Promise<{ created: boolean, record: unknown }>,
 * commitAnnouncementWithdrawal(record: Record<string, unknown>, audit: Record<string, unknown>): Promise<{ outcome: string, record: unknown | null }>,
 * listReleaseCandidates(filter: { runtime?: string, channel?: string, limit?: number }): Promise<unknown[]>,
 * getReleaseCandidate(id: string): Promise<unknown | null>,
 * findReleaseCandidate(runtime: string, channel: string, version: string): Promise<unknown | null>,
 * createReleaseCandidateIfAbsent(record: Record<string, unknown>): Promise<boolean>,
 * listReleaseRollouts(filter: { runtime?: string, channel?: string, limit?: number }): Promise<unknown[]>,
 * getReleaseRollout(id: string): Promise<unknown | null>,
 * getReleaseActiveSlot(runtime: string, channel: string): Promise<unknown | null>,
 * createReleaseRollout(record: Record<string, unknown>): Promise<void>,
 * updateReleaseRollout(id: string, patch: Record<string, unknown>): Promise<unknown | null>,
 * incrementReleaseSignal(runtime: string, channel: string, updatedAt: string): Promise<unknown>,
 * commitReleasePublication(record: Record<string, unknown>, audit: Record<string, unknown>, legacyRolloutIds?: string[], versionGuard?: { candidateVersion: string, highestPublishedVersion?: string }): Promise<{ created: boolean, record: unknown }>,
 * commitReleaseState(record: Record<string, unknown>, audit: Record<string, unknown>, expectedStatus: string): Promise<{ outcome: string, record: unknown | null }>,
 * createReleaseEventWithinQuota(record: Record<string, unknown>, quota: { id: string, limit: number, expiresAt: string }): Promise<{ outcome: 'created' | 'updated' | 'duplicate' | 'quota-exceeded' }>,
 * listReleaseEvents(filter: { releaseId?: string, createdAfter?: string, createdBefore?: string, before?: { createdAt: string, id: string }, limit?: number }): Promise<unknown[]>,
 * cleanupExpiredReleaseEvents(expiredAt: string): Promise<number>,
 * createDispatchAudit(record: Record<string, unknown>): Promise<void>,
 * }} AdminStore */
/** @typedef {{ cloudbaseEnvId: string, cloudbaseClientId: string, cloudbaseAdminApiKey?: string, releaseCiToken?: string, releaseManifestPublicKey?: string, releaseEventTokenSecret?: string, releaseEventDailyQuota?: number, allowedOrigins?: string[], requestTimeoutMs?: number }} AdminApiEnv */

export class AdminApiError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 * @param {Record<string, string>} [headers]
	 */
	constructor(message, status = 500, headers = {}) {
		super(message)
		this.name = 'AdminApiError'
		this.status = status
		this.headers = headers
	}
}

/**
 * @param {{
 *   method: string,
 *   path: string,
 *   query?: Record<string, string | undefined>,
 *   headers: Headers | Record<string, string | string[] | undefined>,
 *   rawBody?: string,
 *   env: AdminApiEnv,
 *   store: AdminStore,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} input
 */
export async function handleAdminRequest(input) {
	const corsHeaders = buildCorsHeaders(input.headers, input.env.allowedOrigins ?? ['*'])
	if (input.method.toUpperCase() === 'OPTIONS') {
		return jsonResponse(null, 204, corsHeaders)
	}

	try {
		const method = input.method.toUpperCase()
		const path = normalizePath(input.path).replace(/^\/api(?=\/)/, '')
		const now = input.now ?? Date.now

		if (path === '/internal/v1/release-candidates/register' && method === 'POST') {
			authorizeCiRequest(input.headers, input.env.releaseCiToken)
			const candidate = await registerReleaseCandidate({
				rawBody: input.rawBody ?? '{}',
				env: input.env,
				store: input.store,
				now,
			})
			return jsonResponse({ candidate: toReleaseCandidateView(candidate) }, 200, corsHeaders)
		}

		if (path === '/v1/client/announcements/pending' && method === 'GET') {
			const identity = await resolveCloudBaseClientIdentity({
				headers: input.headers,
				env: input.env,
				fetchImpl: input.fetchImpl,
				store: input.store,
			})
			const announcements = await pendingAnnouncements({
				identity,
				query: input.query ?? {},
				store: input.store,
				now,
			})
			return jsonResponse({ announcements }, 200, corsHeaders)
		}

		if (path === '/v1/client/announcement-ack' && method === 'POST') {
			const identity = await resolveCloudBaseClientIdentity({
				headers: input.headers,
				env: input.env,
				fetchImpl: input.fetchImpl,
				store: input.store,
			})
			const receipt = await acknowledgeAnnouncement({
				identity,
				rawBody: input.rawBody ?? '{}',
				store: input.store,
				now,
			})
			return jsonResponse({ receipt }, 200, corsHeaders)
		}

		if (path === '/v1/client/update-policy' && method === 'GET') {
			consumePublicRateLimit('updatePolicy', input.headers, now())
			const policy = await buildClientUpdatePolicy({
				query: input.query ?? {},
				store: input.store,
				eventTokenSecret: input.env.releaseEventTokenSecret,
				now,
			})
			return jsonResponse({ policy }, 200, corsHeaders)
		}

		if (path === '/v1/client/update-events' && method === 'POST') {
			consumePublicRateLimit('updateEvents', input.headers, now())
			const event = await recordReleaseEvent({
				rawBody: input.rawBody ?? '{}',
				store: input.store,
				eventTokenSecret: input.env.releaseEventTokenSecret,
				eventDailyQuota: input.env.releaseEventDailyQuota,
				now,
			})
			return jsonResponse({ accepted: true, eventId: event._id }, 202, corsHeaders)
		}

		const admin = await authorizeAdminRequest({
			headers: input.headers,
			env: input.env,
			store: input.store,
			fetchImpl: input.fetchImpl,
		})

		if (path === '/admin/v1/me' && method === 'GET') {
			return jsonResponse(
				{
					uid: admin._id,
					role: admin.role,
					displayName: admin.displayName,
				},
				200,
				corsHeaders,
			)
		}

		if (path === '/admin/v1/usage/summary' && method === 'GET') {
			const filter = readUsageFilter(input.query ?? {})
			const records = await input.store.listUsageRecords(filter)
			const users = await input.store.listAuthUsers()
			return jsonResponse(buildAdminUsageSummary(records, users, filter), 200, corsHeaders)
		}

		if (path === '/admin/v1/users' && method === 'GET') {
			const status = readUserStatus(input.query?.status)
			const [authUsers, notes] = await Promise.all([
				input.store.listAuthUsers(),
				input.store.listUserAccounts({}),
			])
			const q = readQueryText(input.query?.q)?.toLocaleLowerCase()
			const noteByUid = new Map()
			for (const note of notes.filter(isRecord)) {
				const uid = readString(note.uid) ?? readString(note._id)
				if (uid && (!noteByUid.has(uid) || note._id === uid)) noteByUid.set(uid, note)
			}
			const users = authUsers
				.filter(
					(user) =>
						(!status || user.status === status) &&
						(!q ||
							[user.uid, user.email, user.nickname].some((text) =>
								text?.toLocaleLowerCase().includes(q),
							)),
				)
				.slice(
					0,
					input.query?.limit === undefined
						? undefined
						: readPositiveInteger(input.query.limit, DEFAULT_USER_LIMIT),
				)
				.map((user) => mergeUserMetadata(user, noteByUid.get(user.uid)))
			const records = await input.store.listUsageRecords({})
			const usageByUser = aggregateUsageByUser(records)
			return jsonResponse(
				{
					users: users.flatMap((user) => {
						const normalized = normalizeUserAccount(user)
						return normalized
							? [toUserAccountView(normalized, usageByUser.get(normalized.uid))]
							: []
					}),
				},
				200,
				corsHeaders,
			)
		}

		if (path === '/admin/v1/users/status' && method === 'PATCH') {
			requireAdminRole(admin)
			const payload = parseUserStatusPatch(input.rawBody ?? '{}')
			const authUser = await input.store.getAuthUser(payload.userId)
			if (!authUser) throw new AdminApiError('User account not found', 404)
			const noteRecord = await input.store.getUserAccount(payload.userId)
			const current = mergeUserMetadata(authUser, noteRecord)
			const active = payload.patch.active ?? current.active
			if (
				payload.patch.active === false &&
				(current.uid === admin._id || current.userType === 'internalUser')
			) {
				throw new AdminApiError(
					'Internal administrators and your own account cannot be disabled here',
					403,
				)
			}
			const updatedAt = new Date(now()).toISOString()
			const user = {
				...current,
				updatedAt,
				active,
				status: /** @type {UserAccountStatus} */ (active ? 'active' : 'disabled'),
				note: payload.patch.note ?? current.note,
			}
			const usage = aggregateUsageByUser(
				await input.store.listUsageRecords({ userId: payload.userId }),
			).get(payload.userId)
			const operationId = randomUUID()
			const audit = {
				operationId,
				userId: payload.userId,
				adminUid: admin._id,
				before: toUserPermissionSnapshot(current),
				after: toUserPermissionSnapshot(user),
				reason: payload.reason,
				createdAt: updatedAt,
			}
			const updatesStatus = payload.patch.active !== undefined
			if (updatesStatus) {
				await input.store.createUserPermissionAudit({
					...audit,
					_id: randomUUID(),
					outcome: 'requested',
				})
			}
			try {
				if (updatesStatus) await input.store.updateAuthUserStatus(payload.userId, active)
				if (payload.patch.note !== undefined) {
					await input.store.updateUserAccount(payload.userId, {
						note: payload.patch.note,
						updatedAt,
					})
				}
				await input.store.createUserPermissionAudit({
					...audit,
					_id: randomUUID(),
					outcome: 'applied',
				})
			} catch (error) {
				if (updatesStatus) {
					await input.store.createUserPermissionAudit({
						...audit,
						_id: randomUUID(),
						outcome: 'unconfirmed',
					})
				}
				throw error
			}
			return jsonResponse(
				{
					user: toUserAccountView(user, usage),
				},
				200,
				corsHeaders,
			)
		}

		if (path === '/admin/v1/announcements' && method === 'GET') {
			const announcements = await input.store.listAnnouncements({
				limit: readPositiveInteger(input.query?.limit, DEFAULT_ANNOUNCEMENT_LIMIT),
			})
			return jsonResponse(
				{
					announcements: announcements.flatMap((value) => {
						const announcement = normalizeAnnouncement(value)
						return announcement ? [toAnnouncementAdminView(announcement)] : []
					}),
				},
				200,
				corsHeaders,
			)
		}

		if (path === '/admin/v1/announcements' && method === 'POST') {
			requireAdminRole(admin)
			const announcement = await publishAnnouncement({
				admin,
				idempotencyKey: readIdempotencyKey(input.headers),
				rawBody: input.rawBody ?? '{}',
				store: input.store,
				now,
			})
			return jsonResponse({ announcement: toAnnouncementAdminView(announcement) }, 201, corsHeaders)
		}

		if (path === '/admin/v1/announcement-withdraw' && method === 'POST') {
			requireAdminRole(admin)
			const announcement = await withdrawAnnouncement({
				admin,
				rawBody: input.rawBody ?? '{}',
				store: input.store,
				now,
			})
			return jsonResponse({ announcement: toAnnouncementAdminView(announcement) }, 200, corsHeaders)
		}

		if (path === '/admin/v1/release-candidates' && method === 'GET') {
			const filter = readReleaseListFilter(input.query ?? {})
			const candidates = await input.store.listReleaseCandidates({
				...filter,
				limit: DEFAULT_RELEASE_LIMIT,
			})
			return jsonResponse(
				{
					candidates: candidates.flatMap((value) => {
						const candidate = normalizeReleaseCandidateRecord(value)
						return candidate?.status === 'verified' ? [toReleaseCandidateView(candidate)] : []
					}),
				},
				200,
				corsHeaders,
			)
		}

		if (path === '/admin/v1/releases' && method === 'GET') {
			const checkedAtMs = now()
			const windowStartedAt = new Date(checkedAtMs - UPDATE_EVENT_RETENTION_MS).toISOString()
			const windowEndedAt = new Date(checkedAtMs).toISOString()
			const releases = await input.store.listReleaseRollouts({ limit: DEFAULT_RELEASE_LIMIT })
			const normalizedReleases = releases.flatMap((value) => {
				const release = normalizeReleaseRollout(value)
				return release ? [release] : []
			})
			const healthTargets = normalizedReleases
				.filter((release) => release.status === 'active' || release.status === 'paused')
				.slice(0, MAX_RELEASE_HEALTH_ROLLOUTS)
			const health = await mapWithConcurrency(healthTargets, 5, async (release) => {
				const { events, truncated } = await listReleaseHealthEvents(
					input.store,
					release.releaseId,
					windowStartedAt,
					windowEndedAt,
				)
				return buildReleaseHealth(release.releaseId, events, windowStartedAt, truncated)
			})
			const healthByRolloutId = new Map(
				healthTargets.map((release, index) => [release._id, health[index]]),
			)
			return jsonResponse(
				{
					releases: normalizedReleases.map((release) => ({
						...toReleaseRolloutView(release),
						...(healthByRolloutId.has(release._id)
							? { health: healthByRolloutId.get(release._id) }
							: {
									healthUnavailableReason:
										release.status === 'active' || release.status === 'paused'
											? 'limit'
											: 'historical',
								}),
					})),
				},
				200,
				corsHeaders,
			)
		}

		if (path === '/admin/v1/release-publish' && method === 'POST') {
			requireAdminRole(admin)
			const release = await publishRelease({
				admin,
				idempotencyKey: readIdempotencyKey(input.headers),
				rawBody: input.rawBody ?? '{}',
				store: input.store,
				now,
			})
			return jsonResponse({ release: toReleaseRolloutView(release) }, 201, corsHeaders)
		}

		if (path === '/admin/v1/release-state' && method === 'POST') {
			requireAdminRole(admin)
			const release = await changeReleaseState({
				admin,
				rawBody: input.rawBody ?? '{}',
				store: input.store,
				now,
			})
			return jsonResponse({ release: toReleaseRolloutView(release) }, 200, corsHeaders)
		}

		throw new AdminApiError('Admin API route not found', 404)
	} catch (error) {
		return errorResponse(error, corsHeaders)
	}
}

export function resetDispatchRateLimits() {
	publicRateState.clear()
	nextReleaseEventCleanupAt = 0
	nextAnnouncementReceiptCleanupAt = 0
}

/**
 * @param {AdminUser} admin
 */
function requireAdminRole(admin) {
	if (admin.role !== 'admin') {
		throw new AdminApiError('Admin role is required', 403)
	}
}

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 */
function readIdempotencyKey(headers) {
	const value = readHeader(headers, 'idempotency-key')
	if (!value || value.length < 16 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
		throw new AdminApiError('A valid Idempotency-Key header is required', 400)
	}
	return value
}

/** @param {string} namespace @param {string} left @param {string} right */
function dispatchDocumentId(namespace, left, right) {
	return `${namespace}-${createHash('sha256')
		.update(`${namespace}\u0000${left}\u0000${right}`, 'utf8')
		.digest('hex')}`
}

/** @param {AnnouncementRecord} existing @param {AnnouncementRecord} requested */
function assertAnnouncementPublicationIdempotent(existing, requested) {
	const existingSnapshot = {
		importance: existing.importance,
		title: existing.title,
		body: existing.body,
		detailUrl: existing.detailUrl,
		audience: existing.audience,
		publishedBy: existing.publishedBy,
	}
	const requestedSnapshot = {
		importance: requested.importance,
		title: requested.title,
		body: requested.body,
		detailUrl: requested.detailUrl,
		audience: requested.audience,
		publishedBy: requested.publishedBy,
	}
	if (canonicalJson(existingSnapshot) !== canonicalJson(requestedSnapshot)) {
		throw new AdminApiError('Idempotency-Key was already used for another announcement', 409)
	}
}

/** @param {ReleaseRolloutRecord} existing @param {ReleaseRolloutRecord} requested */
function assertReleasePublicationIdempotent(existing, requested) {
	const existingSnapshot = {
		runtime: existing.runtime,
		channel: existing.channel,
		releaseId: existing.releaseId,
		percentage: existing.percentage,
		mode: existing.mode,
		minSupportedVersion: existing.minSupportedVersion,
		title: existing.title,
		notes: existing.notes,
		publishedBy: existing.publishedBy,
	}
	const requestedSnapshot = {
		runtime: requested.runtime,
		channel: requested.channel,
		releaseId: requested.releaseId,
		percentage: requested.percentage,
		mode: requested.mode,
		minSupportedVersion: requested.minSupportedVersion,
		title: requested.title,
		notes: requested.notes,
		publishedBy: requested.publishedBy,
	}
	if (canonicalJson(existingSnapshot) !== canonicalJson(requestedSnapshot)) {
		throw new AdminApiError('Idempotency-Key was already used for another release', 409)
	}
}

/** @param {unknown} error @returns {never} */
function throwDispatchConflict(error) {
	if (error instanceof Error && error.name === 'DispatchConflictError') {
		throw new AdminApiError(error.message, 409)
	}
	throw error
}

/**
 * @template T, R
 * @param {T[]} values
 * @param {number} concurrency
 * @param {(value: T, index: number) => Promise<R>} operation
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(values, concurrency, operation) {
	/** @type {R[]} */
	const results = new Array(values.length)
	let nextIndex = 0
	const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
		while (nextIndex < values.length) {
			const index = nextIndex
			nextIndex += 1
			results[index] = await operation(values[index], index)
		}
	})
	await Promise.all(workers)
	return results
}

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @param {string | undefined} expectedToken
 */
function authorizeCiRequest(headers, expectedToken) {
	const token = extractBearerToken(headers)
	if (!token) throw new AdminApiError('Missing CI token', 401)
	if (!expectedToken)
		throw new AdminApiError('Release candidate registration is not configured', 503)
	const received = Buffer.from(token, 'utf8')
	const expected = Buffer.from(expectedToken, 'utf8')
	if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
		throw new AdminApiError('CI token is invalid', 403)
	}
}

/**
 * @param {{ headers: Headers | Record<string, string | string[] | undefined>, env: AdminApiEnv, store: Pick<AdminStore, 'getAuthUser'>, fetchImpl?: typeof fetch }} input
 * @returns {Promise<AdminIdentity>}
 */
export async function resolveCloudBaseClientIdentity(input) {
	const startedAt = Date.now()
	const timeoutMs = input.env.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
	const token = extractBearerToken(input.headers)
	if (!token) throw new AdminApiError('Missing user token', 401)
	const url = new URL(
		`https://${input.env.cloudbaseEnvId}.api.tcloudbasegateway.com/auth/v1/user/me`,
	)
	url.searchParams.set('client_id', input.env.cloudbaseClientId)
	const { response, payload } = await fetchJsonWithTimeout(
		input.fetchImpl ?? fetch,
		url,
		{
			method: 'GET',
			headers: {
				authorization: `Bearer ${token}`,
				'x-device-id': 'wenxue-client-dispatch',
				'x-request-id': randomUUID(),
			},
		},
		timeoutMs,
	)
	if (!response.ok) throw new AdminApiError('CloudBase user token is invalid', 401)
	if (!isRecord(payload)) throw new AdminApiError('CloudBase user token is invalid', 401)
	const uid = readString(payload.sub) ?? readString(payload.uid)
	if (!uid) throw new AdminApiError('CloudBase user token has no uid', 401)
	if (!Object.hasOwn(payload, 'status')) {
		const remainingMs = timeoutMs - (Date.now() - startedAt)
		if (remainingMs <= 0) throw new AdminApiError('Upstream request timed out', 504)
		let authUser
		try {
			authUser = await input.store.getAuthUser(uid, remainingMs)
		} catch {
			throw new AdminApiError('CloudBase user status is unavailable', 503)
		}
		if (authUser && authUser.uid !== uid) {
			throw new AdminApiError('CloudBase user status is unavailable', 503)
		}
		if (!authUser || authUser.active !== true) {
			throw new AdminApiError('CloudBase user is not active', 403)
		}
	} else if (readString(payload.status) !== 'ACTIVE') {
		throw new AdminApiError('CloudBase user is not active', 403)
	}
	return { uid }
}

/**
 * @param {{ admin: AdminUser, idempotencyKey: string, rawBody: string, store: AdminStore, now: () => number }} input
 * @returns {Promise<AnnouncementRecord>}
 */
async function publishAnnouncement(input) {
	const publishedAtMs = input.now()
	const announcementInput = parseAnnouncementInput(input.rawBody, publishedAtMs)
	const publishedAt = new Date(publishedAtMs).toISOString()
	const announcement = /** @type {AnnouncementRecord} */ ({
		_id: dispatchDocumentId('announcement', input.admin._id, input.idempotencyKey),
		schemaVersion: 1,
		status: 'published',
		...announcementInput,
		publishedAt,
		publishedBy: input.admin._id,
	})
	const audit = {
		_id: dispatchDocumentId('audit-announcement', input.admin._id, input.idempotencyKey),
		adminUid: input.admin._id,
		action: 'announcement.publish',
		targetType: 'announcement',
		targetId: announcement._id,
		after: announcementAuditSnapshot(announcement),
		createdAt: publishedAt,
	}
	const committed = await input.store.commitAnnouncementPublication(announcement, audit)
	const stored = normalizeAnnouncement(committed.record)
	if (!stored) throw new AdminApiError('Announcement transaction returned invalid data', 500)
	if (!committed.created) assertAnnouncementPublicationIdempotent(stored, announcement)
	return stored
}

/**
 * @param {{ admin: AdminUser, rawBody: string, store: AdminStore, now: () => number }} input
 * @returns {Promise<AnnouncementRecord>}
 */
async function withdrawAnnouncement(input) {
	const body = parseJsonObject(input.rawBody, 16_384)
	assertOnlyKeys(body, ['id'])
	const id = readBoundedId(body.id, 'announcement id')
	const current = normalizeAnnouncement(await input.store.getAnnouncement(id))
	if (!current) throw new AdminApiError('Announcement not found', 404)
	if (current.status === 'withdrawn') return current
	const withdrawnAt = new Date(input.now()).toISOString()
	const updated = /** @type {AnnouncementRecord} */ ({
		...current,
		status: 'withdrawn',
		withdrawnAt,
		withdrawnBy: input.admin._id,
	})
	const audit = {
		_id: dispatchDocumentId('audit-announcement-withdraw', id, current.publishedAt),
		adminUid: input.admin._id,
		action: 'announcement.withdraw',
		targetType: 'announcement',
		targetId: id,
		before: announcementAuditSnapshot(current),
		after: announcementAuditSnapshot(updated),
		createdAt: withdrawnAt,
	}
	let committed
	try {
		committed = await input.store.commitAnnouncementWithdrawal(updated, audit)
	} catch (error) {
		throwDispatchConflict(error)
	}
	if (committed.outcome === 'missing') throw new AdminApiError('Announcement not found', 404)
	const stored = normalizeAnnouncement(committed.record)
	if (!stored) throw new AdminApiError('Announcement transaction returned invalid data', 500)
	return stored
}

/**
 * @param {{ identity: AdminIdentity, query: Record<string, string | undefined>, store: AdminStore, now: () => number }} input
 */
async function pendingAnnouncements(input) {
	const platform = readPlatform(input.query.platform)
	const version = readSemver(input.query.version, 'version')
	if (!platform) throw new AdminApiError('platform must be darwin or win32', 400)
	const now = input.now()
	scheduleAnnouncementReceiptCleanup(input.store, now)
	const records = []
	for (let skip = 0; skip < MAX_ACTIVE_ANNOUNCEMENTS; skip += ANNOUNCEMENT_PAGE_LIMIT) {
		const page = await input.store.listAnnouncements({
			status: 'published',
			expiresAfter: new Date(now).toISOString(),
			direction: 'asc',
			limit: ANNOUNCEMENT_PAGE_LIMIT,
			skip,
		})
		records.push(...page)
		if (page.length < ANNOUNCEMENT_PAGE_LIMIT) break
		if (skip + ANNOUNCEMENT_PAGE_LIMIT >= MAX_ACTIVE_ANNOUNCEMENTS) {
			throw new AdminApiError('Too many active announcements to evaluate safely', 503)
		}
	}
	const targeted = records
		.flatMap((value) => {
			const announcement = normalizeAnnouncement(value)
			return announcement ? [announcement] : []
		})
		.filter(
			(announcement) =>
				announcement.status === 'published' &&
				Date.parse(announcement.expiresAt) > now &&
				matchesAnnouncementAudience(
					{ userId: input.identity.uid, platform, version },
					announcement.audience,
				),
		)
		.sort((left, right) => {
			if (left.importance !== right.importance) {
				return left.importance === 'important' ? -1 : 1
			}
			return Date.parse(left.publishedAt) - Date.parse(right.publishedAt)
		})
	const pending = []
	for (let offset = 0; offset < targeted.length; offset += ANNOUNCEMENT_RECEIPT_BATCH_SIZE) {
		const batch = targeted.slice(offset, offset + ANNOUNCEMENT_RECEIPT_BATCH_SIZE)
		const receipts = await input.store.listAnnouncementReceipts(
			input.identity.uid,
			batch.map((announcement) => announcement._id),
		)
		const acknowledgedIds = new Set(
			receipts.flatMap((receipt) => {
				if (!isRecord(receipt) || readString(receipt.uid) !== input.identity.uid) return []
				const announcementId = readString(receipt.announcementId)
				return announcementId ? [announcementId] : []
			}),
		)
		for (const announcement of batch) {
			if (acknowledgedIds.has(announcement._id)) continue
			pending.push(toAnnouncementClientView(announcement))
			if (pending.length === 10) return pending
		}
	}
	return pending
}

/**
 * @param {{ identity: AdminIdentity, rawBody: string, store: AdminStore, now: () => number }} input
 */
async function acknowledgeAnnouncement(input) {
	const body = parseJsonObject(input.rawBody, 16_384)
	assertOnlyKeys(body, ['announcementId'])
	const announcementId = readBoundedId(body.announcementId, 'announcementId')
	const announcement = normalizeAnnouncement(await input.store.getAnnouncement(announcementId))
	if (
		!announcement ||
		announcement.status !== 'published' ||
		Date.parse(announcement.expiresAt) <= input.now() ||
		(announcement.audience.userIds?.length &&
			!announcement.audience.userIds.includes(input.identity.uid))
	) {
		throw new AdminApiError('Announcement not found', 404)
	}
	const acknowledgedAt = new Date(input.now()).toISOString()
	const committed = await input.store.commitAnnouncementAcknowledgement({
		_id: `${announcementId}:${input.identity.uid}`,
		announcementId,
		uid: input.identity.uid,
		acknowledgedAt,
		expiresAt: new Date(
			Date.parse(announcement.expiresAt) + ANNOUNCEMENT_RECEIPT_EXPIRY_BUFFER_MS,
		).toISOString(),
	})
	const storedAcknowledgedAt = isRecord(committed.record)
		? readString(committed.record.acknowledgedAt)
		: null
	scheduleAnnouncementReceiptCleanup(input.store, input.now())
	return { announcementId, acknowledgedAt: storedAcknowledgedAt ?? acknowledgedAt }
}

/** @param {AdminStore} store @param {number} now */
function scheduleAnnouncementReceiptCleanup(store, now) {
	if (now < nextAnnouncementReceiptCleanupAt) return
	nextAnnouncementReceiptCleanupAt = now + ANNOUNCEMENT_RECEIPT_CLEANUP_INTERVAL_MS
	void store.cleanupExpiredAnnouncementReceipts(new Date(now).toISOString()).catch(() => {
		// TTL is primary; bounded cleanup is a best-effort fallback and must not block delivery.
	})
}

/**
 * @param {{ rawBody: string, env: AdminApiEnv, store: AdminStore, now: () => number }} input
 * @returns {Promise<ReleaseCandidateRecord>}
 */
async function registerReleaseCandidate(input) {
	const body = parseJsonObject(input.rawBody, 262_144)
	assertOnlyKeys(body, ['manifestUrl', 'manifest', 'manifestSignature', 'publicKeyFingerprint'])
	const manifest = isRecord(body.manifest) ? body.manifest : null
	if (!manifest) throw new AdminApiError('Release manifest is required', 400)
	const candidate = normalizeReleaseCandidateInput(
		manifest,
		body.manifestUrl,
		body.manifestSignature,
	)
	if (canonicalJson(manifest) !== canonicalJson(releaseCandidateManifest(candidate))) {
		throw new AdminApiError('Release manifest fields must already be normalized', 400)
	}
	const publicKeyFingerprint = readString(body.publicKeyFingerprint)
	if (
		!publicKeyFingerprint ||
		!/^[a-f0-9]{64}$/i.test(publicKeyFingerprint) ||
		publicKeyFingerprint.toLowerCase() !==
			releasePublicKeyFingerprint(input.env.releaseManifestPublicKey)
	) {
		throw new AdminApiError('Desktop and server release public keys do not match', 400)
	}
	if (
		candidate.sourceCoordinates.releasePublicKeyFingerprint &&
		candidate.sourceCoordinates.releasePublicKeyFingerprint !== publicKeyFingerprint.toLowerCase()
	) {
		throw new AdminApiError('Signed manifest release public key fingerprint does not match', 400)
	}
	verifyReleaseCandidate(manifest, candidate.manifestSignature, input.env.releaseManifestPublicKey)
	const registeredAt = new Date(input.now()).toISOString()
	const record = /** @type {ReleaseCandidateRecord} */ ({
		...candidate,
		status: 'verified',
		registeredAt,
	})
	const existingById = normalizeReleaseCandidateRecord(
		await input.store.getReleaseCandidate(record._id),
	)
	if (existingById) return assertCandidateIdempotent(existingById, record)
	const existingByVersion = normalizeReleaseCandidateRecord(
		await input.store.findReleaseCandidate(record.runtime, record.channel, record.version),
	)
	if (existingByVersion) return assertCandidateIdempotent(existingByVersion, record)
	const created = await input.store.createReleaseCandidateIfAbsent(record)
	if (created) return record
	const raced =
		normalizeReleaseCandidateRecord(await input.store.getReleaseCandidate(record._id)) ??
		normalizeReleaseCandidateRecord(
			await input.store.findReleaseCandidate(record.runtime, record.channel, record.version),
		)
	if (!raced) throw new AdminApiError('Release candidate registration conflicted', 409)
	return assertCandidateIdempotent(raced, record)
}

/**
 * @param {{ admin: AdminUser, idempotencyKey: string, rawBody: string, store: AdminStore, now: () => number }} input
 * @returns {Promise<ReleaseRolloutRecord>}
 */
async function publishRelease(input) {
	const body = parseJsonObject(input.rawBody, 65_536)
	assertOnlyKeys(body, [
		'candidateId',
		'title',
		'notes',
		'percentage',
		'mode',
		'minSupportedVersion',
	])
	const candidateId = readBoundedId(body.candidateId, 'candidateId')
	const title = readRequiredText(body.title, 'title', 80)
	const notes = readRequiredText(body.notes, 'notes', 2_000)
	const percentage = readAllowedPercentage(body.percentage)
	const mode = readUpdateMode(body.mode)
	const minSupportedVersion =
		body.minSupportedVersion === undefined
			? undefined
			: readSemver(body.minSupportedVersion, 'minSupportedVersion')
	if (mode === 'mandatory' && percentage !== 100) {
		throw new AdminApiError('Mandatory updates require 100 percent rollout', 400)
	}
	const candidate = normalizeReleaseCandidateRecord(
		await input.store.getReleaseCandidate(candidateId),
	)
	if (!candidate || candidate.status !== 'verified') {
		throw new AdminApiError('Verified release candidate not found', 404)
	}
	if (candidate.schemaVersion === 2 && mode === 'mandatory') {
		throw new AdminApiError('Platform updates must be optional', 400)
	}
	if (minSupportedVersion && compareSemver(minSupportedVersion, candidate.version) >= 0) {
		throw new AdminApiError('minSupportedVersion must be lower than candidate version', 400)
	}
	const publishedAt = new Date(input.now()).toISOString()
	const release = /** @type {ReleaseRolloutRecord} */ ({
		_id: dispatchDocumentId('release', input.admin._id, input.idempotencyKey),
		runtime: candidate.runtime,
		channel: candidate.channel,
		releaseId: candidate._id,
		status: 'active',
		percentage,
		mode,
		minSupportedVersion,
		title,
		notes,
		publishedAt,
		publishedBy: input.admin._id,
		updatedAt: publishedAt,
		updatedBy: input.admin._id,
	})
	const existing = normalizeReleaseRollout(await input.store.getReleaseRollout(release._id))
	if (existing) {
		assertReleasePublicationIdempotent(existing, release)
		return existing
	}
	const previousRollouts = (
		await input.store.listReleaseRollouts({
			runtime: candidate.runtime,
			channel: candidate.channel,
			limit: DEFAULT_RELEASE_LIMIT,
		})
	).flatMap((value) => {
		const release = normalizeReleaseRollout(value)
		return release ? [release] : []
	})
	const publishedCandidates = await mapWithConcurrency(previousRollouts, 5, async (release) =>
		normalizeReleaseCandidateRecord(await input.store.getReleaseCandidate(release.releaseId)),
	)
	const highestPublishedVersion = publishedCandidates
		.flatMap((previous) => (previous ? [previous.version] : []))
		.sort((left, right) => compareSemver(right, left))[0]
	if (highestPublishedVersion && compareSemver(highestPublishedVersion, candidate.version) >= 0) {
		throw new AdminApiError('Release version must move forward from published history', 409)
	}
	const audit = {
		_id: dispatchDocumentId('audit-release', input.admin._id, input.idempotencyKey),
		adminUid: input.admin._id,
		action: 'release.publish',
		targetType: 'release',
		targetId: release._id,
		after: releaseAuditSnapshot(release),
		createdAt: publishedAt,
	}
	const legacyRolloutIds = previousRollouts
		.filter((previous) => previous.status === 'active' || previous.status === 'paused')
		.map((previous) => previous._id)
	let committed
	try {
		committed = await input.store.commitReleasePublication(release, audit, legacyRolloutIds, {
			candidateVersion: candidate.version,
			...(highestPublishedVersion ? { highestPublishedVersion } : {}),
		})
	} catch (error) {
		throwDispatchConflict(error)
	}
	const stored = normalizeReleaseRollout(committed.record)
	if (!stored) throw new AdminApiError('Release transaction returned invalid data', 500)
	if (!committed.created) assertReleasePublicationIdempotent(stored, release)
	return stored
}

/**
 * @param {{ admin: AdminUser, rawBody: string, store: AdminStore, now: () => number }} input
 * @returns {Promise<ReleaseRolloutRecord>}
 */
async function changeReleaseState(input) {
	const body = parseJsonObject(input.rawBody, 16_384)
	assertOnlyKeys(body, ['releaseId', 'action'])
	const releaseId = readBoundedId(body.releaseId, 'releaseId')
	const action =
		body.action === 'pause' || body.action === 'resume' || body.action === 'withdraw'
			? body.action
			: null
	if (!action) throw new AdminApiError('Invalid release action', 400)
	const current = normalizeReleaseRollout(await input.store.getReleaseRollout(releaseId))
	if (!current) throw new AdminApiError('Release rollout not found', 404)
	/** @type {ReleaseStatus | null} */
	let nextStatus = null
	/** @type {ReleaseStatus | null} */
	let expectedStatus = null
	if (action === 'pause' && (current.status === 'active' || current.status === 'paused')) {
		expectedStatus = 'active'
		nextStatus = 'paused'
	}
	if (action === 'resume' && (current.status === 'paused' || current.status === 'active')) {
		expectedStatus = 'paused'
		nextStatus = 'active'
	}
	if (
		action === 'withdraw' &&
		(current.status === 'active' || current.status === 'paused' || current.status === 'withdrawn')
	) {
		expectedStatus = current.status === 'withdrawn' ? 'active' : current.status
		nextStatus = 'withdrawn'
	}
	if (!nextStatus || !expectedStatus) {
		throw new AdminApiError('Release state transition is not allowed', 409)
	}
	const updatedAt = new Date(input.now()).toISOString()
	const updated = /** @type {ReleaseRolloutRecord} */ ({
		...current,
		status: nextStatus,
		updatedAt,
		updatedBy: input.admin._id,
	})
	const audit = {
		_id: dispatchDocumentId('audit-release-state', releaseId, `${action}:${current.updatedAt}`),
		adminUid: input.admin._id,
		action: `release.${action}`,
		targetType: 'release',
		targetId: releaseId,
		before: releaseAuditSnapshot(current),
		after: releaseAuditSnapshot(updated),
		createdAt: updatedAt,
	}
	let committed
	try {
		committed = await input.store.commitReleaseState(updated, audit, expectedStatus)
	} catch (error) {
		throwDispatchConflict(error)
	}
	if (committed.outcome === 'missing') throw new AdminApiError('Release rollout not found', 404)
	const stored = normalizeReleaseRollout(committed.record)
	if (!stored) throw new AdminApiError('Release transaction returned invalid data', 500)
	return stored
}

/**
 * @param {{ query: Record<string, string | undefined>, store: AdminStore, eventTokenSecret?: string, now: () => number }} input
 */
async function buildClientUpdatePolicy(input) {
	const protocolVersion = input.query.protocolVersion
	if (protocolVersion !== undefined && protocolVersion !== '2') {
		throw new AdminApiError('Unsupported update protocol version', 400)
	}
	const runtime = readRuntime(input.query.runtime)
	const platform = readPlatform(input.query.platform)
	const arch = readArchitecture(input.query.arch)
	const channel = readChannel(input.query.channel)
	const version = readSemver(input.query.version, 'version')
	const installIdHash = readSha256(input.query.installIdHash, 'installIdHash')
	if (!runtime) throw new AdminApiError('Invalid runtime', 400)
	if (!platform) throw new AdminApiError('Invalid platform', 400)
	if (!arch) throw new AdminApiError('Invalid architecture', 400)
	if (!channel) throw new AdminApiError('Invalid channel', 400)
	const slot = await input.store.getReleaseActiveSlot(runtime, channel)
	const hasActivePointer = isRecord(slot) && Object.hasOwn(slot, 'activeRolloutId')
	const activePointer = isRecord(slot) ? readString(slot.activeRolloutId) : null
	let active = activePointer
		? normalizeReleaseRollout(await input.store.getReleaseRollout(activePointer))
		: null
	if (!hasActivePointer) {
		const releases = await input.store.listReleaseRollouts({
			runtime,
			channel,
			limit: DEFAULT_RELEASE_LIMIT,
		})
		active = releases
			.flatMap((value) => {
				const release = normalizeReleaseRollout(value)
				return release?.status === 'active' ? [release] : []
			})
			.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0]
	}
	if (!active) return null
	if (active.status !== 'active' || active.runtime !== runtime || active.channel !== channel)
		return null
	const candidate = normalizeReleaseCandidateRecord(
		await input.store.getReleaseCandidate(active.releaseId),
	)
	if (!candidate || candidate.status !== 'verified') return null
	if (candidate.schemaVersion === 2 && protocolVersion !== '2') return null
	if (candidate.schemaVersion === 2 && active.mode !== 'optional') return null
	if (candidate.runtime !== runtime || candidate.channel !== channel) return null
	if (compareSemver(candidate.version, version) <= 0) return null
	const artifacts = candidate.artifacts.filter(
		(candidateArtifact) =>
			candidateArtifact.platform === platform && candidateArtifact.arch === arch,
	)
	if (!hasInstallableArtifactSet(artifacts, platform)) return null
	const checkedAtMs = input.now()
	const eventToken = createReleaseEventToken(
		{
			releaseId: candidate._id,
			installIdHash,
			runtime,
			platform,
			arch,
			fromVersion: version,
			expiresAt: checkedAtMs + UPDATE_EVENT_TOKEN_TTL_MS,
		},
		input.eventTokenSecret,
	)
	const effectiveMode =
		active.mode === 'mandatory' &&
		active.minSupportedVersion &&
		compareSemver(version, active.minSupportedVersion) >= 0
			? 'optional'
			: active.mode
	return {
		id: active._id,
		runtime,
		channel,
		releaseId: candidate._id,
		version: candidate.version,
		percentage: active.percentage,
		mode: effectiveMode,
		minSupportedVersion: active.minSupportedVersion,
		title: active.title,
		notes: active.notes,
		manifestUrl: candidate.manifestUrl,
		manifestSignature: candidate.manifestSignature,
		distribution: candidate.distribution,
		artifacts,
		...(candidate.schemaVersion === 2 ? { schemaVersion: 2 } : {}),
		publishedAt: active.publishedAt,
		checkedAt: new Date(checkedAtMs).toISOString(),
		validUntil: new Date(checkedAtMs + UPDATE_POLICY_FRESHNESS_MS).toISOString(),
		eventToken,
	}
}

/**
 * @param {{ rawBody: string, store: AdminStore, eventTokenSecret?: string, eventDailyQuota?: number, now: () => number }} input
 */
async function recordReleaseEvent(input) {
	const body = parseJsonObject(input.rawBody, 32_768)
	const allowedKeys = new Set([
		'releaseId',
		'installIdHash',
		'runtime',
		'platform',
		'arch',
		'fromVersion',
		'stage',
		'result',
		'errorCode',
		'eventToken',
	])
	for (const key of Object.keys(body)) {
		if (!allowedKeys.has(key) || (key !== 'eventToken' && EVENT_SENSITIVE_PATTERN.test(key))) {
			throw new AdminApiError(`Update event field is not allowed: ${key}`, 400)
		}
	}
	const releaseId = readBoundedId(body.releaseId, 'releaseId')
	const installIdHash = readSha256(body.installIdHash, 'installIdHash')
	const runtime = readRuntime(body.runtime)
	const platform = readPlatform(body.platform)
	const arch = readArchitecture(body.arch)
	const fromVersion = readSemver(body.fromVersion, 'fromVersion')
	if (!runtime || !platform || !arch) throw new AdminApiError('Invalid update event target', 400)
	const stage = readUpdateEventStage(body.stage)
	const result = readUpdateEventResult(stage, body.result)
	const errorCode =
		body.errorCode === undefined ? undefined : readIdentifier(body.errorCode, 'errorCode', 64)
	verifyReleaseEventToken(
		readRequiredText(body.eventToken, 'eventToken', 4_096),
		{
			releaseId,
			installIdHash,
			runtime,
			platform,
			arch,
			fromVersion,
			now: input.now(),
		},
		input.eventTokenSecret,
	)
	const candidate = normalizeReleaseCandidateRecord(
		await input.store.getReleaseCandidate(releaseId),
	)
	if (
		!candidate ||
		candidate.status !== 'verified' ||
		candidate.runtime !== runtime ||
		compareSemver(fromVersion, candidate.version) >= 0 ||
		!hasInstallableArtifactSet(
			candidate.artifacts.filter(
				(artifact) => artifact.platform === platform && artifact.arch === arch,
			),
			platform,
		)
	) {
		throw new AdminApiError('Verified release candidate does not match update event', 400)
	}
	const createdAtMs = input.now()
	const event = {
		_id: dispatchDocumentId(
			'event',
			releaseId,
			`${installIdHash}:${stage}:${result === 'start' ? 'start' : 'final'}`,
		),
		releaseId,
		installIdHash,
		runtime,
		platform,
		arch,
		fromVersion,
		stage,
		result,
		errorCode,
		createdAt: new Date(createdAtMs).toISOString(),
		expiresAt: new Date(createdAtMs + UPDATE_EVENT_RETENTION_MS).toISOString(),
	}
	const quotaDay = event.createdAt.slice(0, 10)
	const quotaDayEndMs = Date.parse(`${quotaDay}T00:00:00.000Z`) + 24 * 60 * 60 * 1000
	const dailyQuota = readReleaseEventDailyQuota(input.eventDailyQuota)
	const quotaShardCount = Math.min(RELEASE_EVENT_QUOTA_SHARDS, dailyQuota)
	const initialQuotaShard =
		createHash('sha256').update(event._id, 'utf8').digest().readUInt32BE(0) % quotaShardCount
	const quotaBaseLimit = Math.floor(dailyQuota / quotaShardCount)
	const quotaRemainder = dailyQuota % quotaShardCount
	const quotaExpiresAt = new Date(quotaDayEndMs + UPDATE_EVENT_RETENTION_MS).toISOString()
	let stored
	for (let offset = 0; offset < quotaShardCount; offset += 1) {
		const quotaShard = (initialQuotaShard + offset) % quotaShardCount
		stored = await input.store.createReleaseEventWithinQuota(event, {
			id: `release-event-quota:${quotaDay}:${quotaShard}`,
			limit: quotaBaseLimit + (quotaShard < quotaRemainder ? 1 : 0),
			expiresAt: quotaExpiresAt,
		})
		if (stored.outcome !== 'quota-exceeded') break
	}
	if (!stored || stored.outcome === 'quota-exceeded') {
		throw new AdminApiError('Release event daily quota exceeded', 429, {
			'retry-after': String(Math.max(1, Math.ceil((quotaDayEndMs - createdAtMs) / 1000))),
		})
	}
	if (createdAtMs >= nextReleaseEventCleanupAt) {
		nextReleaseEventCleanupAt = createdAtMs + UPDATE_EVENT_CLEANUP_INTERVAL_MS
		void input.store.cleanupExpiredReleaseEvents(event.createdAt).catch(() => {
			// Retention cleanup is best-effort here; accepting a health event must not depend on it.
		})
	}
	return event
}

/** @param {unknown} value */
function readReleaseEventDailyQuota(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
		? Math.min(value, MAX_RELEASE_EVENT_DAILY_QUOTA)
		: DEFAULT_RELEASE_EVENT_DAILY_QUOTA
}

/**
 * @param {string} releaseId
 * @param {unknown[]} values
 * @param {string} windowStartedAt
 */
function buildReleaseHealth(releaseId, values, windowStartedAt, truncated = false) {
	const stages = {
		check: { success: 0, failure: 0 },
		download: { success: 0, failure: 0 },
		handoff: { success: 0, failure: 0 },
	}
	let updatedAt
	let sampleCount = 0
	for (const value of values) {
		const event = normalizeReleaseHealthEvent(value)
		if (!event || event.releaseId !== releaseId) continue
		if (!updatedAt || Date.parse(event.createdAt) > Date.parse(updatedAt)) {
			updatedAt = event.createdAt
		}
		if (event.result === 'success' || event.result === 'failure') {
			sampleCount += 1
			stages[event.stage][event.result] += 1
		}
	}
	const completedHandoffs = stages.handoff.success + stages.handoff.failure
	return {
		windowStartedAt,
		updatedAt,
		sampleCount,
		truncated,
		stages,
		handoffFailureRate: completedHandoffs === 0 ? null : stages.handoff.failure / completedHandoffs,
	}
}

/**
 * @param {AdminStore} store
 * @param {string} releaseId
 * @param {string} windowStartedAt
 * @param {string} windowEndedAt
 */
async function listReleaseHealthEvents(store, releaseId, windowStartedAt, windowEndedAt) {
	const events = []
	/** @type {{ createdAt: string, id: string } | undefined} */
	let before
	const probeLimit = MAX_RELEASE_EVENT_HEALTH_EVENTS + 1
	while (events.length < probeLimit) {
		const pageLimit = Math.min(RELEASE_EVENT_PAGE_LIMIT, probeLimit - events.length)
		const page = await store.listReleaseEvents({
			releaseId,
			createdAfter: windowStartedAt,
			createdBefore: windowEndedAt,
			before,
			limit: pageLimit,
		})
		events.push(...page)
		if (events.length >= probeLimit) {
			return { events: events.slice(0, MAX_RELEASE_EVENT_HEALTH_EVENTS), truncated: true }
		}
		if (page.length < pageLimit) return { events, truncated: false }
		before = readReleaseEventCursor(page.at(-1))
	}
	return { events, truncated: false }
}

/** @param {unknown} value */
function readReleaseEventCursor(value) {
	if (!isRecord(value)) throw new AdminApiError('Release event page is invalid', 500)
	const createdAt = readString(value.createdAt)
	const id = readString(value._id)
	if (!createdAt || !Number.isFinite(Date.parse(createdAt)) || !id) {
		throw new AdminApiError('Release event page is invalid', 500)
	}
	return { createdAt, id }
}

/**
 * @param {unknown} value
 * @returns {{ releaseId: string, createdAt: string, stage: UpdateEventStage, result: UpdateEventResult } | null}
 */
function normalizeReleaseHealthEvent(value) {
	if (!isRecord(value)) return null
	const releaseId = readString(value.releaseId)
	const createdAt = readString(value.createdAt)
	const stage = readUpdateEventStageOrNull(value.stage)
	const result = readString(value.result)
	if (
		!releaseId ||
		!createdAt ||
		!Number.isFinite(Date.parse(createdAt)) ||
		!stage ||
		!result ||
		!UPDATE_EVENT_RESULTS[stage].has(result)
	) {
		return null
	}
	return {
		releaseId,
		createdAt,
		stage,
		result: /** @type {UpdateEventResult} */ (result),
	}
}

/**
 * @param {{ userId: string, platform: DesktopPlatform, version: string }} target
 * @param {AnnouncementAudience} audience
 */
export function matchesAnnouncementAudience(target, audience) {
	if (audience.platforms?.length && !audience.platforms.includes(target.platform)) return false
	if (audience.userIds?.length && !audience.userIds.includes(target.userId)) return false
	if (audience.minVersion && compareSemver(target.version, audience.minVersion) < 0) return false
	if (audience.maxVersion && compareSemver(target.version, audience.maxVersion) > 0) return false
	return true
}

/**
 * @param {string} left
 * @param {string} right
 */
export function compareSemver(left, right) {
	const leftVersion = parseSemver(left)
	const rightVersion = parseSemver(right)
	for (let index = 0; index < 3; index += 1) {
		const difference = leftVersion.core[index] - rightVersion.core[index]
		if (difference !== 0) return difference < 0 ? -1 : 1
	}
	if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) return 0
	if (leftVersion.prerelease.length === 0) return 1
	if (rightVersion.prerelease.length === 0) return -1
	const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
	for (let index = 0; index < length; index += 1) {
		const leftPart = leftVersion.prerelease[index]
		const rightPart = rightVersion.prerelease[index]
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
 * @param {string} rawBody
 * @param {number} now
 * @returns {NormalizedAnnouncementInput}
 */
function parseAnnouncementInput(rawBody, now) {
	const body = parseJsonObject(rawBody, 65_536)
	assertOnlyKeys(body, ['importance', 'title', 'body', 'detailUrl', 'audience', 'expiresAt'])
	const importance =
		body.importance === 'normal' || body.importance === 'important' ? body.importance : null
	if (!importance) throw new AdminApiError('importance must be normal or important', 400)
	const title = readRequiredText(body.title, 'title', 80)
	const announcementBody = readRequiredText(body.body, 'body', 1_000)
	const detailUrl = readOptionalHttpsUrl(body.detailUrl, 'detailUrl', 2_048)
	const audience = parseAnnouncementAudience(body.audience)
	const expiresAtMs =
		body.expiresAt === undefined
			? now + ANNOUNCEMENT_DEFAULT_LIFETIME_MS
			: readIsoTimestamp(body.expiresAt, 'expiresAt')
	if (expiresAtMs <= now) throw new AdminApiError('expiresAt must be in the future', 400)
	if (expiresAtMs > now + ANNOUNCEMENT_MAX_LIFETIME_MS) {
		throw new AdminApiError('expiresAt cannot be more than 30 days in the future', 400)
	}
	return {
		importance,
		title,
		body: announcementBody,
		detailUrl,
		audience,
		expiresAt: new Date(expiresAtMs).toISOString(),
	}
}

/**
 * @param {unknown} value
 * @returns {AnnouncementAudience}
 */
function parseAnnouncementAudience(value) {
	if (value === undefined) return {}
	if (!isRecord(value)) throw new AdminApiError('audience must be an object', 400)
	assertOnlyKeys(value, ['platforms', 'minVersion', 'maxVersion', 'userIds'])
	let platforms
	if (value.platforms !== undefined) {
		if (!Array.isArray(value.platforms)) {
			throw new AdminApiError('audience.platforms must be an array', 400)
		}
		const normalizedPlatforms = value.platforms.map((platform) => {
			const normalized = readPlatform(platform)
			if (!normalized) throw new AdminApiError('Invalid audience platform', 400)
			return normalized
		})
		platforms = normalizedPlatforms.length > 0 ? [...new Set(normalizedPlatforms)] : undefined
	}
	const minVersion =
		value.minVersion === undefined ? undefined : readSemver(value.minVersion, 'audience.minVersion')
	const maxVersion =
		value.maxVersion === undefined ? undefined : readSemver(value.maxVersion, 'audience.maxVersion')
	if (minVersion && maxVersion && compareSemver(minVersion, maxVersion) > 0) {
		throw new AdminApiError('audience version range is invalid', 400)
	}
	let userIds
	if (value.userIds !== undefined) {
		if (!Array.isArray(value.userIds)) {
			throw new AdminApiError('audience.userIds must be an array', 400)
		}
		if (value.userIds.length > 500) {
			throw new AdminApiError('audience.userIds cannot contain more than 500 users', 400)
		}
		const normalizedUserIds = value.userIds.map((userId) => {
			const normalized = readUserId(userId)
			if (!normalized) throw new AdminApiError('Invalid audience user id', 400)
			return normalized
		})
		if (new Set(normalizedUserIds).size !== normalizedUserIds.length) {
			throw new AdminApiError('audience.userIds cannot contain duplicates', 400)
		}
		userIds = normalizedUserIds.length > 0 ? normalizedUserIds : undefined
	}
	return { platforms, minVersion, maxVersion, userIds }
}

/**
 * @param {unknown} value
 * @returns {AnnouncementRecord | null}
 */
function normalizeAnnouncement(value) {
	if (!isRecord(value)) return null
	try {
		const id = readString(value._id) ?? readString(value.id)
		const status =
			value.status === 'published' || value.status === 'withdrawn' ? value.status : null
		const importance =
			value.importance === 'normal' || value.importance === 'important' ? value.importance : null
		const title = readString(value.title)
		const body = typeof value.body === 'string' && value.body.trim() ? value.body.trim() : null
		const publishedAt = readString(value.publishedAt)
		const expiresAt = readString(value.expiresAt)
		const publishedBy = readString(value.publishedBy)
		if (
			!id ||
			!status ||
			!importance ||
			!title ||
			!body ||
			!publishedAt ||
			!expiresAt ||
			!publishedBy ||
			!Number.isFinite(Date.parse(publishedAt)) ||
			!Number.isFinite(Date.parse(expiresAt))
		) {
			return null
		}
		return {
			_id: id,
			schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 1,
			status,
			importance,
			title,
			body,
			detailUrl: readString(value.detailUrl) ?? undefined,
			audience: parseAnnouncementAudience(value.audience),
			publishedAt,
			expiresAt,
			publishedBy,
			withdrawnAt: readString(value.withdrawnAt) ?? undefined,
			withdrawnBy: readString(value.withdrawnBy) ?? undefined,
		}
	} catch {
		return null
	}
}

/**
 * @param {AnnouncementRecord} announcement
 */
function toAnnouncementAdminView(announcement) {
	return {
		id: announcement._id,
		status: announcement.status,
		importance: announcement.importance,
		title: announcement.title,
		body: announcement.body,
		detailUrl: announcement.detailUrl,
		audience: announcement.audience,
		publishedAt: announcement.publishedAt,
		publishedBy: announcement.publishedBy,
		expiresAt: announcement.expiresAt,
		withdrawnAt: announcement.withdrawnAt,
	}
}

/**
 * @param {AnnouncementRecord} announcement
 */
function toAnnouncementClientView(announcement) {
	return {
		id: announcement._id,
		importance: announcement.importance,
		title: announcement.title,
		body: announcement.body,
		detailUrl: announcement.detailUrl,
		publishedAt: announcement.publishedAt,
		expiresAt: announcement.expiresAt,
	}
}

/**
 * @param {AnnouncementRecord} announcement
 */
function announcementAuditSnapshot(announcement) {
	return {
		status: announcement.status,
		importance: announcement.importance,
		title: announcement.title,
		platforms: announcement.audience.platforms,
		minVersion: announcement.audience.minVersion,
		maxVersion: announcement.audience.maxVersion,
		targetUserCount: announcement.audience.userIds?.length ?? 0,
		publishedAt: announcement.publishedAt,
		expiresAt: announcement.expiresAt,
		withdrawnAt: announcement.withdrawnAt,
	}
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {unknown} wrapperManifestUrl
 * @param {unknown} manifestSignature
 * @returns {Omit<ReleaseCandidateRecord, 'status' | 'registeredAt'>}
 */
function normalizeReleaseCandidateInput(manifest, wrapperManifestUrl, manifestSignature) {
	assertOnlyKeys(manifest, [
		'schemaVersion',
		'releaseId',
		'runtime',
		'channel',
		'version',
		'createdAt',
		'manifestUrl',
		'sourceCoordinates',
		'distribution',
		'tests',
		'artifacts',
	])
	if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) {
		throw new AdminApiError('Unsupported manifest schema', 400)
	}
	const schemaVersion = manifest.schemaVersion
	const id = readBoundedId(manifest.releaseId, 'releaseId')
	const runtime = readRuntime(manifest.runtime)
	const channel = readChannel(manifest.channel)
	if (!runtime || !channel) throw new AdminApiError('Invalid release runtime or channel', 400)
	if (schemaVersion === 2 && runtime !== 'electron') {
		throw new AdminApiError('Platform release requires Electron runtime', 400)
	}
	const version = readSemver(manifest.version, 'version')
	const createdAtMs = readIsoTimestamp(manifest.createdAt, 'createdAt')
	const embeddedManifestUrl = readHttpsUrl(manifest.manifestUrl, 'manifest.manifestUrl', 2_048)
	const outerManifestUrl = readHttpsUrl(wrapperManifestUrl, 'manifestUrl', 2_048)
	if (embeddedManifestUrl !== outerManifestUrl) {
		throw new AdminApiError('Manifest URL does not match signed manifest', 400)
	}
	const signature = readString(manifestSignature)
	if (!signature || !isBase64Digest(signature, 64)) {
		throw new AdminApiError('manifestSignature must be base64', 400)
	}
	const sourceCoordinates = normalizeSourceCoordinates(manifest.sourceCoordinates)
	if (schemaVersion === 2 && !sourceCoordinates.releasePublicKeyFingerprint) {
		throw new AdminApiError('Platform release requires public key fingerprint', 400)
	}
	const distribution = normalizeReleaseDistribution(manifest.distribution, schemaVersion)
	const tests = normalizeReleaseTests(manifest.tests)
	const artifacts = normalizeReleaseArtifacts(manifest.artifacts, schemaVersion, channel)
	if (schemaVersion === 2) {
		assertUnsignedReleaseUrl(embeddedManifestUrl, 'manifest.manifestUrl')
		for (const test of tests) assertUnsignedReleaseUrl(test.url, 'test url')
	}
	return {
		_id: id,
		schemaVersion,
		runtime,
		version,
		channel,
		createdAt: new Date(createdAtMs).toISOString(),
		manifestUrl: outerManifestUrl,
		manifestSignature: signature,
		artifacts,
		sourceCoordinates,
		distribution,
		tests,
	}
}

/**
 * @param {unknown} value
 */
function normalizeSourceCoordinates(value) {
	if (!isRecord(value)) throw new AdminApiError('sourceCoordinates must be an object', 400)
	assertOnlyKeys(value, [
		'repository',
		'commit',
		'browserVersion',
		'extensionVersion',
		'releasePublicKeyFingerprint',
	])
	const repository = readRequiredText(value.repository, 'sourceCoordinates.repository', 2_048)
	const commit = readString(value.commit)
	if (!commit || !/^[a-f0-9]{40}$/i.test(commit)) {
		throw new AdminApiError('sourceCoordinates.commit must be a 40 character hash', 400)
	}
	const releasePublicKeyFingerprint =
		value.releasePublicKeyFingerprint === undefined
			? undefined
			: readSha256(
					value.releasePublicKeyFingerprint,
					'sourceCoordinates.releasePublicKeyFingerprint',
				)
	return {
		repository,
		commit: commit.toLowerCase(),
		browserVersion: readRequiredText(value.browserVersion, 'sourceCoordinates.browserVersion', 128),
		extensionVersion: readRequiredText(
			value.extensionVersion,
			'sourceCoordinates.extensionVersion',
			128,
		),
		...(releasePublicKeyFingerprint ? { releasePublicKeyFingerprint } : {}),
	}
}

/**
 * @param {unknown} value
 * @param {1 | 2} schemaVersion
 * @returns {ReleaseDistribution}
 */
function normalizeReleaseDistribution(value, schemaVersion) {
	if (!isRecord(value)) throw new AdminApiError('distribution must be an object', 400)
	assertOnlyKeys(value, ['mode'])
	const requiredMode = schemaVersion === 2 ? 'platform-unsigned' : 'manual-unsigned'
	if (value.mode !== requiredMode) {
		throw new AdminApiError(`distribution.mode must be ${requiredMode}`, 400)
	}
	return { mode: requiredMode }
}

/**
 * @param {unknown} value
 * @returns {ReleaseTestEvidence[]}
 */
function normalizeReleaseTests(value) {
	if (!Array.isArray(value) || value.length !== REQUIRED_RELEASE_TEST_EVIDENCE.size) {
		throw new AdminApiError('tests must contain the three required manual installer checks', 400)
	}
	const tests = value.map((test) => {
		if (!isRecord(test)) throw new AdminApiError('Invalid test evidence', 400)
		assertOnlyKeys(test, ['name', 'status', 'url'])
		if (test.status !== 'passed') throw new AdminApiError('All release tests must pass', 400)
		return {
			name: readRequiredText(test.name, 'test name', 120),
			status: /** @type {'passed'} */ ('passed'),
			url: readHttpsUrl(test.url, 'test url', 2_048),
		}
	})
	const names = new Set(tests.map((test) => test.name))
	if (names.size !== tests.length) throw new AdminApiError('Release test names must be unique', 400)
	for (const required of REQUIRED_RELEASE_TEST_EVIDENCE) {
		if (!names.has(required)) {
			throw new AdminApiError(`Missing required release evidence: ${required}`, 400)
		}
	}
	return tests
}

/**
 * @param {unknown} value
 * @param {1 | 2} schemaVersion
 * @param {ReleaseChannel} channel
 * @returns {ReleaseArtifact[]}
 */
function normalizeReleaseArtifacts(value, schemaVersion, channel) {
	if (
		!Array.isArray(value) ||
		(schemaVersion === 2 ? value.length !== 3 : value.length !== 2 && value.length !== 3)
	) {
		throw new AdminApiError(
			schemaVersion === 2
				? 'artifacts must contain three platform release files'
				: 'artifacts must contain two or three manual installers',
			400,
		)
	}
	const artifacts = value.map((artifact) => {
		if (!isRecord(artifact)) throw new AdminApiError('Invalid release artifact', 400)
		assertOnlyKeys(artifact, ['platform', 'arch', 'kind', 'fileName', 'url', 'sha512', 'size'])
		const platform = readPlatform(artifact.platform)
		const arch = readArchitecture(artifact.arch)
		if (!platform || !arch) throw new AdminApiError('Invalid artifact target', 400)
		const fileName = readRequiredText(artifact.fileName, 'artifact.fileName', 255)
		if (
			fileName.includes('/') ||
			fileName.includes('\\') ||
			fileName === '.' ||
			fileName === '..'
		) {
			throw new AdminApiError('artifact.fileName must be a base name', 400)
		}
		const sha512 = readString(artifact.sha512)
		if (!sha512 || (!/^[a-f0-9]{128}$/i.test(sha512) && !isBase64Digest(sha512, 64))) {
			throw new AdminApiError('artifact.sha512 must be a SHA-512 digest', 400)
		}
		const size = readNonNegativeNumber(artifact.size)
		if (size === null || !Number.isSafeInteger(size) || size <= 0) {
			throw new AdminApiError('artifact.size must be a positive integer', 400)
		}
		return {
			platform,
			arch,
			kind: readIdentifier(artifact.kind, 'artifact.kind', 64),
			fileName,
			url: readHttpsUrl(artifact.url, 'artifact.url', 2_048),
			sha512,
			size,
		}
	})
	const unique = new Set(
		artifacts.map((artifact) => `${artifact.platform}:${artifact.arch}:${artifact.kind}`),
	)
	if (unique.size !== artifacts.length) {
		throw new AdminApiError('Artifact targets and kinds must be unique', 400)
	}
	const requiredTargets = new Set(['darwin:arm64:dmg', 'win32:x64:nsis'])
	if (schemaVersion === 2) requiredTargets.add('win32:x64:nsis-yaml')
	const allowedTargets =
		schemaVersion === 2 ? new Set(requiredTargets) : new Set([...requiredTargets, 'darwin:x64:dmg'])
	for (const artifact of artifacts) {
		const target = `${artifact.platform}:${artifact.arch}:${artifact.kind}`
		if (!allowedTargets.has(target)) {
			throw new AdminApiError(
				`Unexpected ${schemaVersion === 2 ? 'platform release' : 'manual installer'} artifact: ${target}`,
				400,
			)
		}
		if (schemaVersion === 2) {
			assertUnsignedReleaseUrl(artifact.url, 'artifact.url')
			let urlFileName
			try {
				urlFileName = decodeURIComponent(new URL(artifact.url).pathname.split('/').at(-1) ?? '')
			} catch {
				throw new AdminApiError('Artifact URL contains invalid encoding', 400)
			}
			if (urlFileName !== artifact.fileName) {
				throw new AdminApiError('Artifact URL must name its file', 400)
			}
		}
		requiredTargets.delete(target)
	}
	if (requiredTargets.size > 0) {
		throw new AdminApiError(
			`Release artifact matrix is missing ${Array.from(requiredTargets).join(', ')}`,
			400,
		)
	}
	if (schemaVersion === 2) {
		const yaml = artifacts.find((artifact) => artifact.kind === 'nsis-yaml')
		const nsis = artifacts.find((artifact) => artifact.kind === 'nsis')
		const expectedName = channel === 'stable' ? 'latest.yml' : `${channel}.yml`
		if (
			!yaml ||
			!nsis ||
			yaml.fileName !== expectedName ||
			new URL('.', yaml.url).href !== new URL('.', nsis.url).href
		) {
			throw new AdminApiError('NSIS metadata must match channel and installer directory', 400)
		}
	}
	return artifacts
}

/** @param {string} value @param {string} name */
function assertUnsignedReleaseUrl(value, name) {
	const url = new URL(value)
	if (url.username || url.password || url.search || url.hash || url.toString() !== value) {
		throw new AdminApiError(
			`${name} must be a canonical HTTPS URL without credentials, query, or hash`,
			400,
		)
	}
}

/**
 * @param {ReleaseArtifact[]} artifacts
 * @param {string} platform
 */
function hasInstallableArtifactSet(artifacts, platform) {
	const expectedKind = platform === 'darwin' ? 'dmg' : 'nsis'
	return (
		(artifacts.length === 1 && artifacts[0]?.kind === expectedKind) ||
		(platform === 'win32' &&
			artifacts.length === 2 &&
			artifacts.some((artifact) => artifact.kind === 'nsis') &&
			artifacts.some((artifact) => artifact.kind === 'nsis-yaml'))
	)
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} manifestSignature
 * @param {string | undefined} publicKeyValue
 */
function verifyReleaseCandidate(manifest, manifestSignature, publicKeyValue) {
	const publicKey = readReleasePublicKey(publicKeyValue)
	const signature = Buffer.from(manifestSignature, 'base64')
	const verified = verify(null, Buffer.from(canonicalJson(manifest), 'utf8'), publicKey, signature)
	if (!verified) throw new AdminApiError('Release manifest signature is invalid', 400)
}

/** @param {string | undefined} publicKeyValue */
function releasePublicKeyFingerprint(publicKeyValue) {
	return createHash('sha256')
		.update(readReleasePublicKey(publicKeyValue).export({ format: 'der', type: 'spki' }))
		.digest('hex')
}

/** @param {string | undefined} publicKeyValue */
function readReleasePublicKey(publicKeyValue) {
	if (!publicKeyValue) throw new AdminApiError('Release manifest public key is not configured', 503)
	try {
		const normalized = publicKeyValue.split('\\n').join('\n')
		return normalized.includes('BEGIN PUBLIC KEY')
			? createPublicKey(normalized)
			: createPublicKey({
					key: Buffer.from(normalized, 'base64'),
					format: 'der',
					type: 'spki',
				})
	} catch {
		throw new AdminApiError('Release manifest public key is invalid', 503)
	}
}

/**
 * @param {Omit<ReleaseCandidateRecord, 'status' | 'registeredAt'> | ReleaseCandidateRecord} candidate
 */
function releaseCandidateManifest(candidate) {
	return {
		schemaVersion: candidate.schemaVersion,
		releaseId: candidate._id,
		runtime: candidate.runtime,
		channel: candidate.channel,
		version: candidate.version,
		createdAt: candidate.createdAt,
		manifestUrl: candidate.manifestUrl,
		sourceCoordinates: candidate.sourceCoordinates,
		distribution: candidate.distribution,
		tests: candidate.tests,
		artifacts: candidate.artifacts,
	}
}

/**
 * @param {unknown} value
 * @returns {ReleaseCandidateRecord | null}
 */
function normalizeReleaseCandidateRecord(value) {
	if (!isRecord(value)) return null
	try {
		const normalized = normalizeReleaseCandidateInput(
			{
				schemaVersion: value.schemaVersion,
				releaseId: value._id ?? value.id,
				runtime: value.runtime,
				channel: value.channel,
				version: value.version,
				createdAt: value.createdAt,
				manifestUrl: value.manifestUrl,
				sourceCoordinates: value.sourceCoordinates,
				distribution: value.distribution,
				tests: value.tests,
				artifacts: value.artifacts,
			},
			value.manifestUrl,
			value.manifestSignature,
		)
		const registeredAt = readString(value.registeredAt)
		if (value.status !== 'verified' || !registeredAt) return null
		return { ...normalized, status: 'verified', registeredAt }
	} catch {
		return null
	}
}

/**
 * @param {ReleaseCandidateRecord} existing
 * @param {ReleaseCandidateRecord} candidate
 */
function assertCandidateIdempotent(existing, candidate) {
	const existingPayload = canonicalJson({
		manifest: releaseCandidateManifest(existing),
		manifestSignature: existing.manifestSignature,
	})
	const candidatePayload = canonicalJson({
		manifest: releaseCandidateManifest(candidate),
		manifestSignature: candidate.manifestSignature,
	})
	if (existingPayload !== candidatePayload) {
		throw new AdminApiError('Release candidate version is immutable', 409)
	}
	return existing
}

/**
 * @param {ReleaseCandidateRecord} candidate
 */
function toReleaseCandidateView(candidate) {
	return {
		releaseId: candidate._id,
		schemaVersion: candidate.schemaVersion,
		runtime: candidate.runtime,
		version: candidate.version,
		channel: candidate.channel,
		createdAt: candidate.createdAt,
		manifestUrl: candidate.manifestUrl,
		manifestSignature: candidate.manifestSignature,
		artifacts: candidate.artifacts,
		sourceCoordinates: candidate.sourceCoordinates,
		distribution: candidate.distribution,
		tests: candidate.tests,
		status: candidate.status,
		registeredAt: candidate.registeredAt,
	}
}

/**
 * @param {unknown} value
 * @returns {ReleaseRolloutRecord | null}
 */
function normalizeReleaseRollout(value) {
	if (!isRecord(value)) return null
	const id = readString(value._id) ?? readString(value.id)
	const runtime = readRuntime(value.runtime)
	const channel = readChannel(value.channel)
	const releaseId = readString(value.releaseId)
	const status = readReleaseStatus(value.status)
	const percentage = readNonNegativeNumber(value.percentage)
	const mode = readUpdateModeOrNull(value.mode)
	const title = readString(value.title)
	const notes = typeof value.notes === 'string' ? value.notes : null
	const publishedAt = readString(value.publishedAt)
	const publishedBy = readString(value.publishedBy)
	const updatedAt = readString(value.updatedAt) ?? publishedAt
	const updatedBy = readString(value.updatedBy) ?? publishedBy
	if (
		!id ||
		!runtime ||
		!channel ||
		!releaseId ||
		!status ||
		percentage === null ||
		!ALLOWED_PERCENTAGES.has(percentage) ||
		!mode ||
		!title ||
		notes === null ||
		!publishedAt ||
		!publishedBy ||
		!updatedAt ||
		!updatedBy
	) {
		return null
	}
	const minSupportedVersion = readString(value.minSupportedVersion) ?? undefined
	if (minSupportedVersion && !SEMVER_PATTERN.test(minSupportedVersion)) return null
	return {
		_id: id,
		runtime,
		channel,
		releaseId,
		status,
		percentage,
		mode,
		minSupportedVersion,
		title,
		notes,
		publishedAt,
		publishedBy,
		updatedAt,
		updatedBy,
	}
}

/**
 * @param {ReleaseRolloutRecord} release
 */
function toReleaseRolloutView(release) {
	return {
		id: release._id,
		runtime: release.runtime,
		channel: release.channel,
		releaseId: release.releaseId,
		status: release.status,
		percentage: release.percentage,
		mode: release.mode,
		minSupportedVersion: release.minSupportedVersion,
		title: release.title,
		notes: release.notes,
		publishedAt: release.publishedAt,
		publishedBy: release.publishedBy,
		updatedAt: release.updatedAt,
	}
}

/**
 * @param {ReleaseRolloutRecord} release
 */
function releaseAuditSnapshot(release) {
	return {
		runtime: release.runtime,
		channel: release.channel,
		releaseId: release.releaseId,
		status: release.status,
		percentage: release.percentage,
		mode: release.mode,
		minSupportedVersion: release.minSupportedVersion,
		title: release.title,
		publishedAt: release.publishedAt,
		updatedAt: release.updatedAt,
	}
}

/**
 * @param {Record<string, string | undefined>} query
 */
function readReleaseListFilter(query) {
	const runtime = query.runtime === undefined ? undefined : readRuntime(query.runtime)
	const channel = query.channel === undefined ? undefined : readChannel(query.channel)
	if (query.runtime !== undefined && !runtime) throw new AdminApiError('Invalid runtime', 400)
	if (query.channel !== undefined && !channel) throw new AdminApiError('Invalid channel', 400)
	return { runtime: runtime ?? undefined, channel: channel ?? undefined }
}

/**
 * @param {'updatePolicy' | 'updateEvents'} operation
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @param {number} now
 */
function consumePublicRateLimit(operation, headers, now) {
	for (const [key, entry] of publicRateState) {
		if (entry.resetAt <= now) publicRateState.delete(key)
	}
	const ip = readClientIp(headers)
	const limits = PUBLIC_RATE_LIMITS[operation]
	const checks = [
		...(ip
			? [
					{
						key: `${operation}:ip:${createHash('sha256').update(ip, 'utf8').digest('hex')}`,
						limit: limits.perIp,
					},
				]
			: []),
		{
			key: `${operation}:global`,
			limit: limits.global,
		},
	]
	for (const check of checks) {
		const current = publicRateState.get(check.key)
		if (current && current.count >= check.limit) {
			const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
			throw new AdminApiError('Too many update requests', 429, {
				'retry-after': String(retryAfter),
			})
		}
	}
	for (const check of checks) {
		const current = publicRateState.get(check.key)
		if (current) {
			current.count += 1
			continue
		}
		while (publicRateState.size >= PUBLIC_RATE_MAX_KEYS) {
			const oldest = Array.from(publicRateState.keys()).find((key) => key.includes(':ip:'))
			if (!oldest) break
			publicRateState.delete(oldest)
		}
		publicRateState.set(check.key, { count: 1, resetAt: now + PUBLIC_RATE_WINDOW_MS })
	}
}

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 */
function readClientIp(headers) {
	const forwarded = readHeader(headers, 'x-forwarded-for')
	if (forwarded) {
		const trustedHop = forwarded
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
			.at(-1)
		if (trustedHop) return trustedHop
	}
	return readHeader(headers, 'x-real-ip')
}

/**
 * @param {string} rawBody
 * @param {number} maxBytes
 */
function parseJsonObject(rawBody, maxBytes) {
	if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) {
		throw new AdminApiError('Request body is too large', 413)
	}
	let body
	try {
		body = JSON.parse(rawBody)
	} catch {
		throw new AdminApiError('Invalid JSON body', 400)
	}
	if (!isRecord(body)) throw new AdminApiError('Request body must be an object', 400)
	return body
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} allowed
 */
function assertOnlyKeys(value, allowed) {
	const allowedSet = new Set(allowed)
	const unexpected = Object.keys(value).find((key) => !allowedSet.has(key))
	if (unexpected) throw new AdminApiError(`Unexpected field: ${unexpected}`, 400)
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} maxLength
 */
function readRequiredText(value, name, maxLength) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new AdminApiError(`${name} is required`, 400)
	}
	const text = value.trim()
	if (text.length > maxLength) throw new AdminApiError(`${name} is too long`, 400)
	return text
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function readBoundedId(value, name) {
	const id = readString(value)
	if (!id || id.length > 128 || !/^[A-Za-z0-9._:@-]+$/.test(id)) {
		throw new AdminApiError(`Invalid ${name}`, 400)
	}
	return id
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} maxLength
 */
function readIdentifier(value, name, maxLength) {
	const identifier = readString(value)
	if (!identifier || identifier.length > maxLength || !/^[A-Za-z0-9._-]+$/.test(identifier)) {
		throw new AdminApiError(`Invalid ${name}`, 400)
	}
	return identifier
}

/** @param {unknown} value @param {string} name */
function readSha256(value, name) {
	const digest = readString(value)?.toLowerCase()
	if (!digest || !/^[a-f0-9]{64}$/.test(digest)) {
		throw new AdminApiError(`${name} must be a SHA-256 hex digest`, 400)
	}
	return digest
}

/**
 * @param {{ releaseId: string, installIdHash: string, runtime: DesktopRuntime, platform: DesktopPlatform, arch: DesktopArchitecture, fromVersion: string, expiresAt: number }} payload
 * @param {string | undefined} secretValue
 */
function createReleaseEventToken(payload, secretValue) {
	const secret = releaseEventTokenSecret(secretValue)
	const encoded = Buffer.from(JSON.stringify({ schemaVersion: 1, ...payload })).toString(
		'base64url',
	)
	const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
	return `${encoded}.${signature}`
}

/**
 * @param {string} token
 * @param {{ releaseId: string, installIdHash: string, runtime: DesktopRuntime, platform: DesktopPlatform, arch: DesktopArchitecture, fromVersion: string, now: number }} expected
 * @param {string | undefined} secretValue
 */
function verifyReleaseEventToken(token, expected, secretValue) {
	const secret = releaseEventTokenSecret(secretValue)
	const segments = token.split('.')
	if (segments.length !== 2 || !segments[0] || !segments[1]) {
		throw new AdminApiError('Update event token is invalid', 401)
	}
	const actualSignature = Buffer.from(segments[1], 'base64url')
	const expectedSignature = createHmac('sha256', secret).update(segments[0]).digest()
	if (
		actualSignature.length !== expectedSignature.length ||
		!timingSafeEqual(actualSignature, expectedSignature)
	) {
		throw new AdminApiError('Update event token is invalid', 401)
	}
	let payload
	try {
		payload = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8'))
	} catch {
		throw new AdminApiError('Update event token is invalid', 401)
	}
	const expiresAt =
		isRecord(payload) && typeof payload.expiresAt === 'number' ? payload.expiresAt : null
	if (
		!isRecord(payload) ||
		payload.schemaVersion !== 1 ||
		payload.releaseId !== expected.releaseId ||
		payload.installIdHash !== expected.installIdHash ||
		payload.runtime !== expected.runtime ||
		payload.platform !== expected.platform ||
		payload.arch !== expected.arch ||
		payload.fromVersion !== expected.fromVersion ||
		!Number.isSafeInteger(expiresAt) ||
		expiresAt === null ||
		expiresAt <= expected.now ||
		expiresAt > expected.now + UPDATE_EVENT_TOKEN_TTL_MS
	) {
		throw new AdminApiError('Update event token does not match this release event', 401)
	}
}

/** @param {string | undefined} value */
function releaseEventTokenSecret(value) {
	const secret = readString(value)
	if (!secret || Buffer.byteLength(secret) < 32) {
		throw new AdminApiError('Update event token service is not configured', 503)
	}
	return secret
}

/**
 * @param {unknown} value
 */
function readUpdateEventStage(value) {
	const stage = readUpdateEventStageOrNull(value)
	if (!stage) throw new AdminApiError('stage must be check, download, or handoff', 400)
	return stage
}

/**
 * @param {unknown} value
 */
function readUpdateEventStageOrNull(value) {
	return value === 'check' || value === 'download' || value === 'handoff' ? value : null
}

/**
 * @param {UpdateEventStage} stage
 * @param {unknown} value
 * @returns {UpdateEventResult}
 */
function readUpdateEventResult(stage, value) {
	const result = readString(value)
	if (!result || !UPDATE_EVENT_RESULTS[stage].has(result)) {
		throw new AdminApiError(`Invalid ${stage} update event result`, 400)
	}
	return /** @type {UpdateEventResult} */ (result)
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function readSemver(value, name) {
	const version = readString(value)
	if (!version || !SEMVER_PATTERN.test(version)) {
		throw new AdminApiError(`Invalid ${name}`, 400)
	}
	return version
}

/**
 * @param {string} version
 */
function parseSemver(version) {
	const match = SEMVER_PATTERN.exec(version)
	if (!match) throw new AdminApiError('Invalid semantic version', 400)
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease: match[4]?.split('.') ?? [],
	}
}

/**
 * @param {unknown} value
 * @returns {DesktopPlatform | null}
 */
function readPlatform(value) {
	return value === 'darwin' || value === 'win32' ? value : null
}

/**
 * @param {unknown} value
 * @returns {DesktopArchitecture | null}
 */
function readArchitecture(value) {
	return value === 'arm64' || value === 'x64' ? value : null
}

/**
 * @param {unknown} value
 * @returns {DesktopRuntime | null}
 */
function readRuntime(value) {
	return value === 'electron' || value === 'chromium' ? value : null
}

/**
 * @param {unknown} value
 * @returns {ReleaseChannel | null}
 */
function readChannel(value) {
	return value === 'dev' || value === 'beta' || value === 'stable' ? value : null
}

/**
 * @param {unknown} value
 * @returns {UpdateMode}
 */
function readUpdateMode(value) {
	const mode = readUpdateModeOrNull(value)
	if (!mode) throw new AdminApiError('mode must be optional or mandatory', 400)
	return mode
}

/**
 * @param {unknown} value
 * @returns {UpdateMode | null}
 */
function readUpdateModeOrNull(value) {
	return value === 'optional' || value === 'mandatory' ? value : null
}

/**
 * @param {unknown} value
 * @returns {ReleaseStatus | null}
 */
function readReleaseStatus(value) {
	return value === 'active' || value === 'paused' || value === 'withdrawn' || value === 'superseded'
		? value
		: null
}

/**
 * @param {unknown} value
 */
function readAllowedPercentage(value) {
	if (typeof value !== 'number' || !ALLOWED_PERCENTAGES.has(value)) {
		throw new AdminApiError('percentage must be 1, 5, 25, 50, or 100', 400)
	}
	return value
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function readIsoTimestamp(value, name) {
	const text = readString(value)
	const timestamp = text ? Date.parse(text) : Number.NaN
	if (!Number.isFinite(timestamp)) throw new AdminApiError(`Invalid ${name}`, 400)
	return timestamp
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} maxLength
 */
function readHttpsUrl(value, name, maxLength) {
	const text = readString(value)
	if (!text || text.length > maxLength) throw new AdminApiError(`Invalid ${name}`, 400)
	let url
	try {
		url = new URL(text)
	} catch {
		throw new AdminApiError(`${name} must be a valid HTTPS URL`, 400)
	}
	if (url.protocol !== 'https:' || url.username || url.password) {
		throw new AdminApiError(`${name} must be a valid HTTPS URL`, 400)
	}
	return url.toString()
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} maxLength
 */
function readOptionalHttpsUrl(value, name, maxLength) {
	if (value === undefined || value === null || value === '') return undefined
	return readHttpsUrl(value, name, maxLength)
}

/**
 * @param {string} value
 * @param {number} expectedBytes
 */
function isBase64Digest(value, expectedBytes) {
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false
	return Buffer.from(value, 'base64').byteLength === expectedBytes
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`
	}
	return JSON.stringify(value)
}

/**
 * @param {{ headers: Headers | Record<string, string | string[] | undefined>, env: AdminApiEnv, store: AdminStore, fetchImpl?: typeof fetch }} input
 * @returns {Promise<AdminUser>}
 */
export async function authorizeAdminRequest(input) {
	const identity = await resolveCloudBaseAdminIdentity({
		headers: input.headers,
		env: input.env,
		fetchImpl: input.fetchImpl,
	})
	const admin = normalizeAdminUser(await input.store.getAdminUser(identity.uid))
	if (!admin || admin.status !== 'active') {
		throw new AdminApiError('Admin user is not allowed', 403)
	}
	if (admin.role !== 'admin' && admin.role !== 'viewer') {
		throw new AdminApiError('Admin role is invalid', 403)
	}
	return admin
}

/**
 * @param {{ headers: Headers | Record<string, string | string[] | undefined>, env: AdminApiEnv, fetchImpl?: typeof fetch }} input
 * @returns {Promise<AdminIdentity>}
 */
export async function resolveCloudBaseAdminIdentity(input) {
	const token = extractBearerToken(input.headers)
	if (!token) {
		throw new AdminApiError('Missing admin token', 401)
	}
	const url = new URL(
		`https://${input.env.cloudbaseEnvId}.api.tcloudbasegateway.com/auth/v1/token/introspect`,
	)
	url.searchParams.set('client_id', input.env.cloudbaseClientId)
	const { response, payload } = await fetchJsonWithTimeout(
		input.fetchImpl ?? fetch,
		url,
		{
			method: 'GET',
			headers: {
				authorization: `Bearer ${token}`,
				'x-device-id': 'wenxue-admin-api',
				'x-request-id': randomUUID(),
			},
		},
		input.env.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	if (!response.ok) {
		throw new AdminApiError('CloudBase admin token introspection failed', 401)
	}
	if (!isRecord(payload) || payload.active === false) {
		throw new AdminApiError('CloudBase admin token is inactive', 401)
	}
	const uid = readString(payload.sub) ?? readString(payload.uid)
	if (!uid) {
		throw new AdminApiError('CloudBase admin token has no uid', 401)
	}
	return { uid }
}

/**
 * @param {unknown[]} records
 * @param {unknown[]} users
 * @param {{ from?: number, to?: number, userId?: string, model?: string }} [filter]
 * @returns {AdminUsageSummary}
 */
export function buildAdminUsageSummary(records, users, filter = {}) {
	const filtered = records
		.map(normalizeUsageRecord)
		.filter(isUsageRecord)
		.filter((record) => matchesUsageFilter(record, filter))
		.sort((a, b) => b.ts - a.ts)
	return {
		totalInputTokens: sumBy(filtered, (record) => record.inputTokens),
		totalOutputTokens: sumBy(filtered, (record) => record.outputTokens),
		totalTokens: sumBy(filtered, (record) => record.totalTokens),
		byDay: buildBuckets(filtered, (record) => new Date(record.ts).toISOString().slice(0, 10)),
		byModel: buildBuckets(filtered, (record) => record.model),
		byUser: buildBuckets(filtered, (record) => record.uid),
		recent: filtered.slice(0, 50).map(toUsageRecordView),
		userStatus: buildUserStatus(users),
	}
}

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @returns {string | null}
 */
export function extractBearerToken(headers) {
	const value = readHeader(headers, 'authorization')
	if (!value) return null
	const match = /^Bearer\s+(.+)$/i.exec(value.trim())
	return match?.[1] ?? null
}

/** @param {UserAccount} user @param {unknown} metadata @returns {UserAccount} */
function mergeUserMetadata(user, metadata) {
	const result = { ...user }
	if (!isRecord(metadata)) return result
	for (const field of /** @type {const} */ ([
		'createdAt',
		'updatedAt',
		'firstSeenAt',
		'lastSeenAt',
	])) {
		const value = readString(metadata[field])
		if (!value || !Number.isFinite(Date.parse(value))) continue
		if (
			field === 'lastSeenAt' &&
			user.lastSeenAt &&
			Date.parse(user.lastSeenAt) > Date.parse(value)
		)
			continue
		result[field] = new Date(value).toISOString()
	}
	if (typeof metadata.note === 'string') result.note = metadata.note
	return result
}

/**
 * @param {unknown} value
 * @returns {UserAccount | null}
 */
export function normalizeUserAccount(value) {
	if (!isRecord(value)) return null
	const id = readString(value._id) ?? readString(value.uid)
	const uid = readString(value.uid) ?? id
	const active = readBoolean(value.active)
	const status = active === null ? readUserStatus(value.status) : active ? 'active' : 'disabled'
	if (!id || !uid || !status) return null
	return {
		_id: id,
		uid,
		email: readString(value.email) ?? undefined,
		nickname: readString(value.nickname) ?? undefined,
		userType: readString(value.userType) ?? undefined,
		active: status === 'active',
		status,
		firstSeenAt: readString(value.firstSeenAt) ?? undefined,
		lastSeenAt: readString(value.lastSeenAt) ?? undefined,
		createdAt: readString(value.createdAt) ?? '',
		updatedAt: readString(value.updatedAt) ?? '',
		note: readString(value.note) ?? undefined,
	}
}

/**
 * @param {unknown} value
 * @returns {AdminUser | null}
 */
function normalizeAdminUser(value) {
	if (!isRecord(value)) return null
	const id = readString(value._id)
	const role = value.role === 'admin' || value.role === 'viewer' ? value.role : null
	const status = value.status === 'active' || value.status === 'disabled' ? value.status : null
	if (!id || !role || !status) return null
	return {
		_id: id,
		role,
		status,
		displayName: readString(value.displayName) ?? undefined,
	}
}

/**
 * @param {unknown} value
 * @returns {UsageRecord | null}
 */
function normalizeUsageRecord(value) {
	if (!isRecord(value)) return null
	const id = readString(value._id)
	const uid = readString(value.uid)
	const model = readString(value.model)
	const inputTokens = readNonNegativeNumber(value.inputTokens)
	const outputTokens = readNonNegativeNumber(value.outputTokens)
	const totalTokens = readNonNegativeNumber(value.totalTokens)
	const ts = readNonNegativeNumber(value.ts)
	if (
		!id ||
		!uid ||
		!model ||
		inputTokens === null ||
		outputTokens === null ||
		totalTokens === null ||
		ts === null
	) {
		return null
	}
	return {
		_id: id,
		uid,
		model,
		inputTokens,
		outputTokens,
		totalTokens,
		latencyMs: readNonNegativeNumber(value.latencyMs) ?? 0,
		ts,
		createdAt: readString(value.createdAt) ?? undefined,
	}
}

/**
 * @param {UsageRecord | null} value
 * @returns {value is UsageRecord}
 */
function isUsageRecord(value) {
	return value !== null
}

/**
 * @param {UsageRecord} record
 * @returns {UsageRecordView}
 */
function toUsageRecordView(record) {
	return {
		id: record._id,
		ts: record.ts,
		userId: record.uid,
		model: record.model,
		inputTokens: record.inputTokens,
		outputTokens: record.outputTokens,
		totalTokens: record.totalTokens,
		latencyMs: record.latencyMs ?? 0,
	}
}

/**
 * @param {UserAccount} user
 * @param {{ inputTokens: number, outputTokens: number, totalTokens: number } | undefined} usage
 * @returns {UserAccountView}
 */
function toUserAccountView(user, usage) {
	const normalized = normalizeUserAccount(user)
	if (!normalized) {
		throw new AdminApiError('Invalid user account', 500)
	}
	return {
		userId: normalized.uid,
		email: normalized.email ?? '',
		nickname: normalized.nickname ?? '',
		userType: normalized.userType ?? '',
		status: normalized.status,
		firstSeenAt: normalized.firstSeenAt ?? normalized.createdAt ?? '',
		lastSeenAt: normalized.lastSeenAt ?? normalized.updatedAt ?? '',
		createdAt: normalized.createdAt ?? '',
		updatedAt: normalized.updatedAt ?? '',
		note: normalized.note,
		inputTokens: usage?.inputTokens ?? 0,
		outputTokens: usage?.outputTokens ?? 0,
		totalTokens: usage?.totalTokens ?? 0,
	}
}

/**
 * @param {UserAccount} user
 */
function toUserPermissionSnapshot(user) {
	return {
		status: user.status,
		note: user.note,
	}
}

/**
 * @param {string} rawBody
 */
function parseUserStatusPatch(rawBody) {
	let body
	try {
		body = JSON.parse(rawBody)
	} catch {
		throw new AdminApiError('Invalid JSON body', 400)
	}
	if (!isRecord(body)) {
		throw new AdminApiError('Invalid user status payload', 400)
	}
	const userId = readString(body.userId)
	if (!userId) {
		throw new AdminApiError('Invalid userId', 400)
	}
	const patch = /** @type {Partial<Pick<UserAccount, 'active' | 'note'>>} */ ({})
	if ('status' in body) {
		const status = readUserStatus(body.status)
		if (!status) throw new AdminApiError('Invalid user status', 400)
		patch.active = status === 'active'
	}
	if ('note' in body) {
		const note = readString(body.note)
		if (note && note.length > 500) throw new AdminApiError('note is too long', 400)
		patch.note = note ?? ''
	}
	if (patch.active === undefined && patch.note === undefined) {
		throw new AdminApiError('No user status fields provided', 400)
	}
	return {
		userId,
		patch,
		reason: readString(body.reason) ?? undefined,
	}
}

/**
 * @param {Record<string, string | undefined>} query
 */
function readUsageFilter(query) {
	return {
		from: readTimestamp(query.from),
		to: readTimestamp(query.to),
		userId: readUserId(query.userId) ?? undefined,
		model: readQueryText(query.model) ?? undefined,
	}
}

/**
 * @param {UsageRecord} record
 * @param {{ from?: number, to?: number, userId?: string, model?: string }} filter
 */
function matchesUsageFilter(record, filter) {
	if (filter.from !== undefined && record.ts < filter.from) return false
	if (filter.to !== undefined && record.ts > filter.to) return false
	if (filter.userId && record.uid !== filter.userId) return false
	if (filter.model && record.model !== filter.model) return false
	return true
}

/**
 * @param {UsageRecord[]} records
 * @param {(record: UsageRecord) => string} keyFor
 * @returns {UsageBucket[]}
 */
function buildBuckets(records, keyFor) {
	const buckets = new Map()
	for (const record of records) {
		const key = keyFor(record)
		const current = buckets.get(key) ?? {
			key,
			label: key,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
		}
		current.inputTokens += record.inputTokens
		current.outputTokens += record.outputTokens
		current.totalTokens += record.totalTokens
		buckets.set(key, current)
	}
	return Array.from(buckets.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

/**
 * @param {unknown[]} records
 */
function aggregateUsageByUser(records) {
	const map = new Map()
	for (const record of records.map(normalizeUsageRecord)) {
		if (!record) continue
		const current = map.get(record.uid) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
		current.inputTokens += record.inputTokens
		current.outputTokens += record.outputTokens
		current.totalTokens += record.totalTokens
		map.set(record.uid, current)
	}
	return map
}

/**
 * @param {unknown[]} users
 */
function buildUserStatus(users) {
	const status = { active: 0, disabled: 0, total: 0 }
	for (const user of users) {
		const normalized = normalizeUserAccount(user)
		if (!normalized) continue
		status.total += 1
		if (normalized.status === 'active') status.active += 1
		if (normalized.status === 'disabled') status.disabled += 1
	}
	return status
}

/**
 * @param {UsageRecord[]} records
 * @param {(record: UsageRecord) => number} select
 */
function sumBy(records, select) {
	return records.reduce((total, record) => total + select(record), 0)
}

/**
 * @param {unknown} value
 * @returns {UserAccountStatus | null}
 */
function readUserStatus(value) {
	if (value === 'active' || value === 'disabled') return value
	return null
}

/**
 * @param {unknown} value
 */
function readBoolean(value) {
	return typeof value === 'boolean' ? value : null
}

/**
 * @param {unknown} value
 */
function readTimestamp(value) {
	if (typeof value !== 'string' || value.trim() === '') return undefined
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * @param {unknown} value
 */
function readUserId(value) {
	const text = readString(value)
	return text && text.length <= 128 ? text : null
}

/**
 * @param {unknown} value
 */
function readQueryText(value) {
	const text = readString(value)
	return text && text.length <= 120 ? text : undefined
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function readPositiveInteger(value, fallback) {
	if (typeof value !== 'string') return fallback
	const parsed = Number(value)
	return Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : fallback
}

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @param {string[]} allowedOrigins
 */
function buildCorsHeaders(headers, allowedOrigins) {
	const origin = readHeader(headers, 'origin')
	const allowOrigin =
		origin && allowedOrigins.includes(origin)
			? origin
			: allowedOrigins.includes('*')
				? '*'
				: allowedOrigins[0]
	return {
		'access-control-allow-origin': allowOrigin ?? '',
		'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
		'access-control-allow-headers': 'authorization,content-type,idempotency-key',
		vary: 'Origin',
		'content-type': 'application/json; charset=utf-8',
	}
}

/**
 * @param {unknown} body
 * @param {number} statusCode
 * @param {Record<string, string>} headers
 */
function jsonResponse(body, statusCode, headers) {
	const responseBody = body === null ? '' : JSON.stringify(assertResponseSafe(body))
	return {
		statusCode,
		headers,
		body: responseBody,
	}
}

/**
 * @param {unknown} error
 * @param {Record<string, string>} headers
 */
function errorResponse(error, headers) {
	const status = error instanceof AdminApiError ? error.status : 500
	const message = error instanceof AdminApiError ? error.message : 'Admin API internal error'
	const responseHeaders =
		error instanceof AdminApiError ? { ...headers, ...error.headers } : headers
	return jsonResponse({ error: { message, status } }, status, responseHeaders)
}

/**
 * @param {unknown} value
 */
function assertResponseSafe(value) {
	if (containsSensitiveKey(value)) {
		throw new AdminApiError('Admin API response contains sensitive fields', 500)
	}
	return value
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function containsSensitiveKey(value) {
	if (Array.isArray(value)) return value.some(containsSensitiveKey)
	if (!isRecord(value)) return false
	return Object.entries(value).some(
		([key, nested]) => SENSITIVE_PATTERN.test(key) || containsSensitiveKey(nested),
	)
}

/**
 * @param {string} value
 */
function normalizePath(value) {
	return value.replace(/\/+$/, '') || '/'
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {URL} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchJsonWithTimeout(fetchImpl, url, init, timeoutMs) {
	const controller = new AbortController()
	let timedOut = false
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timeout
	const timeoutFailure = new Promise((_, reject) => {
		timeout = setTimeout(() => {
			timedOut = true
			controller.abort()
			reject(new AdminApiError('CloudBase authentication request timed out', 504))
		}, timeoutMs)
	})
	try {
		const requestAndBody = (async () => {
			const response = await fetchImpl(url, { ...init, signal: controller.signal })
			const payload = await readJsonOrNull(response)
			return { response, payload }
		})()
		return await Promise.race([requestAndBody, timeoutFailure])
	} catch (error) {
		if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
			throw new AdminApiError('CloudBase authentication request timed out', 504)
		}
		throw error
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

/** @param {Response} response */
async function readJsonOrNull(response) {
	const text = await response.text()
	if (!text) {
		if (response.ok) {
			throw new AdminApiError('CloudBase authentication returned an empty JSON response', 502)
		}
		return null
	}
	try {
		return /** @type {unknown} */ (JSON.parse(text))
	} catch {
		if (response.ok) {
			throw new AdminApiError('CloudBase authentication returned invalid JSON', 502)
		}
		return null
	}
}

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @param {string} name
 */
function readHeader(headers, name) {
	if (headers instanceof Headers) return headers.get(name)
	const lower = name.toLowerCase()
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lower) {
			return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
		}
	}
	return null
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
 * @param {unknown} value
 */
function readNonNegativeNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
