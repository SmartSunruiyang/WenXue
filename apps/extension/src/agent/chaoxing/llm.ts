import type { LLMConfig } from '@page-agent/llms'
import type * as z from 'zod/v4'

// The vendored package does not re-export this helper from its index, and its
// `exports` map only exposes the package root — so we deep-import the source
// directly (read-only; we do not modify the vendored package). This reuses the
// exact JSON-schema conversion the upstream OpenAIClient uses for tool calls.
import { zodToOpenAITool } from '../../../../../packages/llms/src/utils'

const TOOL_NAME = 'submit_answer'

export interface AskStructuredOptions {
	signal?: AbortSignal
	fetchImpl?: typeof fetch
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
 * multimodal content this feature will need (Task 9).
 *
 * Injectable `fetchImpl` keeps this unit-testable with no real network.
 *
 * @returns the schema-validated tool-call arguments.
 * @throws if the response is missing the tool call, the arguments are not valid
 *   JSON, the arguments fail `schema` validation, or the HTTP status is not OK.
 */
export async function askStructured(
	cfg: LLMConfig,
	messages: { role: string; content: string }[],
	schema: z.ZodType,
	opts?: AskStructuredOptions,
): Promise<unknown> {
	const fetchImpl = opts?.fetchImpl ?? globalThis.fetch

	const tool = zodToOpenAITool(TOOL_NAME, {
		inputSchema: schema,
		description: '提交本题的结构化答案',
		execute: async () => undefined,
	})

	const body = {
		model: cfg.model,
		messages,
		temperature: 0,
		tools: [tool],
		tool_choice: { type: 'function', function: { name: TOOL_NAME } },
	}

	const response = await fetchImpl(`${cfg.baseURL}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
		},
		body: JSON.stringify(body),
		signal: opts?.signal,
	})

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
