import { randomUUID } from 'node:crypto'

export const DASHSCOPE_CHAT_COMPLETIONS_URL =
	'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const MAX_CHAT_BODY_BYTES = 8 * 1024 * 1024
const MAX_CHAT_MESSAGES = 200
const MAX_CHAT_OUTPUT_TOKENS = 32_768
const MAX_SSE_FRAME_BYTES = 1024 * 1024
const ALLOWED_CHAT_MODELS = new Set(['qwen3.7-max', 'qwen3.7-plus'])
const BROWSER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const ACTIVATION_TIMEOUT_MS = 10_000
const TOKEN_USAGE_COLLECTION = 'token_usage'
const TOKEN_PRICING_VERSION = 'qwen3.7-list-2026-09-22'
const COST_UNITS_PER_CNY = 10_000_000
const PLUS_STANDARD_INPUT_LIMIT = 256_000
const PLUS_STANDARD_PRICES = { input: 2, output: 8, cached: 0.4, creation: 2.5, explicit: 0.2 }
const PLUS_LONG_INPUT_PRICES = { input: 6, output: 24, cached: 1.2, creation: 7.5, explicit: 0.6 }
const MAX_PRICES = { input: 12, output: 36, cached: 2.4, creation: 15, explicit: 1.2 }

/** @typedef {'implicit' | 'explicit'} CacheMode */
/** @typedef {{ inputTokens: number, outputTokens: number, totalTokens: number, cachedInputTokens?: number, cacheCreationInputTokens?: number }} TokenUsage */
/** @typedef {{ uid: string }} GatewayUser */
/** @typedef {(uid: string, timeoutMs: number) => Promise<{ uid: string, active: boolean } | null>} AuthUserLookup */
/** @typedef {{ [key: string]: unknown }} JsonRecord */
/** @typedef {TokenUsage & { _id: string, ts: number, uid: string, browserId?: string, model: string, cacheMode?: CacheMode, estimatedCostCny?: number, pricingVersion?: string, latencyMs: number, requestId: string, createdAt: string }} CloudUsageRecord */

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
 * Activate the authenticated CloudBase user only after the desktop has successfully signed in.
 * The access token is the source of truth for the real uid assigned by CloudBase.
 *
 * @param {{
 *   headers: Headers | Record<string, string | string[] | undefined>,
 *   env: { cloudbaseEnvId: string, cloudbaseClientId: string, requestTimeoutMs?: number },
 *   getAuthUser?: AuthUserLookup,
 *   fetchImpl?: typeof fetch,
 * }} input
 */
