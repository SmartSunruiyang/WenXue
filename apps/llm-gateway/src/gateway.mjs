import { createHash, createHmac, randomUUID } from 'node:crypto'

export const DASHSCOPE_CHAT_COMPLETIONS_URL =
	'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const TOKEN_USAGE_COLLECTION = 'token_usage'
const USER_ACCOUNTS_COLLECTION = 'user_accounts'
const TENCENTCLOUD_TCB_ENDPOINT = 'https://tcb.tencentcloudapi.com'
const TENCENTCLOUD_TCB_SERVICE = 'tcb'
const TENCENTCLOUD_TCB_VERSION = '2018-06-08'

/** @typedef {{ inputTokens: number, outputTokens: number, totalTokens: number }} TokenUsage */
/** @typedef {{ uid: string }} GatewayUser */
/** @typedef {{ [key: string]: unknown }} JsonRecord */
/** @typedef {{ _id: string, ts: number, uid: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number, latencyMs: number, requestId: string, createdAt: string }} CloudUsageRecord */
/** @typedef {{ _id: string, uid: string, active: boolean, status: 'active' | 'disabled', createdAt: string, updatedAt: string, note?: string }} UserAccount */
/** @typedef {{ cloudbaseEnvId: string, cloudbaseRegion?: string, cloudbaseUsageApiKey?: string, tencentCloudSecretId?: string, tencentCloudSecretKey?: string, tencentCloudToken?: string, requestTimeoutMs?: number }} LauncherRegistrationEnv */

export class GatewayError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 */
	constructor(message, status) {
		super(message)
		this.name = 'GatewayError'
		this.status = status
	}
}

export function clearAuthorizationCache() {
	// Kept as a compatibility hook for tests and warm instances. User status is checked per request.
}

/**
 * @param {{
 *   rawBody: string,
 *   env: LauncherRegistrationEnv,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} input
 */
export async function handleLauncherRegistration(input) {
	const body = parseLauncherRegistrationBody(input.rawBody)
	const created = await createCloudBaseExternalUser({
		username: body.username,
		password: body.password,
		env: input.env,
		fetchImpl: input.fetchImpl,
		now: input.now,
	})
	await createActiveUserAccount({
		uid: created.uid,
		envId: input.env.cloudbaseEnvId,
		apiKey: input.env.cloudbaseUsageApiKey ?? '',
		fetchImpl: input.fetchImpl,
		timeoutMs: input.env.requestTimeoutMs,
		now: input.now,
	})
	return {
		ok: true,
		userId: created.uid,
		username: body.username,
	}
}

/**
 * @param {{
 *   username: string,
 *   password: string,
 *   env: LauncherRegistrationEnv,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} input
 */
