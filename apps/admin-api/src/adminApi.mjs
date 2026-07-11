import { randomUUID } from 'node:crypto'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_USAGE_LIMIT = 5000
const DEFAULT_USER_LIMIT = 500
const SENSITIVE_PATTERN = /prompt|content|api[_-]?key|authorization|bearer|raw.?token/i

/** @typedef {'admin' | 'viewer'} AdminRole */
/** @typedef {'active' | 'disabled'} AdminUserStatus */
/** @typedef {'active' | 'disabled'} UserAccountStatus */
/** @typedef {{ uid: string }} AdminIdentity */
/** @typedef {{ _id: string, role: AdminRole, status: AdminUserStatus, displayName?: string }} AdminUser */
/** @typedef {{ _id: string, uid: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number, latencyMs?: number, ts: number, createdAt?: string }} UsageRecord */
/** @typedef {{ _id: string, uid: string, active: boolean, status: UserAccountStatus, firstSeenAt?: string, lastSeenAt?: string, createdAt?: string, updatedAt?: string, note?: string }} UserAccount */
/** @typedef {{ userId: string, status: UserAccountStatus, firstSeenAt: string, lastSeenAt: string, createdAt: string, updatedAt: string, note?: string, inputTokens: number, outputTokens: number, totalTokens: number }} UserAccountView */
/** @typedef {{ totalInputTokens: number, totalOutputTokens: number, totalTokens: number, byDay: UsageBucket[], byModel: UsageBucket[], byUser: UsageBucket[], recent: UsageRecordView[], userStatus: { active: number, disabled: number, total: number } }} AdminUsageSummary */
/** @typedef {{ key: string, label: string, inputTokens: number, outputTokens: number, totalTokens: number }} UsageBucket */
/** @typedef {{ id: string, ts: number, userId: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number, latencyMs: number }} UsageRecordView */
/** @typedef {{ getAdminUser(uid: string): Promise<unknown | null>, listUsageRecords(filter: { status?: UserAccountStatus, from?: number, to?: number, limit?: number, userId?: string, model?: string }): Promise<unknown[]>, listUserAccounts(filter: { status?: UserAccountStatus, q?: string, limit?: number }): Promise<unknown[]>, getUserAccount(userId: string): Promise<unknown | null>, updateUserAccount(userId: string, patch: Partial<Pick<UserAccount, 'active' | 'updatedAt' | 'note'>>): Promise<unknown | null>, createUserPermissionAudit(record: Record<string, unknown>): Promise<void> }} AdminStore */
/** @typedef {{ cloudbaseEnvId: string, cloudbaseClientId: string, cloudbaseAdminApiKey?: string, allowedOrigins?: string[], requestTimeoutMs?: number }} AdminApiEnv */

export class AdminApiError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 */
	constructor(message, status = 500) {
		super(message)
		this.name = 'AdminApiError'
		this.status = status
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
		const admin = await authorizeAdminRequest({
			headers: input.headers,
			env: input.env,
			store: input.store,
			fetchImpl: input.fetchImpl,
		})
		const method = input.method.toUpperCase()
		const path = normalizePath(input.path)

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
			const users = await input.store.listUserAccounts({ limit: DEFAULT_USER_LIMIT })
			return jsonResponse(buildAdminUsageSummary(records, users, filter), 200, corsHeaders)
		}

		if (path === '/admin/v1/users' && method === 'GET') {
			const status = readUserStatus(input.query?.status)
			const users = await input.store.listUserAccounts({
				status: status ?? undefined,
				q: readQueryText(input.query?.q),
				limit: readPositiveInteger(input.query?.limit, DEFAULT_USER_LIMIT),
			})
			const records = await input.store.listUsageRecords({ limit: DEFAULT_USAGE_LIMIT })
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
			if (admin.role !== 'admin') {
				throw new AdminApiError('Admin role is required', 403)
			}
			const payload = parseUserStatusPatch(input.rawBody ?? '{}')
			const current = normalizeUserAccount(await input.store.getUserAccount(payload.userId))
			if (!current) {
				throw new AdminApiError('User account not found', 404)
			}
			const updatedAt = new Date(input.now ? input.now() : Date.now()).toISOString()
			const patch = {
				...payload.patch,
				updatedAt,
			}
			const merged = normalizeUserAccount({ ...current, ...patch })
			if (!merged) {
				throw new AdminApiError('Invalid user account update', 400)
			}
			const persisted = normalizeUserAccount(
				await input.store.updateUserAccount(payload.userId, patch),
			)
			const user = persisted ?? merged
			await input.store.createUserPermissionAudit({
				_id: randomUUID(),
				userId: payload.userId,
				adminUid: admin._id,
				before: toUserPermissionSnapshot(current),
				after: toUserPermissionSnapshot(user),
				reason: payload.reason,
				createdAt: updatedAt,
			})
			return jsonResponse(
				{
					user: toUserAccountView(user, undefined),
				},
				200,
				corsHeaders,
			)
		}

		throw new AdminApiError('Admin API route not found', 404)
	} catch (error) {
		return errorResponse(error, corsHeaders)
	}
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
	const response = await fetchWithTimeout(
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
	const payload = /** @type {unknown} */ (await response.json())
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
		limit: readPositiveInteger(query.limit, DEFAULT_USAGE_LIMIT),
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
		'access-control-allow-methods': 'GET,PATCH,OPTIONS',
		'access-control-allow-headers': 'authorization,content-type',
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
	return jsonResponse({ error: { message, status } }, status, headers)
}

/**
 * @param {unknown} value
 */
function assertResponseSafe(value) {
	const serialized = JSON.stringify(value)
	if (SENSITIVE_PATTERN.test(serialized)) {
		throw new AdminApiError('Admin API response contains sensitive fields', 500)
	}
	return value
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
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal })
	} finally {
		clearTimeout(timeout)
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
