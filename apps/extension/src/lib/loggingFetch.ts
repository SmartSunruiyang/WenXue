import { logger } from './logger'
import { redact } from './logRedaction'

const DEFAULT_LLM_URL_PATTERNS = ['/chat/completions', '/completions', '/v1/messages']

export interface LoggingFetchOptions {
	isLlmUrl?: (url: string) => boolean
}

function defaultIsLlmUrl(url: string): boolean {
	return DEFAULT_LLM_URL_PATTERNS.some((pattern) => url.includes(pattern))
}

/**
 * Install a scoped `globalThis.fetch` interceptor that logs LLM requests/responses.
 *
 * Only URLs matching `isLlmUrl` are logged; all other fetches pass through untouched.
 * Returns an uninstall function that restores the original `fetch`.
 *
 * The interceptor redacts sensitive data before logging. Streaming responses
 * are tee'd so the original consumer is not disrupted.
 */
export function installLlmFetchLogging(opts?: LoggingFetchOptions): () => void {
	const origFetch = globalThis.fetch
	const isLlm = opts?.isLlmUrl ?? defaultIsLlmUrl

	globalThis.fetch = async function loggingFetch(
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

		if (!isLlm(url)) {
			return origFetch.call(globalThis, input, init)
		}

		const start = Date.now()

		// Read and redact request body before sending
		let redactedRequest: unknown = undefined
		let visualRequest = false
		try {
			const bodyText = init?.body
			if (typeof bodyText === 'string') {
				const requestBody = JSON.parse(bodyText)
				visualRequest = hasImageDataUri(requestBody)
				redactedRequest = visualRequest
					? { request: 'visual image request omitted' }
					: redact(requestBody)
			}
		} catch {
			// Non-JSON or unreadable body — skip request logging
		}

		let response: Response
		try {
			response = await origFetch.call(globalThis, input, init)
		} catch (err) {
			const durationMs = Date.now() - start
			logger.error('llm', `fetch failed: ${url}`, {
				request: redactedRequest,
				error: String(err),
				durationMs,
			})
			throw err
		}

		const durationMs = Date.now() - start

		// Log response asynchronously — don't block the caller
		logResponse(response, url, redactedRequest, durationMs, visualRequest).catch(() => {})

		return response
	}

	return function uninstall() {
		globalThis.fetch = origFetch
	}
}

async function logResponse(
	response: Response,
	url: string,
	redactedRequest: unknown,
	durationMs: number,
	visualRequest: boolean,
): Promise<void> {
	let bodyText: string | undefined
	if (!visualRequest) {
		try {
			// Clone to avoid consuming the original body
			const clone = response.clone()
			bodyText = await clone.text()
		} catch {
			// Response body may not be readable (e.g. opaque response)
		}
	}

	const redactedBody = visualRequest
		? { response: 'visual image response omitted' }
		: bodyText
			? redact(safeJsonParse(bodyText))
			: undefined

	logger.info('llm', `LLM ${response.status} ${url}`, {
		request: redactedRequest,
		response: {
			status: response.status,
			body: redactedBody,
		},
		durationMs,
	})
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

function hasImageDataUri(value: unknown): boolean {
	if (typeof value === 'string') return /^data:image\//i.test(value)
	if (!value || typeof value !== 'object') return false
	if (Array.isArray(value)) return value.some(hasImageDataUri)
	return Object.values(value as Record<string, unknown>).some(hasImageDataUri)
}
