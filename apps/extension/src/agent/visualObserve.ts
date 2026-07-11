import type { LLMConfig } from '@page-agent/llms'
import * as z from 'zod/v4'

import {
	VISUAL_OBSERVE_CAPTURE_FAILURE_CODES,
	VISUAL_OBSERVE_PROTOCOL_VERSION,
	type VisualObserveCaptureFailure,
	type VisualObserveCaptureResult,
} from './visualObserve.background'

const TOOL_NAME = 'visual_observation'
const PROTOCOL_RELOAD_ATTEMPT_KEY = 'visualObserveProtocolReloadAttempt'
const PROTOCOL_RELOAD_LOCK_NAME = 'wenxue-visual-observe-protocol-reload'
const MAX_VISUAL_RESULT_JSON_CHARS = 64_000
const MAX_DIAGNOSTIC_CHARS = 2_000
const EMBEDDED_IMAGE_DATA_PATTERN = /data:image\/[a-z0-9.+-]+;base64,/i
const LONG_BASE64_PAYLOAD_PATTERN =
	/(?=[a-z0-9+/]{1024})(?=[a-z0-9+/]{0,1023}[+/])[a-z0-9+/]{1024,}={0,2}/i
const SENSITIVE_DIAGNOSTIC_PATTERN =
	/\bbearer\s+\S+|\bsk-[a-z0-9_-]{8,}|[?&](?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret)=[^\s&]+/i

let backgroundReadinessPromise: Promise<'ready' | 'reloading'> | undefined

const confidenceSchema = z.enum(['high', 'medium', 'low'])
const nextObservationSchema = z.enum(['none', 'scroll', 'wait', 'inspect_dom', 'ask_user'])

export const visualObserveInputSchema = z.object({
	purpose: z
		.enum(['observe', 'confirm', 'audit'])
		.default('observe')
		.describe('Why the main agent is requesting a visual observation.'),
	reason: z.string().min(1).max(2_000).describe('Why visual observation is needed now.'),
	target: z
		.string()
		.max(1_000)
		.optional()
		.describe('Optional target area, control, or state to inspect.'),
	checks: z
		.array(z.string().min(1).max(1_000))
		.max(20)
		.optional()
		.describe('Concrete visual checks to answer for confirmation or audit.'),
})

export const visualObservationResultSchema = z.object({
	pageType: z.string().max(120),
	visibleRegion: z.string().max(1_000),
	controls: z
		.array(
			z.object({
				label: z.string().max(300),
				role: z.enum(['button', 'input', 'link', 'checkbox', 'select', 'modal', 'other']),
				state: z.enum(['enabled', 'disabled', 'selected', 'focused', 'unknown']),
				position: z.enum([
					'top-left',
					'top',
					'top-right',
					'center',
					'bottom-left',
					'bottom',
					'bottom-right',
					'unknown',
				]),
				purpose: z.string().max(1_000),
			}),
		)
		.max(50),
	blockingElements: z.array(z.string().max(1_000)).max(50),
	checks: z
		.array(
			z.object({
				question: z.string().max(1_000),
				answer: z.enum(['yes', 'no', 'unknown']),
				evidence: z.string().max(2_000),
				confidence: confidenceSchema,
			}),
		)
		.max(50),
	visualWarnings: z.array(z.string().max(1_000)).max(50),
	recommendedNextObservation: nextObservationSchema,
	confidence: confidenceSchema,
})

export type VisualObserveInput = z.infer<typeof visualObserveInputSchema>
export type VisualObservationResult = z.infer<typeof visualObservationResultSchema>

export interface VisualModelConfig extends LLMConfig {
	requiresApiKey?: boolean
}

type VisualObserveTool = {
	description: string
	inputSchema: typeof visualObserveInputSchema
	execute: (input: unknown, ctx?: { signal?: AbortSignal }) => Promise<string>
}

export interface VisualObserveToolsDeps {
	getVisionModel: () => VisualModelConfig | undefined
	getTargetTabId?: () => number | null
	captureVisibleTab?: (ctx?: VisualObserveCaptureContext) => Promise<VisualObserveCaptureResult>
	fetchImpl?: typeof fetch
}

export interface VisualObserveCaptureContext {
	signal?: AbortSignal
	targetTabId?: number
}

type LLMMessageContent =
	| string
	| Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

interface LLMMessage {
	role: string
	content: LLMMessageContent
}

class InvalidVisualObservationResponseError extends Error {}