export async function createCloudBaseExternalUser(input) {
	const secretId = readString(input.env.tencentCloudSecretId)
	const secretKey = readString(input.env.tencentCloudSecretKey)
	if (!secretId || !secretKey) {
		throw new GatewayError('CloudBase 注册服务未配置 Tencent Cloud API 凭证', 500)
	}

	const request = buildTencentCloudSignedRequest({
		secretId,
		secretKey,
		token: readString(input.env.tencentCloudToken) ?? undefined,
		region: input.env.cloudbaseRegion ?? 'ap-shanghai',
		action: 'CreateUser',
		payload: {
			EnvId: input.env.cloudbaseEnvId,
			Name: input.username,
			NickName: input.username,
			Password: input.password,
			Type: 'externalUser',
			Description: 'WenXue launcher user',
			UserStatus: 'ACTIVE',
		},
		now: input.now,
	})
	const response = await fetchWithTimeout(
		input.fetchImpl ?? fetch,
		TENCENTCLOUD_TCB_ENDPOINT,
		request,
		input.env.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	const payload = /** @type {unknown} */ (await safeJson(response))
	const responseBody = isRecord(payload) && isRecord(payload.Response) ? payload.Response : null
	const apiError = responseBody && isRecord(responseBody.Error) ? responseBody.Error : null
	if (!response.ok || apiError) {
		throw createCloudBaseUserCreationError(response, apiError, payload)
	}
	const uid = readCloudBaseUserId(responseBody)
	if (uid) return { uid }

	const lookedUpUid = await lookupCloudBaseExternalUserUid({
		username: input.username,
		env: input.env,
		fetchImpl: input.fetchImpl,
		now: input.now,
	})
	if (!lookedUpUid) {
		throw new GatewayError('CloudBase 创建用户成功但未返回用户 id', 502)
	}
	return { uid: lookedUpUid }
}

/**
 * @param {{
 *   username: string,
 *   env: LauncherRegistrationEnv,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} input
 */
async function lookupCloudBaseExternalUserUid(input) {
	const secretId = readString(input.env.tencentCloudSecretId)
	const secretKey = readString(input.env.tencentCloudSecretKey)
	if (!secretId || !secretKey) {
		throw new GatewayError('CloudBase 注册服务未配置 Tencent Cloud API 凭证', 500)
	}

	const request = buildTencentCloudSignedRequest({
		secretId,
		secretKey,
		token: readString(input.env.tencentCloudToken) ?? undefined,
		region: input.env.cloudbaseRegion ?? 'ap-shanghai',
		action: 'DescribeUserList',
		payload: {
			EnvId: input.env.cloudbaseEnvId,
			Name: input.username,
			PageNo: 1,
			PageSize: 10,
		},
		now: input.now,
	})
	const response = await fetchWithTimeout(
		input.fetchImpl ?? fetch,
		TENCENTCLOUD_TCB_ENDPOINT,
		request,
		input.env.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	const payload = /** @type {unknown} */ (await safeJson(response))
	const responseBody = isRecord(payload) && isRecord(payload.Response) ? payload.Response : null
	const apiError = responseBody && isRecord(responseBody.Error) ? responseBody.Error : null
	if (!response.ok || apiError) {
		throw createCloudBaseUserLookupError(response, apiError, payload)
	}

	const data =
		responseBody && isRecord(responseBody.Data)
			? responseBody.Data
			: isRecord(payload) && isRecord(payload.Data)
				? payload.Data
				: null
	const list = data && Array.isArray(data.UserList) ? data.UserList : []
	for (const item of list) {
		if (!isRecord(item)) continue
		const name = readString(item.Name)
		if (name && name !== input.username) continue
		const uid = readCloudBaseUserId(item)
		if (uid) return uid
	}
	return null
}

/**
 * @param {{
 *   uid: string,
 *   envId: string,
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   now?: () => number,
 * }} input
 */
async function createActiveUserAccount(input) {
	if (!input.apiKey) {
		throw new GatewayError('CLOUDBASE_USAGE_API_KEY is not configured', 500)
	}
	const timestamp = new Date(input.now ? input.now() : Date.now()).toISOString()
	const record = {
		_id: input.uid,
		uid: input.uid,
		active: true,
		firstSeenAt: timestamp,
		lastSeenAt: timestamp,
		createdAt: timestamp,
		updatedAt: timestamp,
	}
	const response = await fetchWithTimeout(
		input.fetchImpl ?? fetch,
		collectionDocumentsUrl(input.envId, USER_ACCOUNTS_COLLECTION),
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ data: [record] }),
		},
		input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	if (!response.ok && response.status !== 409) {
		throw new GatewayError(`CloudBase user account create failed with ${response.status}`, 502)
	}
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

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @returns {string | null}
 */
export function extractBearerToken(headers) {
	const value = readHeader(headers, 'authorization')
	if (!value) {
		return null
	}
	const match = /^bearer\s+(.+)$/i.exec(value.trim())
	return match?.[1] ?? null
}

/**
 * @param {unknown} body
 * @param {string} dashscopeApiKey
 */
export function buildDashScopeRequest(body, dashscopeApiKey) {
	if (!isRecord(body)) {
		throw new GatewayError('Request body must be a JSON object', 400)
	}
	if (!dashscopeApiKey) {
		throw new GatewayError('DASHSCOPE_API_KEY is not configured', 500)
	}

	const nextBody = cloneJsonObject(body)
	if (nextBody.stream === true) {
		const streamOptions = isRecord(nextBody.stream_options) ? nextBody.stream_options : {}
		nextBody.stream_options = {
			...streamOptions,
			include_usage: true,
		}
	}

	return {
		url: DASHSCOPE_CHAT_COMPLETIONS_URL,
		headers: {
			authorization: `Bearer ${dashscopeApiKey}`,
			'content-type': 'application/json',
		},
		body: nextBody,
	}
}

/**
 * @param {{
 *   record: JsonRecord,
 *   envId: string,
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} input
 */
export async function writeUsageRecord(input) {
	if (!input.apiKey) {
		throw new GatewayError('CLOUDBASE_USAGE_API_KEY is not configured', 500)
	}
	assertUsageRecordSafe(input.record)
	const url = collectionDocumentsUrl(input.envId, TOKEN_USAGE_COLLECTION)
	const response = await fetchWithTimeout(
		input.fetchImpl ?? fetch,
		url,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ data: [input.record] }),
		},
		input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	if (!response.ok) {
		throw new GatewayError(`CloudBase usage write failed with ${response.status}`, 502)
	}
	return response.json()
}

