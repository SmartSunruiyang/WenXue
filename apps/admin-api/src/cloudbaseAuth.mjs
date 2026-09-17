import { createHash, createHmac } from 'node:crypto'

import { AdminApiError } from './adminApi.mjs'

const TCB_ENDPOINT = 'https://tcb.tencentcloudapi.com'
const AUTH_PAGE_SIZE = 100
const DEFAULT_TIMEOUT_MS = 15_000

/** @typedef {import('./adminApi.mjs').UserAccount & { username?: string, displayName?: string, userType?: string }} AuthUser */
/** @typedef {{ listUsers(): Promise<AuthUser[]>, getUser(uid: string): Promise<AuthUser | null>, setUserStatus(uid: string, active: boolean): Promise<AuthUser> }} AuthDirectory */
/** @typedef {{ envId: string, secretId?: string, secretKey?: string, token?: string, region?: string, fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => number }} AuthDirectoryOptions */

/** @param {AuthDirectoryOptions} input @returns {AuthDirectory} */
export function createCloudBaseAuthDirectory(input) {
	/** @param {string} uid */
	async function getUser(uid) {
		const users = await listUsers(input, [uid])
		if (users.length > 1 || (users.length === 1 && users[0].uid !== uid)) {
			throw new AdminApiError('CloudBase Auth returned an unexpected user identity', 502)
		}
		return users[0] ?? null
	}

	return {
		listUsers: () => listUsers(input),
		getUser,
		async setUserStatus(uid, active) {
			const result = await requestAuth(input, 'ModifyUser', {
				EnvId: input.envId,
				Uid: uid,
				UserStatus: active ? 'ACTIVE' : 'BLOCKED',
			})
			if (!isRecord(result.Data) || result.Data.Success !== true) {
				throw new AdminApiError(
					'CloudBase Auth did not confirm the user update; refresh and retry',
					502,
				)
			}
			const user = await getUser(uid)
			if (!user || user.active !== active) {
				throw new AdminApiError(
					'CloudBase Auth user status could not be verified; refresh and retry',
					502,
				)
			}
			return user
		},
	}
}

/** @param {AuthDirectoryOptions} input @param {string[]} [uids] @returns {Promise<AuthUser[]>} */
async function listUsers(input, uids) {
	/** @type {AuthUser[]} */
	const users = []
	const seen = new Set()
	let expectedTotal
	for (let pageNo = 1; ; pageNo += 1) {
		const response = await requestAuth(input, 'DescribeUserList', {
			EnvId: input.envId,
			PageNo: pageNo,
			PageSize: AUTH_PAGE_SIZE,
			...(uids ? { UidList: uids } : {}),
		})
		const data = response.Data
		if (
			!isRecord(data) ||
			typeof data.Total !== 'number' ||
			!Number.isSafeInteger(data.Total) ||
			data.Total < 0 ||
			!Array.isArray(data.UserList)
		) {
			throw new AdminApiError('CloudBase Auth returned an invalid user list', 502)
		}
		expectedTotal ??= data.Total
		if (
			data.Total !== expectedTotal ||
			data.UserList.length !== Math.min(AUTH_PAGE_SIZE, expectedTotal - users.length) ||
			(uids && data.Total > uids.length)
		) {
			throw new AdminApiError(
				'CloudBase Auth user list is incomplete or changed; refresh and retry',
				502,
			)
		}
		for (const rawUser of data.UserList) {
			const user = normalizeAuthUser(rawUser)
			if (seen.has(user.uid)) {
				throw new AdminApiError(
					'CloudBase Auth returned duplicate user identities; refresh and retry',
					502,
				)
			}
			seen.add(user.uid)
			users.push(user)
		}
		if (users.length === expectedTotal) return users
	}
}

/** @param {unknown} value @returns {AuthUser} */
function normalizeAuthUser(value) {
	if (!isRecord(value) || !readString(value.Uid)) {
		throw new AdminApiError('CloudBase Auth returned an invalid user identity', 502)
	}
	if (value.UserStatus !== 'ACTIVE' && value.UserStatus !== 'BLOCKED') {
		throw new AdminApiError('CloudBase Auth returned an unsupported user status', 502)
	}
	const uid = readString(value.Uid)
	const username = readString(value.Name)
	const displayName = readString(value.NickName)
	const userType = readString(value.Type)
	const lastSeenAt = readTimestamp(value.LastLoginTime)
	return {
		_id: uid,
		uid,
		active: value.UserStatus === 'ACTIVE',
		status: value.UserStatus === 'ACTIVE' ? 'active' : 'disabled',
		...(username ? { username } : {}),
		...(displayName ? { displayName } : {}),
		...(userType ? { userType } : {}),
		...(lastSeenAt ? { lastSeenAt } : {}),
	}
}

