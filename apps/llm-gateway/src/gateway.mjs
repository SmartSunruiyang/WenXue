import { randomUUID } from 'node:crypto'

export const DASHSCOPE_CHAT_COMPLETIONS_URL =
	'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

/** @typedef {{ inputTokens: number, outputTokens: number, totalTokens: number }} TokenUsage */
/** @typedef {{ uid: string }} CloudBaseUser */
/** @typedef {{ [key: string]: unknown }} JsonRecord */
/** @typedef {{ _id: string, ts: number, uid: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number, latencyMs: number, requestId: string, createdAt: string }} CloudUsageRecord */

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
	const url = new URL(
		`https://${input.envId}.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)/collections/token_usage/documents`,
	)
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
	const url = new URL(
		`https://${input.envId}.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)/collections/token_usage/documents`,
	)
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
		daily: bucketTokenRecords(safeRecords, (record) => new Date(record.ts).toISOString().slice(0, 10)),
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
	const forbidden = ['prompt', 'content', 'authorization', 'bearer', 'api_key', 'apikey', 'sk-']
	for (const word of forbidden) {
		if (text.includes(word)) {
			throw new GatewayError(`Usage record contains forbidden field: ${word}`, 500)
		}
	}
}

/**
 * @param {{
 *   headers: Headers | Record<string, string | string[] | undefined>,
 *   envId: string,
 *   clientId: string,
 *   clientSecret?: string,
 *   fetchImpl?: typeof fetch,
 * }} input
 * @returns {Promise<CloudBaseUser>}
 */
export async function resolveCloudBaseUser(input) {
	const token = extractBearerToken(input.headers)
	if (!token) {
		throw new GatewayError('Missing bearer token', 401)
	}
	const url = new URL(`https://${input.envId}.api.tcloudbasegateway.com/auth/v1/token/introspect`)
	url.searchParams.set('client_id', input.clientId)
	const response = await (input.fetchImpl ?? fetch)(url, {
		method: 'GET',
		headers: {
			authorization: `Bearer ${token}`,
			'x-device-id': 'wenxue-llm-gateway',
			'x-request-id': randomUUID(),
		},
	})
	if (!response.ok) {
		throw new GatewayError('CloudBase token introspection failed', 401)
	}
	const payload = await response.json()
	if (!isRecord(payload) || payload.active === false) {
		throw new GatewayError('CloudBase token is inactive', 401)
	}
	const uid = readString(payload.sub) ?? readString(payload.uid)
	if (!uid) {
		throw new GatewayError('CloudBase token has no uid', 401)
	}
	return { uid }
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
	const user = await resolveCloudBaseUser({
		headers: input.headers,
		envId: input.env.cloudbaseEnvId,
		clientId: input.env.cloudbaseClientId,
		clientSecret: input.env.cloudbaseClientSecret,
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
		await writeUsageRecord({
			record: usageRecord,
			envId: input.env.cloudbaseEnvId,
			apiKey: input.env.cloudbaseUsageApiKey,
			fetchImpl: input.fetchImpl,
			timeoutMs: input.env.requestTimeoutMs,
		})
		return { usageRecord, usagePersisted: true, upstreamStatus: upstream.status }
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
	await writeUsageRecord({
		record: usageRecord,
		envId: input.env.cloudbaseEnvId,
		apiKey: input.env.cloudbaseUsageApiKey,
		fetchImpl: input.fetchImpl,
		timeoutMs: input.env.requestTimeoutMs,
	})
	return { responseBody: payload, usageRecord, usagePersisted: true, upstreamStatus: upstream.status }
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
	const user = await resolveCloudBaseUser({
		headers: input.headers,
		envId: input.env.cloudbaseEnvId,
		clientId: input.env.cloudbaseClientId,
		clientSecret: input.env.cloudbaseClientSecret,
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
	const createdAt = readString(value.createdAt) ?? (typeof ts === 'number' ? new Date(ts).toISOString() : '')
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
		const current =
			buckets.get(key) ??
			{
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
