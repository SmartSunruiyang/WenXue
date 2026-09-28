import { createCloudBaseAuthDirectory } from '../../admin-api/src/cloudbaseAuth.mjs'
import {
	GatewayError,
	handleChatCompletions,
	handleLauncherActivation,
	handleUsageSummary,
} from './gateway.mjs'

export {
	announcements as adminAnnouncements,
	announcementWithdraw as adminAnnouncementWithdraw,
	me as adminMe,
	releaseCandidates as adminReleaseCandidates,
	releasePublish as adminReleasePublish,
	releases as adminReleases,
	releaseState as adminReleaseState,
	usageSummary as adminUsageSummary,
	users as adminUsers,
	userStatus as adminUserStatus,
	clientAnnouncementAck,
	clientAnnouncementsPending,
	clientUpdateEvents,
	clientUpdatePolicy,
	publicDesktopDownloads,
	releaseCandidateRegister,
} from '../../admin-api/src/index.mjs'
export { adminConsole } from './adminConsole.mjs'

/** @typedef {{ sse: () => { closed: boolean, send: (chunk: string) => unknown, end: () => unknown, on?: (event: 'close', cb: () => void) => unknown }, httpContext?: { headers?: Record<string, string | string[] | undefined> } }} CloudBaseContext */

const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'POST, OPTIONS',
	'access-control-allow-headers': 'content-type, authorization',
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
		const env = readRuntimeEnv()
		const result = await handleChatCompletions({
			headers: readEventHeaders(event, context),
			rawBody,
			sse,
			env,
			getAuthUser: createAuthUserLookup(env),
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
		const env = readRuntimeEnv()
		return await handleUsageSummary({
			headers: readEventHeaders(event, context),
			env,
			getAuthUser: createAuthUserLookup(env),
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
	return errorResponse(new GatewayError('请更新问学并使用邮箱验证完成注册', 410))
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
		const env = readRuntimeEnv()
		const result = await handleLauncherActivation({
			headers: readEventHeaders(event, context),
			env,
			getAuthUser: createAuthUserLookup(env),
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
		dashscopeApiKey: process.env.DASHSCOPE_API_KEY ?? '',
		requestTimeoutMs: Number(process.env.WENXUE_GATEWAY_TIMEOUT_MS ?? 60_000),
	}
}

/** @param {ReturnType<typeof readRuntimeEnv>} env @returns {import('./gateway.mjs').AuthUserLookup} */
function createAuthUserLookup(env) {
	return (uid, timeoutMs) =>
		createCloudBaseAuthDirectory({
			envId: env.cloudbaseEnvId,
			region: env.cloudbaseRegion,
			secretId: env.tencentCloudSecretId,
			secretKey: env.tencentCloudSecretKey,
			token: env.tencentCloudToken,
			timeoutMs,
		}).getUser(uid)
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
