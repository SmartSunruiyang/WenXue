import type { LLMConfig } from '@page-agent/llms'
import * as z from 'zod/v4'

const TOOL_NAME = 'submit_answer'

/**
 * Build an OpenAI-format `function` tool from a Zod schema.
 *
 * Self-contained on purpose: this feature has zero coupling to `packages/*`
 * internals. It mirrors what the vendored `zodToOpenAITool` does (Zod 4 native
 * `z.toJSONSchema` with the OpenAPI 3.0 target) so the model receives the schema
 * as the tool's parameters.
 */
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

/** Qwen / 阿里云 DashScope 识别（用于「思考模式」下强制 tool_choice 的适配）。 */
function isQwenLike(cfg: LLMConfig): boolean {
	return /dashscope|aliyuncs/i.test(cfg.baseURL) || /^qwen/i.test(cfg.model)
}

export interface AskStructuredOptions {
	signal?: AbortSignal
	fetchImpl?: typeof fetch
}

/**
 * 一条聊天消息的 content：纯文本题为 `string`；含图题为 OpenAI 兼容的交错块数组
 * （文本块 + `image_url` 块，由 {@link serializeQuestion} 产出，§8.2）。两者原样进入请求体。
 */
export type LLMMessageContent =
	| string
	| Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

/** 进入 `askStructured` 的一条消息（content 允许多模态数组，透传给 provider）。 */
export interface LLMMessage {
	role: string
	content: LLMMessageContent
}

/** 含图题：serialize 的多模态分支把 user content 产成交错块数组；纯文本题 content 为 string。 */
function hasImageContent(messages: LLMMessage[]): boolean {
	return messages.some((message) => Array.isArray(message.content))
}

/**
 * Thin structured LLM client (own fetch).
 *
 * Sends an OpenAI chat-completions request that FORCES a tool call to
 * `submit_answer`, whose argument schema is `schema`. The model is therefore
 * obliged to return structured output matching the per-question payload schema —
 * no fuzzy parsing. Mirrors the URL/headers/body conventions of the vendored
 * `OpenAIClient`.
 *
 * We write our own client (instead of using the package's `LLM` class) because
 * that package's `Message.content` is `string | null` and cannot carry the
 * interleaved multimodal content this feature needs (Task 9): `messages[].content`
 * here may be a `string` (text-only question) OR an array of text / `image_url`
 * blocks (image question), and is forwarded into the request body unchanged.
 *
 * Injectable `fetchImpl` keeps this unit-testable with no real network.
 *
 * @returns the schema-validated tool-call arguments.
 * @throws if the response is missing the tool call, the arguments are not valid
 *   JSON, the arguments fail `schema` validation, or the HTTP status is not OK.
 */
export async function askStructured(
	cfg: LLMConfig,
	messages: LLMMessage[],
	schema: z.ZodType,
	opts?: AskStructuredOptions,
): Promise<unknown> {
	const fetchImpl = opts?.fetchImpl ?? globalThis.fetch

	const tool = toOpenAIFunctionTool(TOOL_NAME, '提交本题的结构化答案', schema)

	// 请求用 OpenAI 格式的强制 tool_choice + temperature:0 保证结构化输出。
	const body: Record<string, unknown> = {
		model: cfg.model,
		messages,
		temperature: 0,
		tools: [tool],
		tool_choice: { type: 'function', function: { name: TOOL_NAME } },
	}
	// 搜题要正确率 → 全开思考（含图题的多步读图推理离不开它）。但 Qwen3「思考模式」会拒绝被
	// 强制(required/object)的 tool_choice（DashScope 400："tool_choice ... not support ... required
	// or object in thinking mode"）：仅纯文本题（走文本模型）会撞，故放宽为 'auto'（模型若不调
	// submit_answer，上游退化为 needsReview，绝不瞎答）；含图题（走视觉模型）实测强制 tool_choice +
	// 思考不 400，保留强制以硬保证结构化输出。非思考模型会忽略 enable_thinking。
	if (isQwenLike(cfg)) {
		body.enable_thinking = true
		if (!hasImageContent(messages)) {
			body.tool_choice = 'auto'
		}
	}

	const post = (requestBody: Record<string, unknown>) =>
		fetchImpl(`${cfg.baseURL}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
			},
			body: JSON.stringify(requestBody),
			signal: opts?.signal,
		})

	let response = await post(body)

	// 兜底：若强制 tool_choice 仍因「思考模式」被拒（含图题极端情形），重试一次——保持思考、放宽
	// tool_choice 为 'auto'。系统提示仍要求调用 submit_answer；万一模型不调用工具，上游退化为 needsReview，绝不错答。
	if (response.status === 400) {
		const message = await readErrorMessage(response)
		if (/tool_choice/i.test(message) && /think/i.test(message)) {
			response = await post({ ...body, tool_choice: 'auto' })
		} else {
			throw new Error(`LLM request failed (HTTP 400): ${message}`)
		}
	}

	if (!response.ok) {
		const message = await readErrorMessage(response)
		throw new Error(`LLM request failed (HTTP ${response.status}): ${message}`)
	}

	const data: unknown = await response.json()
	const argString = extractToolArguments(data)
	if (argString === undefined) {
		throw new Error('LLM response missing tool call arguments for submit_answer')
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(argString)
	} catch (error) {
		throw new Error(`Failed to parse LLM tool arguments as JSON: ${(error as Error).message}`)
	}

	return schema.parse(parsed)
}

/**
 * Pull `choices[0].message.tool_calls[0].function.arguments` out of an OpenAI
 * chat-completions response, returning `undefined` if any hop is missing.
 */
function extractToolArguments(data: unknown): string | undefined {
	const choice = (data as { choices?: unknown[] })?.choices?.[0]
	const toolCall = (choice as { message?: { tool_calls?: unknown[] } } | undefined)?.message
		?.tool_calls?.[0]
	const args = (toolCall as { function?: { arguments?: unknown } } | undefined)?.function?.arguments
	return typeof args === 'string' ? args : undefined
}

async function readErrorMessage(response: Response): Promise<string> {
	try {
		const data = (await response.json()) as { error?: { message?: string } }
		return data?.error?.message ?? response.statusText
	} catch {
		return response.statusText
	}
}