export async function handleLauncherActivation(input) {
	const user = await resolveCloudBaseUser({
		headers: input.headers,
		env: {
			...input.env,
			requestTimeoutMs: activationTimeoutMs(input.env.requestTimeoutMs),
		},
		fetchImpl: input.fetchImpl,
		getAuthUser: input.getAuthUser,
	})
	return { ok: true, userId: user.uid }
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
	const { response, payload } = await fetchJsonWithTimeout(
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
	return payload
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
	const requestedLimit =
		typeof input.limit === 'number' && Number.isSafeInteger(input.limit) && input.limit > 0
			? input.limit
			: null
	const records = []
	let scanned = 0
	/** @type {{ ts: number, id: string } | null} */
	let before = null
	while (requestedLimit === null || scanned < requestedLimit) {
		const pageLimit = Math.min(500, requestedLimit === null ? 500 : requestedLimit - scanned)
		const url = collectionDocumentsUrl(input.envId, TOKEN_USAGE_COLLECTION)
		const baseQuery = { uid: input.uid }
		const query = before
			? {
					$and: [
						baseQuery,
						{
							$or: [{ ts: { $lt: before.ts } }, { ts: before.ts, _id: { $lt: before.id } }],
						},
					],
				}
			: baseQuery
		url.searchParams.set('query', JSON.stringify(query))
		url.searchParams.set(
			'order',
			JSON.stringify([
				{ field: 'ts', direction: 'desc' },
				{ field: '_id', direction: 'desc' },
			]),
		)
		url.searchParams.set('limit', String(pageLimit))
		const { response, payload } = await fetchJsonWithTimeout(
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
		const page =
			isRecord(payload) && Array.isArray(payload.list)
				? payload.list
				: isRecord(payload) && Array.isArray(payload.data)
					? payload.data
					: []
		records.push(
			...page.flatMap((item) => {
				const record = normalizeCloudUsageRecord(item)
				return record ? [record] : []
			}),
		)
		scanned += page.length
		if (page.length < pageLimit) break
		const cursorRecord = normalizeCloudUsageRecord(page.at(-1))
		if (!cursorRecord) {
			throw new GatewayError('CloudBase usage query returned an invalid page cursor', 502)
		}
		before = { ts: cursorRecord.ts, id: cursorRecord._id }
	}
	return records
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
 *   browserId?: string,
 *   model: string,
 *   usage: TokenUsage,
 *   cacheMode?: CacheMode,
 *   latencyMs: number,
 *   requestId: string,
 *   now?: () => number,
 * }} input
 */
export function buildUsageRecord(input) {
	const ts = input.now ? input.now() : Date.now()
	const cacheMode =
		input.cacheMode ?? ((input.usage.cacheCreationInputTokens ?? 0) > 0 ? 'explicit' : 'implicit')
	return {
		_id: `${input.uid}:${input.requestId}:${ts}`,
		ts,
		uid: input.uid,
		...(input.browserId === undefined ? {} : { browserId: input.browserId }),
		model: input.model,
		inputTokens: input.usage.inputTokens,
		outputTokens: input.usage.outputTokens,
		totalTokens: input.usage.totalTokens,
		cachedInputTokens: input.usage.cachedInputTokens ?? 0,
		cacheCreationInputTokens: input.usage.cacheCreationInputTokens ?? 0,
		cacheMode,
		estimatedCostCny: estimateTokenCostCny(input.model, input.usage, cacheMode),
		pricingVersion: TOKEN_PRICING_VERSION,
		latencyMs: input.latencyMs,
		requestId: input.requestId,
		createdAt: new Date(ts).toISOString(),
	}
}

/**
 * @param {string} model
 * @param {TokenUsage} usage
 * @param {CacheMode} [cacheMode]
 */
export function estimateTokenCostCny(model, usage, cacheMode = 'implicit') {
	const prices =
		model === 'qwen3.7-plus'
			? usage.inputTokens <= PLUS_STANDARD_INPUT_LIMIT
				? PLUS_STANDARD_PRICES
				: PLUS_LONG_INPUT_PRICES
			: model === 'qwen3.7-max'
				? MAX_PRICES
				: null
	if (!prices) return 0

	const cachedTokens = usage.cachedInputTokens ?? 0
	const creationTokens = usage.cacheCreationInputTokens ?? 0
	const ordinaryTokens = usage.inputTokens - cachedTokens - creationTokens
	const cachedPrice =
		cacheMode === 'explicit' || creationTokens > 0 ? prices.explicit : prices.cached
	// Tenths of CNY per million tokens yield exact integer units of 0.0000001 CNY.
	const costUnits =
		ordinaryTokens * Math.round(prices.input * 10) +
		cachedTokens * Math.round(cachedPrice * 10) +
		creationTokens * Math.round(prices.creation * 10) +
		usage.outputTokens * Math.round(prices.output * 10)
	return costUnits / COST_UNITS_PER_CNY
}

/**
 * @param {unknown} record
 */
export function assertUsageRecordSafe(record) {
	const fields = isRecord(record) ? { ...record } : record
	if (isRecord(fields) && fields.browserId !== undefined) {
		if (typeof fields.browserId !== 'string' || !BROWSER_ID_PATTERN.test(fields.browserId)) {
			throw new GatewayError('Usage record contains invalid browserId', 500)
		}
		// Browser IDs are validated metadata; values such as task-1 contain the key-like substring sk-.
		delete fields.browserId
	}
	const text = JSON.stringify(fields).toLowerCase()
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
 *   getAuthUser?: AuthUserLookup,
 *   fetchImpl?: typeof fetch,
 * }} input
 * @returns {Promise<GatewayUser>}
 */