/**
 * @param {AuthDirectoryOptions} input
 * @param {'DescribeUserList' | 'ModifyUser'} action
 * @param {Record<string, unknown>} payload
 * @returns {Promise<Record<string, unknown>>}
 */
async function requestAuth(input, action, payload) {
	const secretId = readString(input.secretId)
	const secretKey = readString(input.secretKey)
	if (!readString(input.envId) || !secretId || !secretKey) {
		throw new AdminApiError('CloudBase Auth management credentials are not configured', 503)
	}
	const controller = new AbortController()
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timeout
	const timedOut = new Promise((_, reject) => {
		timeout = setTimeout(() => {
			controller.abort()
			reject(new AdminApiError('CloudBase Auth request timed out; refresh and retry', 504))
		}, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
	})
	try {
		const requestAndBody = (async () => {
			const response = await (input.fetchImpl ?? fetch)(TCB_ENDPOINT, {
				...signedRequest(input, secretId, secretKey, action, payload),
				signal: controller.signal,
			})
			if (!response.ok) {
				throw new AdminApiError(
					'CloudBase Auth request failed; verify service permissions and retry',
					502,
				)
			}
			const body = /** @type {unknown} */ (await response.json())
			if (!isRecord(body) || !isRecord(body.Response)) {
				throw new AdminApiError('CloudBase Auth returned an invalid response', 502)
			}
			if (body.Response.Error !== undefined) {
				throw new AdminApiError(
					'CloudBase Auth request failed; verify service permissions and retry',
					502,
				)
			}
			return body.Response
		})()
		return await Promise.race([requestAndBody, timedOut])
	} catch (error) {
		if (error instanceof AdminApiError) throw error
		if (controller.signal.aborted) {
			throw new AdminApiError('CloudBase Auth request timed out; refresh and retry', 504)
		}
		throw new AdminApiError(
			'CloudBase Auth request failed or returned invalid JSON; refresh and retry',
			502,
		)
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

/**
 * @param {AuthDirectoryOptions} input
 * @param {string} secretId
 * @param {string} secretKey
 * @param {string} action
 * @param {Record<string, unknown>} payload
 * @returns {RequestInit}
 */
function signedRequest(input, secretId, secretKey, action, payload) {
	const body = JSON.stringify(payload)
	const timestamp = Math.floor((input.now?.() ?? Date.now()) / 1000)
	const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
	const contentType = 'application/json; charset=utf-8'
	const canonicalHeaders = `content-type:${contentType}\nhost:tcb.tencentcloudapi.com\n`
	const signedHeaders = 'content-type;host'
	const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join(
		'\n',
	)
	const scope = `${date}/tcb/tc3_request`
	const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, sha256(canonicalRequest)].join(
		'\n',
	)
	const dateKey = hmac(`TC3${secretKey}`, date)
	const signingKey = hmac(hmac(dateKey, 'tcb'), 'tc3_request')
	const signature = hmac(signingKey, stringToSign).toString('hex')
	return {
		method: 'POST',
		headers: {
			authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
			'content-type': contentType,
			host: 'tcb.tencentcloudapi.com',
			'x-tc-action': action,
			'x-tc-region': input.region ?? 'ap-shanghai',
			'x-tc-timestamp': String(timestamp),
			'x-tc-version': '2018-06-08',
			...(input.token ? { 'x-tc-token': input.token } : {}),
		},
		body,
	}
}

/** @param {string} value */
function sha256(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** @param {string | Buffer} key @param {string} value */
function hmac(key, value) {
	return createHmac('sha256', key).update(value, 'utf8').digest()
}

/** @param {unknown} value */
function readString(value) {
	return typeof value === 'string' ? value.trim() : ''
}

/** @param {unknown} value */
function readTimestamp(value) {
	if (typeof value !== 'string' || !value.trim()) return ''
	const time = Date.parse(value)
	return Number.isFinite(time) ? new Date(time).toISOString() : ''
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