/**
 * @param {{
 *   uid: string,
 *   envId: string,
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   limit?: number,
 * }} input
 * @returns {Promise<CloudUsageRecord[]>}
 */
export async function readUsageRecords(input) {
	if (!input.apiKey) {
		throw new GatewayError('CLOUDBASE_USAGE_API_KEY is not configured', 500)
	}
	const url = collectionDocumentsUrl(input.envId, TOKEN_USAGE_COLLECTION)
	url.searchParams.set('query', JSON.stringify({ uid: input.uid }))
	url.searchParams.set('order', JSON.stringify([{ field: 'ts', direction: 'desc' }]))
	url.searchParams.set('limit', String(input.limit ?? 500))
	const response = await fetchWithTimeout(
		input.fetchImpl ?? fetch,
		url,
		{
			method: 'GET',
			headers: {
				authorization: `Bearer ${input.apiKey}`,
			},
		},
		input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	if (!response.ok) {
		throw new GatewayError(`CloudBase usage query failed with ${response.status}`, 502)
	}
	const payload = /** @type {unknown} */ (await response.json())
	const list =
		isRecord(payload) && Array.isArray(payload.list)
			? payload.list
			: isRecord(payload) && Array.isArray(payload.data)
				? payload.data
				: []
	return list.flatMap((item) => {
		const record = normalizeCloudUsageRecord(item)
		return record ? [record] : []
	})
}

/**
 * @param {CloudUsageRecord[]} records
 */
export function buildUsageSummary(records) {
	const safeRecords = records.map(toTokenUsageRecord).sort((a, b) => b.ts - a.ts)
	return {
		totalInputTokens: sumTokenRecords(safeRecords, 'inputTokens'),
		totalOutputTokens: sumTokenRecords(safeRecords, 'outputTokens'),
		totalTokens: sumTokenRecords(safeRecords, 'totalTokens'),
		estimatedCostCny: roundCurrency(sumTokenRecords(safeRecords, 'estimatedCostCny')),
		byBrowser: bucketTokenRecords(safeRecords, (record) => record.browserId),
		byModel: bucketTokenRecords(safeRecords, (record) => record.model),
		daily: bucketTokenRecords(safeRecords, (record) =>
			new Date(record.ts).toISOString().slice(0, 10),
		),
		recent: safeRecords.slice(0, 20),
	}
}

/**
 * @param {string} frame
 * @returns {TokenUsage | null}
 */
export function extractUsageFromSseFrame(frame) {
	let found = null
	for (const line of frame.split(/\r?\n/)) {
		if (!line.startsWith('data:')) {
			continue
		}
		const data = line.slice(5).trim()
		if (!data || data === '[DONE]') {
			continue
		}
		try {
			const payload = JSON.parse(data)
			if (isRecord(payload)) {
				found = normalizeUsage(payload.usage) ?? found
			}
		} catch {
			continue
		}
	}
	return found
}

/**
 * @param {{
 *   uid: string,
 *   model: string,
 *   usage: TokenUsage,
 *   latencyMs: number,
 *   requestId: string,
 *   now?: () => number,
 * }} input
 */
export function buildUsageRecord(input) {
	const ts = input.now ? input.now() : Date.now()
	return {
		_id: `${input.uid}:${input.requestId}:${ts}`,
		ts,
		uid: input.uid,
		model: input.model,
		inputTokens: input.usage.inputTokens,
		outputTokens: input.usage.outputTokens,
		totalTokens: input.usage.totalTokens,
		latencyMs: input.latencyMs,
		requestId: input.requestId,
		createdAt: new Date(ts).toISOString(),
	}
}

/**
 * @param {unknown} record
 */
export function assertUsageRecordSafe(record) {
	const text = JSON.stringify(record).toLowerCase()
	const forbidden = [
		'prompt',
		'content',
		'authorization',
		'bearer',
		'api_key',
		'apikey',
		'refresh_token',
		'refreshtoken',
		'sk-',
	]
	for (const word of forbidden) {
		if (text.includes(word)) {
			throw new GatewayError(`Usage record contains forbidden field: ${word}`, 500)
		}
	}
}

/**
 * @param {{
 *   headers: Headers | Record<string, string | string[] | undefined>,
 *   env: { cloudbaseEnvId: string, cloudbaseClientId: string, requestTimeoutMs?: number },
 *   fetchImpl?: typeof fetch,
 * }} input
 * @returns {Promise<GatewayUser>}
 */
export async function resolveCloudBaseUser(input) {
	const token = extractBearerToken(input.headers)
	if (!token) {
		throw new GatewayError('登录已过期/无权限，请回到桌面端登录或重新启动浏览器。', 401)
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
				'x-device-id': 'wenxue-llm-gateway',
				'x-request-id': randomUUID(),
			},
		},
		input.env.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	if (!response.ok) {
		throw new GatewayError('登录已过期/无权限，请回到桌面端登录或重新启动浏览器。', 401)
	}
	const payload = /** @type {unknown} */ (await response.json())
	if (!isRecord(payload) || payload.active === false) {
		throw new GatewayError('登录已过期/无权限，请回到桌面端登录或重新启动浏览器。', 401)
	}
	const uid = readString(payload.sub) ?? readString(payload.uid)
	if (!uid) {
		throw new GatewayError('登录已过期/无权限，请回到桌面端登录或重新启动浏览器。', 401)
	}
	return { uid }
}

