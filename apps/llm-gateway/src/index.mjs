import { createHash } from 'node:crypto'

import {
	GatewayError,
	handleChatCompletions,
	handleLauncherActivation,
	handleLauncherRegistration,
	handleUsageSummary,
} from './gateway.mjs'

export {
	me as adminMe,
	usageSummary as adminUsageSummary,
	users as adminUsers,
	userStatus as adminUserStatus,
} from '../../admin-api/src/index.mjs'
export { adminConsole } from './adminConsole.mjs'

/** @typedef {{ sse: () => { closed: boolean, send: (chunk: string) => unknown, end: () => unknown, on?: (event: 'close', cb: () => void) => unknown }, httpContext?: { headers?: Record<string, string | string[] | undefined> } }} CloudBaseContext */

const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'POST, OPTIONS',
	'access-control-allow-headers': 'content-type, authorization',
}
const REGISTRATION_RATE_WINDOW_MS = 60_000
const REGISTRATION_RATE_MAX_KEYS = 2_048
const REGISTRATION_RATE_LIMITS = {
	ipUsername: 5,
	ip: 20,
	username: 10,
	global: 200,
}
/** @typedef {{ count: number, resetAt: number }} RateLimitEntry */
/** @type {{ ipUsername: Map<string, RateLimitEntry>, ip: Map<string, RateLimitEntry>, username: Map<string, RateLimitEntry>, global: Map<string, RateLimitEntry> }} */
const registrationRateState = {
	ipUsername: new Map(),
	ip: new Map(),
	username: new Map(),
	global: new Map(),
}