export function createVisualObserveTools(
	deps: VisualObserveToolsDeps,
): Record<string, VisualObserveTool> {
	return {
		visual_observe: {
			description:
				'Capture the current visible viewport and ask the configured vision model to return structured JSON about visible controls, blockers, warnings, and requested confirmation/audit checks. Use this when DOM text is incomplete, page state is visually unclear, a previous action result is uncertain, or you need visual audit evidence. This tool never returns DOM indexes or click coordinates.',
			inputSchema: visualObserveInputSchema,
			execute: async (input: unknown, ctx?: { signal?: AbortSignal }) => {
				ctx?.signal?.throwIfAborted()
				const parsed = visualObserveInputSchema.parse(input)
				const model = deps.getVisionModel()
				if (!model?.baseURL || !model.model || (model.requiresApiKey && !model.apiKey)) {
					return stringifyJson(
						errorResult(
							'vision_model_unavailable',
							'Vision model configuration is unavailable. Continue with DOM inspection or configure a vision model.',
							'inspect_dom',
						),
					)
				}

				let capture: VisualObserveCaptureResult
				try {
					const targetTabId = deps.getTargetTabId?.()
					capture =
						deps.getTargetTabId && targetTabId == null
							? captureFailure(
									'no_active_tab',
									'No Agent-managed tab is available for visual observation.',
								)
							: await (deps.captureVisibleTab ?? captureVisibleTab)({
									signal: ctx?.signal,
									targetTabId: targetTabId ?? undefined,
								})
					ctx?.signal?.throwIfAborted()
				} catch (error) {
					if (isAbortError(error)) throw error
					capture = captureFailure('message_failed', errorMessage(error))
				}
				if (!capture.ok) {
					const code =
						capture.code === 'runtime_outdated' || capture.code === 'protocol_mismatch'
							? 'extension_runtime_outdated'
							: 'screenshot_unavailable'
					return stringifyJson(errorResult(code, capture.error, 'inspect_dom'))
				}

				try {
					const result = await askVisualObservation(model, parsed, capture, {
						signal: ctx?.signal,
						fetchImpl: deps.fetchImpl,
					})
					return stringifyJson(result)
				} catch (error) {
					if (isAbortError(error)) throw error
					return stringifyJson(
						errorResult(
							'vision_observation_failed',
							errorMessage(error),
							'inspect_dom',
							model.apiKey ? [model.apiKey] : [],
						),
					)
				}
			},
		},
	}
}

export async function captureVisibleTab(
	ctx: VisualObserveCaptureContext = {},
): Promise<VisualObserveCaptureResult> {
	try {
		ctx.signal?.throwIfAborted()
		const response: unknown = await chrome.runtime.sendMessage({
			type: 'VISUAL_OBSERVE',
			action: 'capture_visible_tab',
			protocolVersion: VISUAL_OBSERVE_PROTOCOL_VERSION,
			targetTabId: ctx.targetTabId,
		})
		ctx.signal?.throwIfAborted()

		if (isVisualObserveCaptureResult(response)) return response
		if (readErrorMessageFromValue(response) === 'Unknown message type') {
			return captureFailure(
				'runtime_outdated',
				'The extension background is outdated. Reload WenXue or restart the browser.',
			)
		}
		return captureFailure(
			'runtime_outdated',
			'The extension background returned an incompatible screenshot response. Reload WenXue or restart the browser.',
		)
	} catch (error) {
		if (isAbortError(error)) throw error
		return captureFailure('message_failed', errorMessage(error))
	}
}

export function ensureVisualObserveBackgroundReady(): Promise<'ready' | 'reloading'> {
	if (backgroundReadinessPromise) return backgroundReadinessPromise

	const shared = withVisualObserveProtocolLock(checkVisualObserveBackgroundReady).finally(() => {
		if (backgroundReadinessPromise === shared) backgroundReadinessPromise = undefined
	})
	backgroundReadinessPromise = shared
	return shared
}

function withVisualObserveProtocolLock<T>(callback: () => Promise<T>): Promise<T> {
	const locks = globalThis.navigator?.locks
	if (!locks) return callback()
	return locks.request(PROTOCOL_RELOAD_LOCK_NAME, { mode: 'exclusive' }, callback)
}

async function checkVisualObserveBackgroundReady(): Promise<'ready' | 'reloading'> {
	let response: unknown
	try {
		response = await chrome.runtime.sendMessage({
			type: 'VISUAL_OBSERVE',
			action: 'get_protocol_version',
			protocolVersion: VISUAL_OBSERVE_PROTOCOL_VERSION,
		})
	} catch {
		response = undefined
	}

	if (
		isRecord(response) &&
		response.ok === true &&
		response.protocolVersion === VISUAL_OBSERVE_PROTOCOL_VERSION
	) {
		await chrome.storage.local.remove(PROTOCOL_RELOAD_ATTEMPT_KEY)
		return 'ready'
	}

	const stored = await chrome.storage.local.get(PROTOCOL_RELOAD_ATTEMPT_KEY)
	if (stored[PROTOCOL_RELOAD_ATTEMPT_KEY] === VISUAL_OBSERVE_PROTOCOL_VERSION) {
		throw new Error(
			'The WenXue extension background could not be refreshed. Reload the extension from chrome://extensions or restart with a fresh browser profile.',
		)
	}

	await chrome.storage.local.set({
		[PROTOCOL_RELOAD_ATTEMPT_KEY]: VISUAL_OBSERVE_PROTOCOL_VERSION,
	})
	chrome.runtime.reload()
	return 'reloading'
}