/**
 * @param {{
 *   headers: Headers | Record<string, string | string[] | undefined>,
 *   env: { cloudbaseEnvId: string, cloudbaseClientId: string, cloudbaseUsageApiKey: string, requestTimeoutMs?: number },
 *   fetchImpl?: typeof fetch,
 * }} input
 * @returns {Promise<GatewayUser>}
 */
export async function authorizeUserRequest(input) {
	const user = await resolveCloudBaseUser(input)
	const account = await readUserAccount({
		uid: user.uid,
		envId: input.env.cloudbaseEnvId,
		apiKey: input.env.cloudbaseUsageApiKey,
		fetchImpl: input.fetchImpl,
		timeoutMs: input.env.requestTimeoutMs,
	})
	if (account.status !== 'active') {
		throw new GatewayError('无权限：当前用户未启用或已被禁用。', 403)
	}
	return user
}

/**
 * @param {{
 *   uid: string,
 *   envId: string,
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} input
 * @returns {Promise<UserAccount>}
 */
async function readUserAccount(input) {
	if (!input.apiKey) {
		throw new GatewayError('CLOUDBASE_USAGE_API_KEY is not configured', 500)
	}
	const url = collectionDocumentsUrl(input.envId, USER_ACCOUNTS_COLLECTION)
	url.searchParams.set('query', JSON.stringify({ _id: input.uid }))
	url.searchParams.set('limit', '1')
	const response = await fetchWithTimeout(
		input.fetchImpl ?? fetch,
		url,
		{
			method: 'GET',
			headers: {
				authorization: `Bearer ${input.apiKey}`,
			},
		},
		input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	if (!response.ok) {
		throw new GatewayError(`CloudBase user account query failed with ${response.status}`, 502)
	}
	const payload = /** @type {unknown} */ (await response.json())
	const list =
		isRecord(payload) && Array.isArray(payload.list)
			? payload.list
			: isRecord(payload) && Array.isArray(payload.data)
				? payload.data
				: []
	const account = normalizeUserAccount(list[0])
	if (!account) {
		throw new GatewayError('无权限：当前用户未启用或已被禁用。', 403)
	}
	return account
}

/**
 * @param {{
 *   headers: Headers | Record<string, string | string[] | undefined>,
 *   rawBody: string,
 *   sse?: {
 *     closed: boolean,
 *     send: (chunk: string) => unknown,
 *     end: () => unknown,
 *     on?: (event: 'close', cb: () => void) => unknown,
 *   },
 *   env: {
 *     cloudbaseEnvId: string,
 *     cloudbaseClientId: string,
 *     cloudbaseClientSecret: string,
 *     cloudbaseUsageApiKey: string,
 *     dashscopeApiKey: string,
 *     cloudbaseRegion?: string,
 *     requestTimeoutMs?: number,
 *   },
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} input
 */
export async function handleChatCompletions(input) {
	const now = input.now ?? Date.now
	const startedAt = now()
	const requestId = randomUUID()
	const body = parseRequestBody(input.rawBody)
	const user = await authorizeUserRequest({
		headers: input.headers,
		env: input.env,
		fetchImpl: input.fetchImpl,
	})
	const dashScopeRequest = buildDashScopeRequest(body, input.env.dashscopeApiKey)
	const upstream = await fetchWithTimeout(
		input.fetchImpl ?? fetch,
		dashScopeRequest.url,
		{
			method: 'POST',
			headers: dashScopeRequest.headers,
			body: JSON.stringify(dashScopeRequest.body),
		},
		input.env.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	)
	if (!upstream.ok) {
		throw new GatewayError(`DashScope upstream failed with ${upstream.status}`, upstream.status)
	}

	if (body.stream === true) {
		if (!input.sse) {
			throw new GatewayError('SSE context is required for streamed requests', 500)
		}
		const usage = await proxySseResponse(upstream, input.sse)
		const usageRecord = buildMeasuredUsageRecord({
			body,
			uid: user.uid,
			usage,
			startedAt,
			now,
			requestId,
		})
		const usagePersisted = await tryWriteUsageRecord({
			record: usageRecord,
			envId: input.env.cloudbaseEnvId,
			apiKey: input.env.cloudbaseUsageApiKey,
			fetchImpl: input.fetchImpl,
			timeoutMs: input.env.requestTimeoutMs,
		})
		return { usageRecord, usagePersisted, upstreamStatus: upstream.status }
	}

	const payload = await upstream.json()
	const usageRecord = buildMeasuredUsageRecord({
		body,
		uid: user.uid,
		usage: isRecord(payload) ? normalizeUsage(payload.usage) : null,
		startedAt,
		now,
		requestId,
	})
	const usagePersisted = await tryWriteUsageRecord({
		record: usageRecord,
		envId: input.env.cloudbaseEnvId,
		apiKey: input.env.cloudbaseUsageApiKey,
		fetchImpl: input.fetchImpl,
		timeoutMs: input.env.requestTimeoutMs,
	})
	return { responseBody: payload, usageRecord, usagePersisted, upstreamStatus: upstream.status }
}

/**
 * @param {Parameters<typeof writeUsageRecord>[0]} input
 * @returns {Promise<boolean>}
 */
async function tryWriteUsageRecord(input) {
	try {
		await writeUsageRecord(input)
		return true
	} catch (error) {
		console.warn(
			'wenxue llm gateway usage persistence failed',
			error instanceof Error ? error.message : 'unknown error',
		)
		return false
	}
}

/**
 * @param {{
 *   headers: Headers | Record<string, string | string[] | undefined>,
 *   env: {
 *     cloudbaseEnvId: string,
 *     cloudbaseClientId: string,
 *     cloudbaseClientSecret: string,
 *     cloudbaseUsageApiKey: string,
 *     dashscopeApiKey: string,
 *     cloudbaseRegion?: string,
 *     requestTimeoutMs?: number,
 *   },
 *   fetchImpl?: typeof fetch,
 * }} input
 */
export async function handleUsageSummary(input) {
	const user = await authorizeUserRequest({
		headers: input.headers,
		env: input.env,
		fetchImpl: input.fetchImpl,
	})
	const records = await readUsageRecords({
		uid: user.uid,
		envId: input.env.cloudbaseEnvId,
		apiKey: input.env.cloudbaseUsageApiKey,
		fetchImpl: input.fetchImpl,
		timeoutMs: input.env.requestTimeoutMs,
	})
	return buildUsageSummary(records)
}

/**
 * @param {unknown} value
 * @returns {TokenUsage | null}
 */
export function normalizeUsage(value) {
	if (!isRecord(value)) {
		return null
	}
	const inputTokens =
		readNumber(value.prompt_tokens) ??
		readNumber(value.input_tokens) ??
		readNumber(value.inputTokens)
	const outputTokens =
		readNumber(value.completion_tokens) ??
		readNumber(value.output_tokens) ??
		readNumber(value.outputTokens)
	const totalTokens = readNumber(value.total_tokens) ?? readNumber(value.totalTokens)
	if (inputTokens === null || outputTokens === null || totalTokens === null) {
		return null
	}
	return { inputTokens, outputTokens, totalTokens }
}

/**
 * @param {Response} upstream
 * @param {{ closed: boolean, send: (chunk: string) => unknown, end: () => unknown, on?: (event: 'close', cb: () => void) => unknown }} sse
 * @returns {Promise<TokenUsage | null>}
 */
async function proxySseResponse(upstream, sse) {
	if (!upstream.body) {
		throw new GatewayError('DashScope stream response has no body', 502)
	}
	const reader = upstream.body.getReader()
	const decoder = new TextDecoder()
	let usage = null
	let closed = false
	sse.on?.('close', () => {
		closed = true
		reader.cancel().catch(() => {})
	})

	while (!closed) {
		const { value, done } = await reader.read()
		if (done) {
			break
		}
		const chunk = decoder.decode(value, { stream: true })
		usage = extractUsageFromSseFrame(chunk) ?? usage
		if (!sse.closed) {
			sse.send(chunk)
		}
	}
	const trailing = decoder.decode()
	if (trailing && !sse.closed) {
		usage = extractUsageFromSseFrame(trailing) ?? usage
		sse.send(trailing)
	}
	if (!sse.closed) {
		sse.end()
	}
	return usage
}

/**
 * @param {{ body: JsonRecord, uid: string, usage: TokenUsage | null, startedAt: number, now: () => number, requestId: string }} input
 */
function buildMeasuredUsageRecord(input) {
	const finishedAt = input.now()
	if (!input.usage) {
		throw new GatewayError('DashScope usage is missing from upstream response', 502)
	}
	const record = buildUsageRecord({
		uid: input.uid,
		model: readString(input.body.model) ?? 'unknown',
		usage: input.usage,
		latencyMs: finishedAt - input.startedAt,
		requestId: input.requestId,
		now: () => finishedAt,
	})
	assertUsageRecordSafe(record)
	return record
}

/**
 * @param {string} rawBody
 * @returns {{ username: string, password: string }}
 */
function parseLauncherRegistrationBody(rawBody) {
	const body = parseRequestBody(rawBody)
	const username = readTrimmedString(body.username)
	const password = readTrimmedString(body.password)
	if (!username || !password) {
		throw new GatewayError('用户名和密码不能为空', 400)
	}
	return { username, password }
}

/**
 * @param {string} rawBody
 * @returns {JsonRecord}
 */
function parseRequestBody(rawBody) {
	try {
		const parsed = JSON.parse(rawBody)
		if (isRecord(parsed)) {
			return parsed
		}
	} catch {
		throw new GatewayError('Request body must be valid JSON', 400)
	}
	throw new GatewayError('Request body must be a JSON object', 400)
}

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @param {string} name
 */
function readHeader(headers, name) {
	if (headers instanceof Headers) {
		return headers.get(name)
	}
	const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
	const value = found?.[1]
	if (Array.isArray(value)) {
		return value[0] ?? null
	}
	return value ?? null
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
 * @param {Response} response
 * @param {JsonRecord | null} apiError
 * @param {unknown} payload
 */
function createCloudBaseUserCreationError(response, apiError, payload) {
	const code = apiError
		? (readString(apiError.Code) ?? readString(apiError.code) ?? readString(apiError.errorCode))
		: null
	const message = apiError
		? (readString(apiError.Message) ?? readString(apiError.message))
		: readTencentCloudPayloadMessage(payload)
	const text = `${code ?? ''} ${message ?? ''}`.toLowerCase()
	if (/already|exist|duplicate|resourceinuse|conflict/.test(text)) {
		return new GatewayError('用户名已存在', 409)
	}
	if (/quota|limit|insufficient|exceed|exceeded|配额|上限/.test(text)) {
		return new GatewayError('CloudBase 用户配额已满，无法创建新账号', 507)
	}
	const status = response.ok ? 502 : response.status
	const suffix = message ? `：${message}` : response.ok ? '' : ` (${response.status})`
	return new GatewayError(`CloudBase 创建用户失败${suffix}`, status)
}

/**
 * @param {Response} response
 * @param {JsonRecord | null} apiError
 * @param {unknown} payload
 */
function createCloudBaseUserLookupError(response, apiError, payload) {
	const message = apiError
		? (readString(apiError.Message) ?? readString(apiError.message))
		: readTencentCloudPayloadMessage(payload)
	const status = response.ok ? 502 : response.status
	const suffix = message ? `：${message}` : response.ok ? '' : ` (${response.status})`
	return new GatewayError(`CloudBase 用户查询失败${suffix}`, status)
}

/**
 * @param {unknown} payload
 */
function readTencentCloudPayloadMessage(payload) {
	if (!isRecord(payload)) return null
	if (isRecord(payload.error)) {
		return readString(payload.error.message) ?? readString(payload.error.Message)
	}
	if (isRecord(payload.Response) && isRecord(payload.Response.Error)) {
		return readString(payload.Response.Error.Message) ?? readString(payload.Response.Error.message)
	}
	return readString(payload.message) ?? readString(payload.Message)
}

/**
 * @param {Response} response
 */
async function safeJson(response) {
	const text = await response.text()
	if (!text) return null
	try {
		return JSON.parse(text)
	} catch {
		return { message: text }
	}
}

/**
 * @param {string} value
 */
function sha256Hex(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * @param {string | Buffer} key
 * @param {string} value
 */
function hmacSha256(key, value) {
	return createHmac('sha256', key).update(value, 'utf8').digest()
}

/**
 * @param {unknown} value
 * @returns {value is JsonRecord}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {UserAccount | null}
 */
function normalizeUserAccount(value) {
	if (!isRecord(value)) {
		return null
	}
	const id = readString(value._id) ?? readString(value.uid)
	const uid = readString(value.uid) ?? id
	const active = readBoolean(value.active)
	const status =
		active === null
			? value.status === 'disabled'
				? 'disabled'
				: value.status === 'active'
					? 'active'
					: null
			: active
				? 'active'
				: 'disabled'
	const createdAt = readString(value.createdAt) ?? ''
	const updatedAt = readString(value.updatedAt) ?? ''
	const note = readString(value.note) ?? undefined
	if (!id || !uid || !status) {
		return null
	}
	return {
		_id: id,
		uid,
		active: status === 'active',
		status,
		createdAt,
		updatedAt,
		note,
	}
}

/**
 * @param {JsonRecord} value
 * @returns {JsonRecord}
 */
function cloneJsonObject(value) {
	return JSON.parse(JSON.stringify(value))
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function readString(value) {
	return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * @param {unknown} value
 */
function readBoolean(value) {
	return typeof value === 'boolean' ? value : null
}

/**
 * @param {JsonRecord | null} value
 */
function readCloudBaseUserId(value) {
	if (!value) return null
	return (
		readString(value.Uid) ??
		readString(value.UserId) ??
		readString(value.uid) ??
		readString(value.userId)
	)
}

/**
 * @param {unknown} value
 */
function readTrimmedString(value) {
	if (typeof value !== 'string') {
		return null
	}
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : null
}

/**
 * @param {unknown} value
 * @returns {CloudUsageRecord | null}
 */
function normalizeCloudUsageRecord(value) {
	if (!isRecord(value)) {
		return null
	}
	const id = readString(value._id)
	const uid = readString(value.uid)
	const model = readString(value.model)
	const inputTokens = readEjsonNumber(value.inputTokens)
	const outputTokens = readEjsonNumber(value.outputTokens)
	const totalTokens = readEjsonNumber(value.totalTokens)
	const latencyMs = readEjsonNumber(value.latencyMs) ?? 0
	const ts = readEjsonNumber(value.ts)
	const requestId = readString(value.requestId) ?? ''
	const createdAt =
		readString(value.createdAt) ?? (typeof ts === 'number' ? new Date(ts).toISOString() : '')
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
		ts,
		uid,
		model,
		inputTokens,
		outputTokens,
		totalTokens,
		latencyMs,
		requestId,
		createdAt,
	}
}

/**
 * @param {CloudUsageRecord} record
 */
function toTokenUsageRecord(record) {
	return {
		id: record.requestId ? `${record.requestId}:${record.ts}` : `usage:${record.ts}`,
		ts: record.ts,
		browserId: 'cloud',
		model: record.model,
		inputTokens: record.inputTokens,
		outputTokens: record.outputTokens,
		totalTokens: record.totalTokens,
		estimatedCostCny: 0,
	}
}

/**
 * @param {Array<ReturnType<typeof toTokenUsageRecord>>} records
 * @param {keyof ReturnType<typeof toTokenUsageRecord>} key
 */
function sumTokenRecords(records, key) {
	return records.reduce((total, record) => {
		const value = record[key]
		return typeof value === 'number' ? total + value : total
	}, 0)
}

/**
 * @param {Array<ReturnType<typeof toTokenUsageRecord>>} records
 * @param {(record: ReturnType<typeof toTokenUsageRecord>) => string} keyOf
 */
function bucketTokenRecords(records, keyOf) {
	const buckets = new Map()
	for (const record of records) {
		const key = keyOf(record)
		const current = buckets.get(key) ?? {
			key,
			label: key,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			estimatedCostCny: 0,
		}
		current.inputTokens += record.inputTokens
		current.outputTokens += record.outputTokens
		current.totalTokens += record.totalTokens
		current.estimatedCostCny = roundCurrency(current.estimatedCostCny + record.estimatedCostCny)
		buckets.set(key, current)
	}
	return Array.from(buckets.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readEjsonNumber(value) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}
	if (!isRecord(value)) {
		return null
	}
	const encoded =
		readString(value.$numberInt) ??
		readString(value.$numberLong) ??
		readString(value.$numberDouble) ??
		readString(value.$numberDecimal)
	if (!encoded) {
		return null
	}
	const parsed = Number(encoded)
	return Number.isFinite(parsed) ? parsed : null
}

/**
 * @param {number} value
 */
function roundCurrency(value) {
	return Math.round(value * 10000) / 10000
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string | URL} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetchImpl(url, {
			...init,
			signal: controller.signal,
		})
	} catch (error) {
		if (isAbortError(error)) {
			throw new GatewayError('Upstream request timed out', 504)
		}
		throw error
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * @param {unknown} error
 */
function isAbortError(error) {
	return error instanceof Error && error.name === 'AbortError'
}
