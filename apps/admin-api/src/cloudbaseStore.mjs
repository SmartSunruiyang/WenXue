/** @typedef {import('./adminApi.mjs').AdminStore} AdminStore */

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const ADMIN_USERS_COLLECTION = 'admin_users'
const USER_ACCOUNTS_COLLECTION = 'user_accounts'
const USER_PERMISSION_AUDIT_COLLECTION = 'user_permission_audit'
const TOKEN_USAGE_COLLECTION = 'token_usage'

/**
 * @param {{ envId: string, apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} input
 * @returns {AdminStore}
 */
export function createCloudBaseAdminStore(input) {
	const client = createCloudBaseNoSqlClient(input)

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
		 * @param {{ query?: Record<string, unknown>, order?: { field: string, direction: 'asc' | 'desc' }[], limit?: number }} options
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
	}
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
