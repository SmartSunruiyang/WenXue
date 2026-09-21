import { createHash, createHmac } from 'node:crypto'

import { AdminApiError } from './adminApi.mjs'

const TENCENTCLOUD_TCB_ENDPOINT = 'https://tcb.tencentcloudapi.com'
const TENCENTCLOUD_TCB_SERVICE = 'tcb'
const TENCENTCLOUD_TCB_VERSION = '2018-06-08'
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 10_000

/** @typedef {Record<string, unknown>} JsonRecord */
/** @typedef {{ envId: string, region?: string, secretId?: string, secretKey?: string, token?: string, fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => number }} AuthDirectoryConfig */

/** @param {AuthDirectoryConfig} input */
export function createCloudBaseAuthDirectory(input) {
	/** @param {string} uid @param {number} [timeoutMs] */
	async function getUser(uid, timeoutMs) {
		const data = await callUserApi(
			{ ...input, timeoutMs: timeoutMs ?? input.timeoutMs },
			'DescribeUserList',
			{
				UidList: [uid],
				PageNo: 1,
				PageSize: PAGE_SIZE,
			},
		)
		const users = readUserList(data)
		if (users.some((user) => user.uid !== uid) || users.length > 1 || data.Total !== users.length) {
			throw new AdminApiError('CloudBase Auth returned a mismatched user', 502)
		}
		return users[0] ?? null
	}

	return {
		async listUsers() {
			/** @type {import('./adminApi.mjs').UserAccount[]} */
			const users = []
			const seen = new Set()
			let expectedTotal
			for (let pageNo = 1; ; pageNo += 1) {
				const data = await callUserApi(input, 'DescribeUserList', {
					PageNo: pageNo,
					PageSize: PAGE_SIZE,
				})
				const page = readUserList(data)
				expectedTotal ??= Number(data.Total)
				if (
					data.Total !== expectedTotal ||
					page.length !== Math.min(PAGE_SIZE, expectedTotal - users.length)
				) {
					throw new AdminApiError(
						'CloudBase Auth user list is incomplete or changed; refresh and retry',
						502,
					)
				}
				for (const user of page) {
					if (seen.has(user.uid)) {
						throw new AdminApiError('CloudBase Auth returned inconsistent pagination', 502)
					}
					seen.add(user.uid)
					users.push(user)
				}
				if (users.length >= Number(data.Total)) return users
				if (page.length === 0) {
					throw new AdminApiError('CloudBase Auth returned an incomplete user list', 502)
				}
			}
		},
		getUser,
		/** @param {string} uid @param {boolean} active */
		async updateUserStatus(uid, active) {
			const data = await callUserApi(input, 'ModifyUser', {
				Uid: uid,
				UserStatus: active ? 'ACTIVE' : 'BLOCKED',
			})
			if (data.Success !== true) {
				throw new AdminApiError('CloudBase Auth did not confirm the user status change', 502)
			}
			const user = await getUser(uid)
			if (!user || user.active !== active) {
				throw new AdminApiError(
					'CloudBase Auth user status could not be verified; refresh and retry',
					502,
				)
			}
		},
	}
}

/** @param {JsonRecord} data */
function readUserList(data) {
	if (
		!Array.isArray(data.UserList) ||
		!Number.isSafeInteger(data.Total) ||
		Number(data.Total) < 0
	) {
		throw new AdminApiError('CloudBase Auth returned an invalid user list', 502)
	}
	return data.UserList.map(readAuthUser)
}

/** @param {unknown} value @returns {import('./adminApi.mjs').UserAccount} */
function readAuthUser(value) {
	if (
		!isRecord(value) ||
		typeof value.Uid !== 'string' ||
		!value.Uid ||
		(value.UserStatus !== 'ACTIVE' && value.UserStatus !== 'BLOCKED')
	) {
		throw new AdminApiError('CloudBase Auth returned an invalid user', 502)
	}
	const lastLoginTime =
		typeof value.LastLoginTime === 'string' ? Date.parse(value.LastLoginTime) : NaN
	return {
		...(Number.isFinite(lastLoginTime)
			? { lastSeenAt: new Date(lastLoginTime).toISOString() }
			: {}),
		_id: value.Uid,
		uid: value.Uid,
		active: value.UserStatus === 'ACTIVE',
		status: value.UserStatus === 'ACTIVE' ? 'active' : 'disabled',
		email: typeof value.Email === 'string' ? value.Email : '',
		nickname: typeof value.NickName === 'string' ? value.NickName : '',
		userType: typeof value.Type === 'string' ? value.Type : '',
	}
}