export function resetLauncherRegistrationRateLimits() {
	registrationRateState.ipUsername.clear()
	registrationRateState.ip.clear()
	registrationRateState.username.clear()
	registrationRateState.global.clear()
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
export async function main(event, context) {
	const rawBody = readEventBody(event)
	const stream = isStreamRequest(rawBody)
	const sse = stream ? context.sse() : undefined

	try {
		const result = await handleChatCompletions({
			headers: readEventHeaders(event, context),
			rawBody,
			sse,
			env: readRuntimeEnv(),
		})

		if (stream) {
			console.log('wenxue llm gateway usage', result.usageRecord)
			return ''
		}

		console.log('wenxue llm gateway usage', result.usageRecord)
		return result.responseBody
	} catch (error) {
		const status = error instanceof GatewayError ? error.status : 500
		const message = error instanceof Error ? error.message : 'Unknown gateway error'
		if (sse && !sse.closed) {
			sse.send(`data: ${JSON.stringify({ error: { message, status } })}\n\n`)
			sse.end()
			return ''
		}
		return {
			statusCode: status,
			body: JSON.stringify({ error: { message, status } }),
		}
	}
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
export async function usageSummary(event, context) {
	try {
		return await handleUsageSummary({
			headers: readEventHeaders(event, context),
			env: readRuntimeEnv(),
		})
	} catch (error) {
		return errorResponse(error)
	}
}

export function healthCheck() {
	return {
		statusCode: 200,
		headers: {
			'content-type': 'application/json; charset=utf-8',
		},
		body: JSON.stringify({
			ok: true,
			service: 'wenxue-llm-gateway',
			revision: 'admin-runtime-consolidated-v2',
		}),
	}
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
export async function launcherRegister(event, context) {
	if (isOptionsRequest(event, context)) {
		return {
			statusCode: 204,
			headers: CORS_HEADERS,
			body: '',
		}
	}
	const rawBody = readEventBody(event)
	const rateLimit = consumeLauncherRegistrationRateLimit({
		ip: readRegistrationClientIp(event, context),
		username: readRegistrationUsername(rawBody),
	})
	if (rateLimit) {
		return {
			statusCode: 429,
			headers: {
				...CORS_HEADERS,
				'retry-after': String(rateLimit.retryAfterSeconds),
			},
			body: JSON.stringify({
				error: { message: '注册请求过于频繁，请稍后再试', status: 429 },
			}),
		}
	}

	try {
		const result = await handleLauncherRegistration({
			rawBody,
			env: readRuntimeEnv(),
		})
		return {
			statusCode: 201,
			headers: CORS_HEADERS,
			body: JSON.stringify(result),
		}
	} catch (error) {
		return errorResponse(error)
	}
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
export async function launcherActivate(event, context) {
	if (isOptionsRequest(event, context)) {
		return {
			statusCode: 204,
			headers: CORS_HEADERS,
			body: '',
		}
	}

	try {
		const result = await handleLauncherActivation({
			headers: readEventHeaders(event, context),
			env: readRuntimeEnv(),
		})
		return {
			statusCode: 200,
			headers: CORS_HEADERS,
			body: JSON.stringify(result),
		}
	} catch (error) {
		return errorResponse(error)
	}
}

/**
 * @param {{ ip: string, username: string }} input
 */
function consumeLauncherRegistrationRateLimit(input) {
	const now = Date.now()
	const ipKey = hashRateLimitKey(input.ip)
	const usernameKey = hashRateLimitKey(input.username)
	const checks = [
		{
			bucket: registrationRateState.ipUsername,
			key: hashRateLimitKey(`${input.ip}\0${input.username}`),
			limit: REGISTRATION_RATE_LIMITS.ipUsername,
		},
		{ bucket: registrationRateState.ip, key: ipKey, limit: REGISTRATION_RATE_LIMITS.ip },
		{
			bucket: registrationRateState.username,
			key: usernameKey,
			limit: REGISTRATION_RATE_LIMITS.username,
		},
		{ bucket: registrationRateState.global, key: '*', limit: REGISTRATION_RATE_LIMITS.global },
	]
	for (const check of checks) {
		const retryAfterSeconds = consumeFixedWindow(check.bucket, check.key, check.limit, now)
		if (retryAfterSeconds !== null) return { retryAfterSeconds }
	}
	return null
}

/**
 * @param {Map<string, RateLimitEntry>} bucket
 * @param {string} key
 * @param {number} limit
 * @param {number} now
 */
function consumeFixedWindow(bucket, key, limit, now) {
	pruneRateLimitBucket(bucket, now)
	const current = bucket.get(key)
	if (current) {
		if (current.count >= limit) {
			return Math.max(1, Math.ceil((current.resetAt - now) / 1000))
		}
		current.count += 1
		return null
	}
	while (bucket.size >= REGISTRATION_RATE_MAX_KEYS) {
		const oldestKey = bucket.keys().next().value
		if (typeof oldestKey !== 'string') break
		bucket.delete(oldestKey)
	}
	bucket.set(key, { count: 1, resetAt: now + REGISTRATION_RATE_WINDOW_MS })
	return null
}

/**
 * @param {Map<string, RateLimitEntry>} bucket
 * @param {number} now
 */
function pruneRateLimitBucket(bucket, now) {
	for (const [key, entry] of bucket) {
		if (entry.resetAt <= now) bucket.delete(key)
	}
}

/**
 * Only trust the right-most X-Forwarded-For hop added by the ingress. A client can spoof values
 * on the left side of the chain, so using the first segment would make the IP limit bypassable.
 *
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
function readRegistrationClientIp(event, context) {
	const headers = readEventHeaders(event, context)
	const forwarded = readHeader(headers, 'x-forwarded-for')
	if (forwarded) {
		const trustedHop = forwarded
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
			.at(-1)
		if (trustedHop) return trustedHop
	}
	const realIp = readHeader(headers, 'x-real-ip')
	if (realIp) return realIp
	if (isRecord(event) && isRecord(event.requestContext)) {
		const requestContext = event.requestContext
		if (isRecord(requestContext.http)) {
			const sourceIp = readString(requestContext.http.sourceIp)
			if (sourceIp) return sourceIp
		}
		const identity = isRecord(requestContext.identity) ? requestContext.identity : null
		const sourceIp = identity ? readString(identity.sourceIp) : null
		if (sourceIp) return sourceIp
	}
	return 'unknown'
}

/**
 * Parse only the username needed for the limiter. The password is never retained or logged.
 *
 * @param {string} rawBody
 */
function readRegistrationUsername(rawBody) {
	try {
		const body = JSON.parse(rawBody)
		if (isRecord(body) && typeof body.username === 'string') return body.username
	} catch {
		// Invalid JSON still consumes a bounded anonymous registration bucket.
	}
	return '<invalid>'
}

/**
 * @param {string} value
 */
function hashRateLimitKey(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * @param {unknown} error
 */
function errorResponse(error) {
	const status = error instanceof GatewayError ? error.status : 500
	const message = error instanceof Error ? error.message : 'Unknown gateway error'
	return {
		statusCode: status,
		headers: CORS_HEADERS,
		body: JSON.stringify({ error: { message, status } }),
	}
}

function readRuntimeEnv() {
	return {
		cloudbaseEnvId: process.env.CLOUDBASE_ENV_ID ?? 'wenxue-d8gz76tacc3659f05',
		cloudbaseClientId: process.env.CLOUDBASE_AUTH_CLIENT_ID ?? 'wenxue-d8gz76tacc3659f05',
		cloudbaseClientSecret: process.env.CLOUDBASE_AUTH_CLIENT_SECRET ?? '',
		cloudbaseUsageApiKey: process.env.CLOUDBASE_USAGE_API_KEY ?? '',
		cloudbaseRegion: process.env.CLOUDBASE_REGION ?? 'ap-shanghai',
		dashscopeApiKey: process.env.DASHSCOPE_API_KEY ?? '',
		tencentCloudSecretId:
			process.env.TENCENTCLOUD_SECRETID ??
			process.env.TENCENTCLOUD_SECRET_ID ??
			process.env.TENCENT_CLOUD_SECRET_ID ??
			process.env.TENCENT_SECRET_ID ??
			'',
		tencentCloudSecretKey:
			process.env.TENCENTCLOUD_SECRETKEY ??
			process.env.TENCENTCLOUD_SECRET_KEY ??
			process.env.TENCENT_CLOUD_SECRET_KEY ??
			process.env.TENCENT_SECRET_KEY ??
			'',
		tencentCloudToken:
			process.env.TENCENTCLOUD_SESSIONTOKEN ??
			process.env.TENCENTCLOUD_SESSION_TOKEN ??
			process.env.TENCENTCLOUD_TOKEN ??
			'',
		requestTimeoutMs: Number(process.env.WENXUE_GATEWAY_TIMEOUT_MS ?? 60_000),
	}
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 * @returns {Record<string, string | string[] | undefined>}
 */
function readEventHeaders(event, context) {
	if (isRecord(event) && isRecord(event.headers)) {
		return /** @type {Record<string, string | string[] | undefined>} */ (event.headers)
	}
	if (isRecord(context.httpContext) && isRecord(context.httpContext.headers)) {
		return /** @type {Record<string, string | string[] | undefined>} */ (
			context.httpContext.headers
		)
	}
	return {}
}

/**
 * @param {unknown} event
 */
function readEventBody(event) {
	if (!isRecord(event)) {
		return '{}'
	}
	if (typeof event.body === 'string') {
		const body = /** @type {{ body: string, isBase64Encoded?: boolean }} */ (event)
		return body.isBase64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
	}
	if (typeof event.rawBody === 'string') {
		return /** @type {{ rawBody: string }} */ (event).rawBody
	}
	return JSON.stringify('body' in event ? event.body : event)
}

/**
 * @param {string} rawBody
 */
function isStreamRequest(rawBody) {
	try {
		const body = JSON.parse(rawBody)
		return Boolean(body && typeof body === 'object' && body.stream === true)
	} catch {
		return false
	}
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
function isOptionsRequest(event, context) {
	const headers = readEventHeaders(event, context)
	if (readHeader(headers, 'access-control-request-method')) return true

	if (!isRecord(event)) return false
	const method =
		readString(event.httpMethod) ??
		readString(event.method) ??
		(isRecord(event.requestContext) && isRecord(event.requestContext.http)
			? readString(event.requestContext.http.method)
			: null)
	return method?.toUpperCase() === 'OPTIONS'
}

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} name
 */
function readHeader(headers, name) {
	const normalized = name.toLowerCase()
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== normalized) continue
		if (typeof value === 'string') return value.trim() || null
		if (Array.isArray(value)) return value[0]?.trim() || null
	}
	return null
}

/**
 * @param {unknown} value
 */
function readString(value) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