export async function askVisualObservation(
	cfg: LLMConfig,
	input: VisualObserveInput,
	capture: Extract<VisualObserveCaptureResult, { ok: true }>,
	opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<VisualObservationResult> {
	const messages = buildMessages(input, capture)
	const baseBody: Record<string, unknown> = {
		model: cfg.model,
		messages,
		temperature: 0,
		tools: [
			toOpenAIFunctionTool(
				TOOL_NAME,
				'Return visible-page observation JSON.',
				visualObservationResultSchema,
			),
		],
		parallel_tool_calls: false,
		tool_choice: cfg.disableNamedToolChoice
			? 'required'
			: { type: 'function', function: { name: TOOL_NAME } },
	}
	if (isQwenLike(cfg)) baseBody.enable_thinking = false

	let lastError: unknown
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const body =
			attempt === 0
				? baseBody
				: {
						...baseBody,
						messages: [
							{
								...messages[0],
								content: `${messages[0]?.content}\nYour previous response was not valid structured tool JSON. Retry once and call visual_observation with schema-valid arguments only.`,
							},
							...messages.slice(1),
						],
					}
		try {
			return await postVisualObservation(cfg, body, opts)
		} catch (error) {
			lastError = error
			if (!(error instanceof InvalidVisualObservationResponseError)) throw error
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function postVisualObservation(
	cfg: LLMConfig,
	body: Record<string, unknown>,
	opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<VisualObservationResult> {
	const fetchImpl = opts?.fetchImpl ?? cfg.customFetch ?? globalThis.fetch
	const transformedBody = cfg.transformRequestBody?.(body) ?? body
	const baseURL = cfg.baseURL.replace(/\/+$/, '')
	let response: Response
	try {
		response = await fetchImpl.call(globalThis, `${baseURL}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
			},
			body: JSON.stringify(transformedBody),
			signal: opts?.signal,
		})
	} catch (error) {
		if (isAbortError(error)) throw error
		throw new Error(`Vision model request failed: ${errorMessage(error)}`)
	}

	if (!response.ok) {
		const message = await readErrorMessage(response)
		throw new Error(`LLM request failed (HTTP ${response.status}): ${message}`)
	}

	let data: unknown
	try {
		data = await response.json()
	} catch (error) {
		if (isAbortError(error)) throw error
		throw new InvalidVisualObservationResponseError(
			`Vision model response is not valid JSON: ${errorMessage(error)}`,
		)
	}
	throwIfCloudBaseErrorEnvelope(data)
	const argString = extractToolArguments(data)
	if (argString === undefined) {
		throw new InvalidVisualObservationResponseError(
			'LLM response missing tool call arguments for visual_observation',
		)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(argString)
	} catch (error) {
		throw new InvalidVisualObservationResponseError(
			`Failed to parse visual observation JSON: ${errorMessage(error)}`,
		)
	}

	const result = visualObservationResultSchema.safeParse(parsed)
	if (!result.success) {
		throw new InvalidVisualObservationResponseError('Visual observation failed schema validation')
	}
	assertSafeVisualObservation(result.data)
	return result.data
}

function buildMessages(
	input: VisualObserveInput,
	capture: Extract<VisualObserveCaptureResult, { ok: true }>,
): LLMMessage[] {
	const checks = input.checks?.length
		? input.checks.map((check) => `- ${check}`).join('\n')
		: '- none'
	const target = input.target ? input.target : 'current visible viewport'
	return [
		{
			role: 'system',
			content:
				'You are a visual page observer for a browser automation agent. Return only facts visible in the screenshot. Do not provide DOM indexes, click coordinates, hidden content, or action commands. Use unknown/low confidence instead of guessing.',
		},
		{
			role: 'user',
			content: [
				{
					type: 'text',
					text:
						`Purpose: ${input.purpose}\n` +
						`Reason: ${input.reason}\n` +
						`Target: ${target}\n` +
						`Checks:\n${checks}`,
				},
				{ type: 'image_url', image_url: { url: capture.dataUrl } },
			],
		},
	]
}

function toOpenAIFunctionTool(name: string, description: string, schema: z.ZodType) {
	return {
		type: 'function' as const,
		function: {
			name,
			description,
			parameters: z.toJSONSchema(schema, { target: 'openapi-3.0' }),
		},
	}
}

function isQwenLike(cfg: LLMConfig): boolean {
	return /dashscope|aliyuncs/i.test(cfg.baseURL) || /^qwen/i.test(cfg.model)
}

function extractToolArguments(data: unknown): string | undefined {
	const choice = (data as { choices?: unknown[] })?.choices?.[0]
	const toolCalls = (choice as { message?: { tool_calls?: unknown[] } } | undefined)?.message
		?.tool_calls
	const toolCall = toolCalls?.find((candidate) => {
		const name = (candidate as { function?: { name?: unknown } } | undefined)?.function?.name
		return name === TOOL_NAME
	})
	const args = (toolCall as { function?: { arguments?: unknown } } | undefined)?.function?.arguments
	return typeof args === 'string' ? args : undefined
}

async function readErrorMessage(response: Response): Promise<string> {
	try {
		return readErrorMessageFromValue(await response.json()) ?? response.statusText
	} catch (error) {
		if (isAbortError(error)) throw error
		return response.statusText
	}
}

function throwIfCloudBaseErrorEnvelope(data: unknown): void {
	if (!isRecord(data)) return
	const statusCode = data.statusCode
	if (typeof statusCode !== 'number' || !Number.isFinite(statusCode) || statusCode < 400) return

	let body: unknown = data.body
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body)
		} catch {
			// Preserve the plain response body as the error message.
		}
	}
	const plainBody = typeof body === 'string' ? body.trim() : ''
	const message = readErrorMessageFromValue(body) ?? (plainBody || `HTTP ${statusCode}`)
	throw new Error(`LLM request failed (HTTP ${statusCode}): ${message}`)
}

function assertSafeVisualObservation(result: VisualObservationResult): void {
	const serialized = JSON.stringify(result)
	if (
		serialized.length > MAX_VISUAL_RESULT_JSON_CHARS ||
		EMBEDDED_IMAGE_DATA_PATTERN.test(serialized) ||
		LONG_BASE64_PAYLOAD_PATTERN.test(serialized)
	) {
		throw new InvalidVisualObservationResponseError(
			'Visual observation contains unsafe image data or exceeds the safe output limit',
		)
	}
}

function readErrorMessageFromValue(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined
	if (typeof value.error === 'string') return value.error
	if (isRecord(value.error) && typeof value.error.message === 'string') return value.error.message
	return typeof value.message === 'string' ? value.message : undefined
}

function isVisualObserveCaptureResult(value: unknown): value is VisualObserveCaptureResult {
	if (!isRecord(value) || value.protocolVersion !== VISUAL_OBSERVE_PROTOCOL_VERSION) return false
	if (value.ok === false) {
		return (
			typeof value.code === 'string' &&
			VISUAL_OBSERVE_CAPTURE_FAILURE_CODES.some((code) => code === value.code) &&
			typeof value.error === 'string'
		)
	}
	if (value.ok !== true || typeof value.dataUrl !== 'string' || !isRecord(value.tab)) return false
	return (
		value.dataUrl.startsWith('data:image/jpeg;base64,') &&
		Number.isInteger(value.tab.id) &&
		Number.isInteger(value.tab.windowId) &&
		(value.tab.url === undefined || typeof value.tab.url === 'string') &&
		(value.tab.title === undefined || typeof value.tab.title === 'string')
	)
}

function captureFailure(
	code: VisualObserveCaptureFailure['code'],
	error: string,
): VisualObserveCaptureFailure {
	return {
		ok: false,
		protocolVersion: VISUAL_OBSERVE_PROTOCOL_VERSION,
		code,
		error,
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
	return isRecord(error) && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function stringifyJson(value: unknown): string {
	return JSON.stringify(value, null, 2)
}

function errorResult(
	code: string,
	message: string,
	recommendedNextObservation: z.infer<typeof nextObservationSchema>,
	sensitiveValues: readonly string[] = [],
) {
	const safeMessage = sanitizeDiagnostic(message, sensitiveValues)
	return {
		error: {
			code,
			message: safeMessage,
			recommendedNextObservation,
		},
		pageType: 'unknown',
		visibleRegion: 'current viewport',
		controls: [],
		blockingElements: [],
		checks: [],
		visualWarnings: [safeMessage],
		recommendedNextObservation,
		confidence: 'low',
	}
}

function sanitizeDiagnostic(message: string, sensitiveValues: readonly string[]): string {
	if (
		EMBEDDED_IMAGE_DATA_PATTERN.test(message) ||
		LONG_BASE64_PAYLOAD_PATTERN.test(message) ||
		SENSITIVE_DIAGNOSTIC_PATTERN.test(message) ||
		sensitiveValues.some((value) => value.length > 0 && message.includes(value))
	) {
		return 'Visual observation failed without returning safe diagnostic details.'
	}
	return message.length > MAX_DIAGNOSTIC_CHARS
		? `${message.slice(0, MAX_DIAGNOSTIC_CHARS)}…`
		: message
}
