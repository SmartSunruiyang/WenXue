import { handleAdminRequest } from './adminApi.mjs'
import { createCloudBaseAdminStore } from './cloudbaseStore.mjs'

/** @typedef {{ httpContext?: { headers?: Record<string, string | string[] | undefined> } }} CloudBaseContext */

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
		query: readEventQuery(event),
		headers,
		rawBody: readEventBody(event),
		env,
		store: createCloudBaseAdminStore({
			envId: env.cloudbaseEnvId,
			apiKey: env.cloudbaseAdminApiKey,
			timeoutMs: env.requestTimeoutMs,
		}),
	})
}

function readRuntimeEnv() {
	return {
		cloudbaseEnvId: process.env.CLOUDBASE_ENV_ID ?? 'wenxue-d8gz76tacc3659f05',
		cloudbaseClientId: process.env.CLOUDBASE_AUTH_CLIENT_ID ?? 'wenxue-d8gz76tacc3659f05',
		cloudbaseAdminApiKey:
			process.env.CLOUDBASE_ADMIN_API_KEY ?? process.env.CLOUDBASE_USAGE_API_KEY ?? '',
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
 * @returns {Record<string, string | undefined>}
 */
function readEventQuery(event) {
	if (!isRecord(event)) return {}
	const source = isRecord(event.queryStringParameters)
		? event.queryStringParameters
		: isRecord(event.query)
			? event.query
			: {}
	return Object.fromEntries(
		Object.entries(source).flatMap(([key, value]) => {
			return typeof value === 'string' ? [[key, value]] : []
		}),
	)
}

/**
 * @param {unknown} event
 */
function readEventBody(event) {
	if (!isRecord(event)) return '{}'
	if (typeof event.body === 'string') {
		const body = /** @type {{ body: string, isBase64Encoded?: boolean }} */ (event)
		return body.isBase64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
	}
	if (typeof event.rawBody === 'string') {
		return /** @type {{ rawBody: string }} */ (event).rawBody
	}
	return JSON.stringify('body' in event ? event.body : {})
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
