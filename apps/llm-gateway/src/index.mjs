import { GatewayError, handleChatCompletions, handleUsageSummary } from './gateway.mjs'

/** @typedef {{ sse: () => { closed: boolean, send: (chunk: string) => unknown, end: () => unknown, on?: (event: 'close', cb: () => void) => unknown }, httpContext?: { headers?: Record<string, string | string[] | undefined> } }} CloudBaseContext */

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

/**
 * @param {unknown} error
 */
function errorResponse(error) {
	const status = error instanceof GatewayError ? error.status : 500
	const message = error instanceof Error ? error.message : 'Unknown gateway error'
	return {
		statusCode: status,
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
		return /** @type {Record<string, string | string[] | undefined>} */ (context.httpContext.headers)
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
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