export async function resolveCloudBaseUser(input) {
	const startedAt = Date.now()
	const timeoutMs = input.env.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
	const token = extractBearerToken(input.headers)
	if (!token) {
		throw new GatewayError('登录已过期/无权限，请回到桌面端登录或重新启动浏览器。', 401)
	}
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
				'x-device-id': 'wenxue-llm-gateway',
				'x-request-id': randomUUID(),
			},
		},
		timeoutMs,
	)
	if (!response.ok) {
		throw new GatewayError('登录已过期/无权限，请回到桌面端登录或重新启动浏览器。', 401)
	}
	if (!isRecord(payload)) {
		throw new GatewayError('登录已过期/无权限，请回到桌面端登录或重新启动浏览器。', 401)
	}
	const uid = readString(payload.sub) ?? readString(payload.uid)
	if (!uid) {
		throw new GatewayError('登录已过期/无权限，请回到桌面端登录或重新启动浏览器。', 401)
	}
	if (!Object.hasOwn(payload, 'status')) {
		if (!input.getAuthUser) {
			throw new GatewayError('暂时无法确认账号状态，请稍后重试。', 503)
		}
		const remainingMs = timeoutMs - (Date.now() - startedAt)
		if (remainingMs <= 0) throw new GatewayError('Upstream request timed out', 504)
		let authUser
		try {
			authUser = await input.getAuthUser(uid, remainingMs)
		} catch {
			throw new GatewayError('暂时无法确认账号状态，请稍后重试。', 503)
		}
		if (authUser && authUser.uid !== uid) {
			throw new GatewayError('暂时无法确认账号状态，请稍后重试。', 503)
		}
		if (!authUser || authUser.active !== true) {
			throw new GatewayError('无权限：当前用户未启用或已被禁用。', 403)
		}
	} else if (readString(payload.status) !== 'ACTIVE') {
		throw new GatewayError('无权限：当前用户未启用或已被禁用。', 403)
	}
	return { uid }
}

/**
 * @param {{
 *   headers: Headers | Record<string, string | string[] | undefined>,
 *   env: { cloudbaseEnvId: string, cloudbaseClientId: string, cloudbaseUsageApiKey: string, requestTimeoutMs?: number },
 *   getAuthUser?: AuthUserLookup,
 *   fetchImpl?: typeof fetch,
 * }} input
 * @returns {Promise<GatewayUser>}
 */
export async function authorizeUserRequest(input) {
	return resolveCloudBaseUser(input)
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
 *   getAuthUser?: AuthUserLookup,
 * }} input
 */