/** @param {AuthDirectoryConfig} input @param {'DescribeUserList' | 'ModifyUser'} action @param {JsonRecord} payload */
async function callUserApi(input, action, payload) {
	if (!input.secretId || !input.secretKey) {
		throw new AdminApiError('CloudBase Auth management credentials are not configured', 503)
	}
	const request = buildTencentCloudSignedRequest({
		secretId: input.secretId,
		secretKey: input.secretKey,
		token: input.token,
		region: input.region ?? 'ap-shanghai',
		action,
		payload: { EnvId: input.envId, ...payload },
		now: input.now,
	})
	const controller = new AbortController()
	const timeoutMs =
		Number.isFinite(input.timeoutMs) && Number(input.timeoutMs) > 0
			? Math.min(Number(input.timeoutMs), REQUEST_TIMEOUT_MS)
			: REQUEST_TIMEOUT_MS
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer
	const timeout = new Promise(
		/** @param {(value: never) => void} _ */ (_, reject) => {
			timer = setTimeout(() => {
				controller.abort()
				reject(new AdminApiError('CloudBase Auth management request timed out', 504))
			}, timeoutMs)
		},
	)
	try {
		return await Promise.race([
			(async () => {
				const response = await (input.fetchImpl ?? fetch)(TENCENTCLOUD_TCB_ENDPOINT, {
					...request,
					signal: controller.signal,
				})
				const result = /** @type {unknown} */ (await response.json())
				const body = isRecord(result) && isRecord(result.Response) ? result.Response : null
				if (!response.ok || !body || body.Error || !isRecord(body.Data)) {
					throw new AdminApiError('CloudBase Auth management request failed', 502)
				}
				return body.Data
			})(),
			timeout,
		])
	} catch (error) {
		if (error instanceof AdminApiError) throw error
		throw new AdminApiError('CloudBase Auth management request failed', 502)
	} finally {
		clearTimeout(timer)
	}
}

/** @param {string} value */
function sha256Hex(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** @param {string | Buffer} key @param {string} value */
function hmacSha256(key, value) {
	return createHmac('sha256', key).update(value, 'utf8').digest()
}

/** @param {unknown} value @returns {value is JsonRecord} */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {{
 *   secretId: string,
 *   secretKey: string,
 *   token?: string,
 *   region: string,
 *   action: string,
 *   payload: JsonRecord,
 *   now?: () => number,
 * }} input
 * @returns {RequestInit}
 */
export function buildTencentCloudSignedRequest(input) {
	const endpoint = new URL(TENCENTCLOUD_TCB_ENDPOINT)
	const payload = JSON.stringify(input.payload)
	const timestamp = Math.floor((input.now?.() ?? Date.now()) / 1000)
	const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
	const contentType = 'application/json; charset=utf-8'
	const canonicalHeaders = `content-type:${contentType}\nhost:${endpoint.host}\n`
	const signedHeaders = 'content-type;host'
	const hashedPayload = sha256Hex(payload)
	const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join(
		'\n',
	)
	const credentialScope = `${date}/${TENCENTCLOUD_TCB_SERVICE}/tc3_request`
	const stringToSign = [
		'TC3-HMAC-SHA256',
		String(timestamp),
		credentialScope,
		sha256Hex(canonicalRequest),
	].join('\n')
	const secretDate = hmacSha256(`TC3${input.secretKey}`, date)
	const secretService = hmacSha256(secretDate, TENCENTCLOUD_TCB_SERVICE)
	const secretSigning = hmacSha256(secretService, 'tc3_request')
	const signature = hmacSha256(secretSigning, stringToSign).toString('hex')
	const authorization = [
		'TC3-HMAC-SHA256',
		`Credential=${input.secretId}/${credentialScope}`,
		`SignedHeaders=${signedHeaders}`,
		`Signature=${signature}`,
	]
	const authorizationHeader = `${authorization[0]} ${authorization.slice(1).join(', ')}`

	/** @type {Record<string, string>} */
	const headers = {
		authorization: authorizationHeader,
		'content-type': contentType,
		host: endpoint.host,
		'x-tc-action': input.action,
		'x-tc-region': input.region,
		'x-tc-timestamp': String(timestamp),
		'x-tc-version': TENCENTCLOUD_TCB_VERSION,
	}
	if (input.token) {
		headers['x-tc-token'] = input.token
	}
	return {
		method: 'POST',
		headers,
		body: payload,
	}
}
