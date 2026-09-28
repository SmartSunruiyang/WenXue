import { handleAdminRequest } from './adminApi.mjs'
import { createCloudBaseAdminStore } from './cloudbaseStore.mjs'

const HTTP_ENVELOPE_KEYS = new Set([
	'body',
	'rawBody',
	'isBase64Encoded',
	'headers',
	'httpMethod',
	'method',
	'requestMethod',
	'queryStringParameters',
	'query',
	'path',
	'url',
])

/** @typedef {{ httpContext?: { headers?: Record<string, string | string[] | undefined>, httpMethod?: string, url?: string } }} CloudBaseContext */

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
export function me(event, context) {
	return dispatch(event, context, '/admin/v1/me')
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
export function usageSummary(event, context) {
	return dispatch(event, context, '/admin/v1/usage/summary')
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
export function users(event, context) {
	return dispatch(event, context, '/admin/v1/users')
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 */
export function userStatus(event, context) {
	return dispatch(event, context, '/admin/v1/users/status')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function announcements(event, context) {
	return dispatch(event, context, '/admin/v1/announcements')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function announcementWithdraw(event, context) {
	return dispatch(event, context, '/admin/v1/announcement-withdraw')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function releaseCandidates(event, context) {
	return dispatch(event, context, '/admin/v1/release-candidates')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function releases(event, context) {
	return dispatch(event, context, '/admin/v1/releases')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function releasePublish(event, context) {
	return dispatch(event, context, '/admin/v1/release-publish')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function releaseState(event, context) {
	return dispatch(event, context, '/admin/v1/release-state')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function releaseCandidateRegister(event, context) {
	return dispatch(event, context, '/internal/v1/release-candidates/register')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function clientAnnouncementsPending(event, context) {
	return dispatch(event, context, '/v1/client/announcements/pending')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function clientAnnouncementAck(event, context) {
	return dispatch(event, context, '/v1/client/announcement-ack')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function clientUpdatePolicy(event, context) {
	return dispatch(event, context, '/v1/client/update-policy')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function publicDesktopDownloads(event, context) {
	return dispatch(event, context, '/v1/public/desktop-downloads')
}

/** @param {unknown} event @param {CloudBaseContext} context */
export function clientUpdateEvents(event, context) {
	return dispatch(event, context, '/v1/client/update-events')
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 * @param {string} path
 */
function dispatch(event, context, path) {
	const env = readRuntimeEnv()
	const headers = readEventHeaders(event, context)
	return handleAdminRequest({
		method: readEventMethod(event, context, headers),
		path,
		query: readEventQuery(event, context),
		headers,
		rawBody: readEventBody(event),
		env,
		store: createCloudBaseAdminStore({
			envId: env.cloudbaseEnvId,
			apiKey: env.cloudbaseAdminApiKey,
			region: env.cloudbaseRegion,
			secretId: env.tencentCloudSecretId,
			secretKey: env.tencentCloudSecretKey,
			token: env.tencentCloudToken,
			timeoutMs: env.requestTimeoutMs,
		}),
	})
}

function readRuntimeEnv() {
	return {
		cloudbaseEnvId: process.env.CLOUDBASE_ENV_ID ?? 'wenxue-d8gz76tacc3659f05',
		cloudbaseClientId: process.env.CLOUDBASE_AUTH_CLIENT_ID ?? 'wenxue-d8gz76tacc3659f05',
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
		cloudbaseAdminApiKey:
			process.env.CLOUDBASE_ADMIN_API_KEY ?? process.env.CLOUDBASE_USAGE_API_KEY ?? '',
		releaseCiToken: process.env.WENXUE_RELEASE_CI_TOKEN ?? '',
		releaseManifestPublicKey:
			process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY ??
			process.env.WENXUE_RELEASE_MANIFEST_PUBLIC_KEY ??
			'',
		releaseEventTokenSecret: process.env.WENXUE_RELEASE_EVENT_TOKEN_SECRET ?? '',
		releaseEventDailyQuota: Number(process.env.WENXUE_RELEASE_EVENT_DAILY_QUOTA ?? 100_000),
		allowedOrigins: (process.env.WENXUE_ADMIN_ALLOWED_ORIGINS ?? '*')
			.split(',')
			.map((origin) => origin.trim())
			.filter(Boolean),
		requestTimeoutMs: Number(process.env.WENXUE_ADMIN_API_TIMEOUT_MS ?? 15_000),
	}
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 * @param {Record<string, string | string[] | undefined>} headers
 */
function readEventMethod(event, context, headers) {
	for (const source of [event, context.httpContext]) {
		if (!isRecord(source)) continue
		const method = source.httpMethod ?? source.method ?? source.requestMethod
		if (typeof method === 'string') return method
	}
	if (readHeader(headers, 'access-control-request-method')) return 'OPTIONS'
	return 'GET'
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
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} name
 */
function readHeader(headers, name) {
	const lower = name.toLowerCase()
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lower) {
			return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
		}
	}
	return null
}

/**
 * @param {unknown} event
 * @param {CloudBaseContext} context
 * @returns {Record<string, string | undefined>}
 */
function readEventQuery(event, context) {
	const source =
		isRecord(event) && isRecord(event.queryStringParameters)
			? event.queryStringParameters
			: isRecord(event) && isRecord(event.query)
				? event.query
				: readUrlQuery(context.httpContext?.url)
	return Object.fromEntries(
		Object.entries(source).flatMap(([key, value]) => {
			return typeof value === 'string' ? [[key, value]] : []
		}),
	)
}

/**
 * @param {string | undefined} value
 */
function readUrlQuery(value) {
	if (!value) return {}
	try {
		return Object.fromEntries(new URL(value, 'http://localhost').searchParams)
	} catch {
		return {}
	}
}

/**
 * @param {unknown} event
 */
function readEventBody(event) {
	if (typeof event === 'string') return event
	if (!isRecord(event)) return '{}'
	if (
		!('body' in event || 'rawBody' in event) ||
		!Object.keys(event).every((key) => HTTP_ENVELOPE_KEYS.has(key))
	) {
		return JSON.stringify(event)
	}
	if (typeof event.body === 'string') {
		const body = /** @type {{ body: string, isBase64Encoded?: boolean }} */ (event)
		return body.isBase64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
	}
	if (typeof event.rawBody === 'string') {
		return /** @type {{ rawBody: string }} */ (event).rawBody
	}
	return JSON.stringify(event.body)
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