export async function handleChatCompletions(input) {
	const now = input.now ?? Date.now
	const startedAt = now()
	const requestId = randomUUID()
	if (new TextEncoder().encode(input.rawBody).byteLength > MAX_CHAT_BODY_BYTES) {
		throw new GatewayError('Chat request body is too large', 413)
	}
	const body = parseRequestBody(input.rawBody)
	assertChatRequestBody(body)
	const browserId = readBrowserId(input.headers)
	const user = await authorizeUserRequest({
		headers: input.headers,
		env: input.env,
		fetchImpl: input.fetchImpl,
		getAuthUser: input.getAuthUser,
	})
	const dashScopeRequest = buildDashScopeRequest(body, input.env.dashscopeApiKey)
	const requestInit = {
		method: 'POST',
		headers: dashScopeRequest.headers,
		body: JSON.stringify(dashScopeRequest.body),
	}
	const requestTimeoutMs = input.env.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

	if (body.stream === true) {
		const sse = input.sse
		if (!sse) {
			throw new GatewayError('SSE context is required for streamed requests', 500)
		}
		const { response: upstream, value: usage } = await fetchAndConsumeWithTimeout(
			input.fetchImpl ?? fetch,
			dashScopeRequest.url,
			requestInit,
			requestTimeoutMs,
			async (response, control) => {
				assertDashScopeResponseOk(response)
				return proxySseResponse(response, sse, control)
			},
		)
		const usageRecord = buildMeasuredUsageRecord({
			body,
			uid: user.uid,
			browserId,
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

	const { response: upstream, value: payload } = await fetchAndConsumeWithTimeout(
		input.fetchImpl ?? fetch,
		dashScopeRequest.url,
		requestInit,
		requestTimeoutMs,
		async (response) => {
			assertDashScopeResponseOk(response)
			return response.json()
		},
	)
	const usageRecord = buildMeasuredUsageRecord({
		body,
		uid: user.uid,
		browserId,
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

/** @param {JsonRecord} body */
function assertChatRequestBody(body) {
	const model = readString(body.model)
	if (!model || !ALLOWED_CHAT_MODELS.has(model)) {
		throw new GatewayError('Unsupported chat model', 400)
	}
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		throw new GatewayError('Chat messages must be a non-empty array', 400)
	}
	if (body.messages.length > MAX_CHAT_MESSAGES) {
		throw new GatewayError(`Chat messages exceed the ${MAX_CHAT_MESSAGES} item limit`, 413)
	}
	if (body.stream !== undefined && typeof body.stream !== 'boolean') {
		throw new GatewayError('Chat stream must be a boolean', 400)
	}
	const maxTokens = body.max_tokens
	if (
		maxTokens !== undefined &&
		(typeof maxTokens !== 'number' ||
			!Number.isSafeInteger(maxTokens) ||
			maxTokens < 1 ||
			maxTokens > MAX_CHAT_OUTPUT_TOKENS)
	) {
		throw new GatewayError(`Chat max_tokens must be from 1 to ${MAX_CHAT_OUTPUT_TOKENS}`, 400)
	}
}

/** @param {Response} response */
function assertDashScopeResponseOk(response) {
	if (!response.ok) {
		throw new GatewayError(`DashScope upstream failed with ${response.status}`, response.status)
	}
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
 *   getAuthUser?: AuthUserLookup,
 * }} input
 */
export async function handleUsageSummary(input) {
	const user = await authorizeUserRequest({
		headers: input.headers,
		env: input.env,
		fetchImpl: input.fetchImpl,
		getAuthUser: input.getAuthUser,
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
		readTokenCount(value.prompt_tokens) ??
		readTokenCount(value.input_tokens) ??
		readTokenCount(value.inputTokens)
	const outputTokens =
		readTokenCount(value.completion_tokens) ??
		readTokenCount(value.output_tokens) ??
		readTokenCount(value.outputTokens)
	const totalTokens = readTokenCount(value.total_tokens) ?? readTokenCount(value.totalTokens)
	if (inputTokens === null || outputTokens === null || totalTokens === null) {
		return null
	}
	const details = value.prompt_tokens_details ?? value.input_tokens_details
	if (details === undefined || details === null) return { inputTokens, outputTokens, totalTokens }
	if (!isRecord(details)) return null
	const cachedInputTokens = readTokenCount(details.cached_tokens ?? 0)
	const cacheCreationInputTokens = readTokenCount(details.cache_creation_input_tokens ?? 0)
	if (
		cachedInputTokens === null ||
		cacheCreationInputTokens === null ||
		cachedInputTokens + cacheCreationInputTokens > inputTokens
	) {
		return null
	}
	return { inputTokens, outputTokens, totalTokens, cachedInputTokens, cacheCreationInputTokens }
}

/** @param {unknown} value */
function readTokenCount(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * @param {Response} upstream
 * @param {{ closed: boolean, send: (chunk: string) => unknown, end: () => unknown, on?: (event: 'close', cb: () => void) => unknown }} sse
 * @param {{ resetTimeout: () => void, abort: () => void }} control
 * @returns {Promise<TokenUsage | null>}
 */
async function proxySseResponse(upstream, sse, control) {
	if (!upstream.body) {
		throw new GatewayError('DashScope stream response has no body', 502)
	}
	const reader = upstream.body.getReader()
	const decoder = new TextDecoder()
	/** @type {TokenUsage | null} */
	let usage = null
	let parseBuffer = ''
	let parseBufferBytes = 0
	let closed = false
	sse.on?.('close', () => {
		closed = true
		control.abort()
		reader.cancel().catch(() => {})
	})
	/** @param {string} text @param {boolean} [flush] */
	const inspectCompleteLines = (text, flush = false) => {
		parseBuffer += text
		parseBufferBytes += Buffer.byteLength(text, 'utf8')
		let lineEnd = parseBuffer.indexOf('\n')
		while (lineEnd >= 0) {
			const line = parseBuffer.slice(0, lineEnd + 1)
			const lineBytes = Buffer.byteLength(line, 'utf8')
			if (lineBytes > MAX_SSE_FRAME_BYTES) {
				control.abort()
				reader.cancel().catch(() => {})
				throw new GatewayError('DashScope SSE frame exceeds the size limit', 502)
			}
			parseBuffer = parseBuffer.slice(lineEnd + 1)
			parseBufferBytes -= lineBytes
			usage = extractUsageFromSseFrame(line) ?? usage
			lineEnd = parseBuffer.indexOf('\n')
		}
		if (parseBufferBytes > MAX_SSE_FRAME_BYTES) {
			control.abort()
			reader.cancel().catch(() => {})
			throw new GatewayError('DashScope SSE frame exceeds the size limit', 502)
		}
		if (flush && parseBuffer) {
			usage = extractUsageFromSseFrame(parseBuffer) ?? usage
			parseBuffer = ''
			parseBufferBytes = 0
		}
	}

	while (!closed) {
		const { value, done } = await reader.read()
		if (done) {
			break
		}
		control.resetTimeout()
		const chunk = decoder.decode(value, { stream: true })
		inspectCompleteLines(chunk)
		if (!sse.closed) {
			sse.send(chunk)
		}
	}
	const trailing = decoder.decode()
	inspectCompleteLines(trailing, true)
	if (trailing && !sse.closed) {
		sse.send(trailing)
	}
	if (!sse.closed) {
		sse.end()
	}
	return usage
}

/**
 * @param {{ body: JsonRecord, uid: string, browserId?: string, usage: TokenUsage | null, startedAt: number, now: () => number, requestId: string }} input
 */
function buildMeasuredUsageRecord(input) {
	const finishedAt = input.now()
	if (!input.usage) {
		throw new GatewayError('DashScope usage is missing from upstream response', 502)
	}
	const record = buildUsageRecord({
		uid: input.uid,
		browserId: input.browserId,
		model: readString(input.body.model) ?? 'unknown',
		usage: input.usage,
		cacheMode: hasExplicitCacheControl(input.body) ? 'explicit' : undefined,
		latencyMs: finishedAt - input.startedAt,
		requestId: input.requestId,
		now: () => finishedAt,
	})
	assertUsageRecordSafe(record)
	return record
}

/** @param {JsonRecord} body */
function hasExplicitCacheControl(body) {
	/** @param {unknown} value */
	const hasMarker = (value) =>
		isRecord(value) && isRecord(value.cache_control) && value.cache_control.type === 'ephemeral'
	return (
		(Array.isArray(body.messages) &&
			body.messages.some(
				(message) =>
					hasMarker(message) ||
					(isRecord(message) && Array.isArray(message.content) && message.content.some(hasMarker)),
			)) ||
		(Array.isArray(body.tools) && body.tools.some(hasMarker))
	)
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
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @returns {string | undefined}
 */
function readBrowserId(headers) {
	const value =
		headers instanceof Headers
			? headers.get('x-wenxue-browser-id')
			: Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-wenxue-browser-id')?.[1]
	if (value === undefined || value === null) return undefined
	const browserId = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value
	if (typeof browserId !== 'string' || !BROWSER_ID_PATTERN.test(browserId)) {
		throw new GatewayError('Invalid X-WenXue-Browser-Id header', 400)
	}
	return browserId
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
 */
async function safeJson(response) {
	const text = await response.text()
	if (!text) {
		if (response.ok) throw new GatewayError('Upstream returned an empty JSON response', 502)
		return null
	}
	try {
		return JSON.parse(text)
	} catch {
		if (response.ok) throw new GatewayError('Upstream returned invalid JSON', 502)
		return { message: text }
	}
}

/**
 * @param {unknown} value
 * @returns {value is JsonRecord}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
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
 * @returns {string | null}
 */
function readString(value) {
	return typeof value === 'string' && value.length > 0 ? value : null
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
	const browserId =
		typeof value.browserId === 'string' && BROWSER_ID_PATTERN.test(value.browserId)
			? value.browserId
			: undefined
	const model = readString(value.model)
	const inputTokens = readEjsonNumber(value.inputTokens)
	const outputTokens = readEjsonNumber(value.outputTokens)
	const totalTokens = readEjsonNumber(value.totalTokens)
	const latencyMs = readEjsonNumber(value.latencyMs) ?? 0
	const ts = readEjsonNumber(value.ts)
	const requestId = readString(value.requestId) ?? ''
	const createdAt =
		readString(value.createdAt) ?? (typeof ts === 'number' ? new Date(ts).toISOString() : '')
	const cachedInputTokens = readEjsonNumber(value.cachedInputTokens) ?? 0
	const cacheCreationInputTokens = readEjsonNumber(value.cacheCreationInputTokens) ?? 0
	const estimatedCostCny = readEjsonNumber(value.estimatedCostCny)
	const pricingVersion = readString(value.pricingVersion)
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
		...(browserId === undefined ? {} : { browserId }),
		model,
		inputTokens,
		outputTokens,
		totalTokens,
		...(value.cachedInputTokens === undefined ? {} : { cachedInputTokens }),
		...(value.cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
		...(value.cacheMode === 'implicit' || value.cacheMode === 'explicit'
			? { cacheMode: value.cacheMode }
			: {}),
		...(estimatedCostCny === null ? {} : { estimatedCostCny }),
		...(pricingVersion === null ? {} : { pricingVersion }),
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
		browserId: record.browserId ?? 'cloud',
		model: record.model,
		inputTokens: record.inputTokens,
		outputTokens: record.outputTokens,
		totalTokens: record.totalTokens,
		estimatedCostCny:
			record.estimatedCostCny ?? estimateTokenCostCny(record.model, record, record.cacheMode),
	}
}

/**
 * @param {Array<ReturnType<typeof toTokenUsageRecord>>} records
 * @param {keyof ReturnType<typeof toTokenUsageRecord>} key
 */
function sumTokenRecords(records, key) {
	if (key === 'estimatedCostCny') {
		return (
			records.reduce(
				(total, record) => total + Math.round(record.estimatedCostCny * COST_UNITS_PER_CNY),
				0,
			) / COST_UNITS_PER_CNY
		)
	}
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
		current.estimatedCostCny =
			(Math.round(current.estimatedCostCny * COST_UNITS_PER_CNY) +
				Math.round(record.estimatedCostCny * COST_UNITS_PER_CNY)) /
			COST_UNITS_PER_CNY
		buckets.set(key, current)
	}
	return Array.from(buckets.values())
		.map((entry) => ({ ...entry, estimatedCostCny: roundCurrency(entry.estimatedCostCny) }))
		.sort((a, b) => b.totalTokens - a.totalTokens)
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
 * @param {number | undefined} timeoutMs
 */
function activationTimeoutMs(timeoutMs) {
	if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return ACTIVATION_TIMEOUT_MS
	}
	return Math.min(timeoutMs, ACTIVATION_TIMEOUT_MS)
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string | URL} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @template T
 * @param {(response: Response, control: { resetTimeout: () => void, abort: () => void }) => Promise<T>} consume
 * @returns {Promise<{ response: Response, value: T }>}
 */
async function fetchAndConsumeWithTimeout(fetchImpl, url, init, timeoutMs, consume) {
	const controller = new AbortController()
	let finished = false
	let timedOut = false
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timeout
	/** @type {(reason: unknown) => void} */
	let rejectTimeout = () => undefined
	const timeoutFailure = new Promise((_, reject) => {
		rejectTimeout = reject
	})
	const resetTimeout = () => {
		if (finished) return
		if (timeout) clearTimeout(timeout)
		timeout = setTimeout(() => {
			timedOut = true
			controller.abort()
			rejectTimeout(new GatewayError('Upstream request timed out', 504))
		}, timeoutMs)
	}
	resetTimeout()
	try {
		const requestAndBody = (async () => {
			const response = await fetchImpl(url, {
				...init,
				signal: controller.signal,
			})
			resetTimeout()
			const value = await consume(response, {
				resetTimeout,
				abort: () => controller.abort(),
			})
			return { response, value }
		})()
		return await Promise.race([requestAndBody, timeoutFailure])
	} catch (error) {
		if (timedOut) {
			throw new GatewayError('Upstream request timed out', 504)
		}
		throw error
	} finally {
		finished = true
		if (timeout) clearTimeout(timeout)
	}
}

/**
 * An upstream may deliver response headers before its JSON body. Keep one timeout active across
 * both phases so a stalled body cannot hold a warm gateway instance indefinitely.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string | URL} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchJsonWithTimeout(fetchImpl, url, init, timeoutMs) {
	const { response, value } = await fetchAndConsumeWithTimeout(
		fetchImpl,
		url,
		init,
		timeoutMs,
		async (nextResponse) => safeJson(nextResponse),
	)
	return { response, payload: value }
}
