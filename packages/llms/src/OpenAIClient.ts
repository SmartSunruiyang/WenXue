/**
 * OpenAI Client implementation
 */
import * as z from 'zod/v4'

import { InvokeError, InvokeErrorTypes } from './errors'
import {
	hasNamedToolChoice,
	isNamedToolChoiceCompatibilityError,
	rememberNamedToolChoiceUnsupported,
	shouldDisableNamedToolChoice,
} from './namedToolChoice'
import type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool } from './types'
import { modelPatch, zodToOpenAITool } from './utils'

/**
 * Client for OpenAI compatible APIs
 */
export class OpenAIClient implements LLMClient {
	config: Required<LLMConfig>
	private fetch: typeof globalThis.fetch

	constructor(config: Required<LLMConfig>) {
		this.config = config
		this.fetch = config.customFetch
	}

	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal?: AbortSignal,
		options?: InvokeOptions,
	): Promise<InvokeResult> {
		return this.invokeWithNamedToolChoiceFallback(messages, tools, abortSignal, options, false)
	}

	private async invokeWithNamedToolChoiceFallback(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal: AbortSignal | undefined,
		options: InvokeOptions | undefined,
		fallbackAttempted: boolean,
	): Promise<InvokeResult> {
		abortSignal?.throwIfAborted()

		// 1. Convert tools to OpenAI format
		const openaiTools = Object.entries(tools).map(([name, t]) => zodToOpenAITool(name, t))

		// Build request body

		const requestedToolChoiceName = shouldDisableNamedToolChoice(this.config)
			? undefined
			: options?.toolChoiceName
		const requestedNamedToolChoice = Boolean(requestedToolChoiceName)
		let toolChoice: unknown = 'required'
		if (requestedToolChoiceName) {
			toolChoice = { type: 'function', function: { name: requestedToolChoiceName } }
		}

		const requestBody: Record<string, unknown> = {
			model: this.config.model,
			temperature: this.config.temperature,
			messages,
			tools: openaiTools,
			parallel_tool_calls: false,
			tool_choice: toolChoice,
		}

		modelPatch(requestBody)
		let transformedBody: Record<string, unknown> | undefined
		try {
			transformedBody = this.config.transformRequestBody(requestBody)
		} catch (error) {
			throw new InvokeError(
				InvokeErrorTypes.CONFIG_ERROR,
				`transformRequestBody failed: ${(error as Error).message}`,
				error,
			)
		}
		const finalRequestBody = transformedBody ?? requestBody
		const canFallbackFromNamedToolChoice =
			!fallbackAttempted && requestedNamedToolChoice && hasNamedToolChoice(finalRequestBody)
		const retryWithoutNamedToolChoice = async (
			status: number,
			data: unknown,
		): Promise<InvokeResult | undefined> => {
			if (!canFallbackFromNamedToolChoice || !isNamedToolChoiceCompatibilityError(status, data)) {
				return undefined
			}

			await rememberNamedToolChoiceUnsupported(this.config)
			return this.invokeWithNamedToolChoiceFallback(messages, tools, abortSignal, options, true)
		}

		// 2. Call API
		let response: Response
		try {
			response = await this.fetch(`${this.config.baseURL}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
				},
				body: JSON.stringify(finalRequestBody),
				signal: abortSignal,
			})
		} catch (error: unknown) {
			if ((error as any)?.name === 'AbortError') throw error
			console.error(error)
			throw new InvokeError(InvokeErrorTypes.NETWORK_ERROR, 'Network request failed', error)
		}

		// 3. Handle HTTP errors
		if (!response.ok) {
			let errorData: unknown
			try {
				errorData = await response.json()
			} catch (error) {
				if (isAbortError(error)) throw error
			}
			const fallbackResult = await retryWithoutNamedToolChoice(response.status, errorData)
			if (fallbackResult) return fallbackResult
			throw createHttpInvokeError(
				response.status,
				readApiErrorMessage(errorData) || response.statusText,
				errorData,
			)
		}

		// 4. Parse and validate response
		let data: unknown
		try {
			data = await response.json()
		} catch (error) {
			if (isAbortError(error)) throw error
			throw new InvokeError(
				InvokeErrorTypes.INVALID_RESPONSE,
				'Response body is not valid JSON',
				error,
			)
		}
		const fallbackResult = await retryWithoutNamedToolChoice(response.status, data)
		if (fallbackResult) return fallbackResult
		throwIfCloudBaseErrorEnvelope(data)

		if (!isRecord(data) || !Array.isArray(data.choices)) {
			throw new InvokeError(InvokeErrorTypes.INVALID_SCHEMA, 'No choices in response', data)
		}
		const choice = data.choices[0] as unknown
		if (!choice) {
			throw new InvokeError(InvokeErrorTypes.INVALID_SCHEMA, 'No choices in response', data)
		}
		if (!isRecord(choice)) {
			throw new InvokeError(InvokeErrorTypes.INVALID_SCHEMA, 'Choice is not an object', data)
		}

		// Check finish_reason
		switch (choice.finish_reason) {
			case 'tool_calls':
			case 'function_call': // gemini
			case 'stop': // some models use this even with tool calls
				break
			case 'length':
				throw new InvokeError(
					InvokeErrorTypes.CONTEXT_LENGTH,
					'Response truncated: max tokens reached',
					undefined,
					data,
				)
			case 'content_filter':
				throw new InvokeError(
					InvokeErrorTypes.CONTENT_FILTER,
					'Content filtered by safety system',
					undefined,
					data,
				)
			default:
				throw new InvokeError(
					InvokeErrorTypes.INVALID_SCHEMA,
					`Unexpected finish_reason: ${choice.finish_reason}`,
					undefined,
					data,
				)
		}

		// Apply normalizeResponse if provided (for fixing format issues automatically)
		const normalizedData = options?.normalizeResponse ? options.normalizeResponse(data) : data
		const normalizedChoice = isRecord(normalizedData)
			? Array.isArray(normalizedData.choices)
				? normalizedData.choices[0]
				: undefined
			: undefined
		if (!isRecord(normalizedChoice)) {
			throw new InvokeError(
				InvokeErrorTypes.INVALID_SCHEMA,
				'Normalized choice is not an object',
				undefined,
				data,
			)
		}

		// Get tool name from response
		const normalizedMessage = readRecord(normalizedChoice.message)
		const normalizedToolCalls = Array.isArray(normalizedMessage?.tool_calls)
			? normalizedMessage.tool_calls
			: []
		const normalizedToolCall = readRecord(normalizedToolCalls[0])
		const normalizedFunction = readRecord(normalizedToolCall?.function)
		const toolCallName =
			typeof normalizedFunction?.name === 'string' ? normalizedFunction.name : undefined
		if (!toolCallName) {
			throw new InvokeError(
				InvokeErrorTypes.NO_TOOL_CALL,
				'No tool call found in response',
				undefined,
				data,
			)
		}

		const tool = tools[toolCallName]
		if (!tool) {
			throw new InvokeError(
				InvokeErrorTypes.UNKNOWN,
				`Tool "${toolCallName}" not found in tools`,
				undefined,
				data,
			)
		}

		// Extract and parse tool arguments
		const argString =
			typeof normalizedFunction?.arguments === 'string' ? normalizedFunction.arguments : undefined
		if (!argString) {
			throw new InvokeError(
				InvokeErrorTypes.INVALID_TOOL_ARGS,
				'No tool call arguments found',
				undefined,
				data,
			)
		}

		let parsedArgs: unknown
		try {
			parsedArgs = JSON.parse(argString)
		} catch (error) {
			throw new InvokeError(
				InvokeErrorTypes.INVALID_TOOL_ARGS,
				'Failed to parse tool arguments as JSON',
				error,
				data,
			)
		}

		// Validate with schema
		const validation = tool.inputSchema.safeParse(parsedArgs)
		if (!validation.success) {
			console.error(z.prettifyError(validation.error))
			throw new InvokeError(
				InvokeErrorTypes.INVALID_TOOL_ARGS,
				'Tool arguments validation failed',
				validation.error,
				data,
			)
		}
		const toolInput = validation.data

		// 5. Execute tool
		let toolResult: unknown
		try {
			toolResult = await tool.execute(toolInput)
		} catch (error: unknown) {
			if ((error as any)?.name === 'AbortError') throw error
			throw new InvokeError(
				InvokeErrorTypes.TOOL_EXECUTION_ERROR,
				`Tool execution failed: ${(error as Error)?.message}`,
				error,
				data,
			)
		}

		// Return result
		return {
			toolCall: {
				name: toolCallName,
				args: toolInput,
			},
			toolResult,
			usage: {
				promptTokens: readNumber(readRecord(data.usage)?.prompt_tokens) ?? 0,
				completionTokens: readNumber(readRecord(data.usage)?.completion_tokens) ?? 0,
				totalTokens: readNumber(readRecord(data.usage)?.total_tokens) ?? 0,
				cachedTokens: readNumber(
					readRecord(readRecord(data.usage)?.prompt_tokens_details)?.cached_tokens,
				),
				reasoningTokens: readNumber(
					readRecord(readRecord(data.usage)?.completion_tokens_details)?.reasoning_tokens,
				),
			},
			rawResponse: data,
			rawRequest: finalRequestBody,
		}
	}
}

function throwIfCloudBaseErrorEnvelope(data: unknown): void {
	const envelope = readRecord(data)
	if (!envelope) return
	const statusCode = readNumber(envelope.statusCode)
	if (!statusCode || statusCode < 400) return

	const rawBody = typeof envelope.body === 'string' ? envelope.body : undefined
	const parsedBody = rawBody ? parseJson(rawBody) : envelope.body
	const fallbackMessage = statusCode === 401 ? 'Missing bearer token' : `HTTP ${statusCode}`
	const message = normalizeAuthMessage(
		statusCode,
		readApiErrorMessage(parsedBody) || fallbackMessage,
	)
	throw createHttpInvokeError(statusCode, message, data)
}

function createHttpInvokeError(status: number, message: string, rawError: unknown): InvokeError {
	if (status === 401 || status === 403) {
		return new InvokeError(
			InvokeErrorTypes.AUTH_ERROR,
			`Authentication failed: ${normalizeAuthMessage(status, message)}`,
			rawError,
		)
	}
	if (status === 429) {
		return new InvokeError(InvokeErrorTypes.RATE_LIMIT, `Rate limit exceeded: ${message}`, rawError)
	}
	if (status >= 500) {
		return new InvokeError(InvokeErrorTypes.SERVER_ERROR, `Server error: ${message}`, rawError)
	}
	return new InvokeError(InvokeErrorTypes.UNKNOWN, `HTTP ${status}: ${message}`, rawError)
}

function normalizeAuthMessage(status: number, message: string): string {
	if (status === 401 && /missing bearer token/i.test(message)) {
		return '无权限：请先在问学启动器登录问学账号并重新启动浏览器。'
	}
	return message
}

function readApiErrorMessage(value: unknown): string | undefined {
	const record = readRecord(value)
	if (!record) return undefined
	const error = readRecord(record.error)
	if (typeof error?.message === 'string') return error.message
	if (typeof record.message === 'string') return record.message
	return undefined
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isAbortError(error: unknown): boolean {
	return isRecord(error) && error.name === 'AbortError'
}
