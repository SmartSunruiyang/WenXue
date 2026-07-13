import type { LLMConfig } from '@page-agent/llms'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'

import { askStructured, type LLMMessage } from './llm'

const cfg: LLMConfig = {
	baseURL: 'https://api.example.com/v1',
	model: 'gpt-4o-mini',
	apiKey: 'sk-test-123',
}

const messages = [
	{ role: 'system', content: 'sys' },
	{ role: 'user', content: 'usr' },
]

function cannedResponse(args: unknown): Response {
	const body = {
		choices: [
			{
				finish_reason: 'tool_calls',
				message: {
					tool_calls: [
						{
							function: {
								name: 'submit_answer',
								arguments: JSON.stringify(args),
							},
						},
					],
				},
			},
		],
	}
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

describe('askStructured', () => {
	it('returns the schema-parsed tool-call arguments', async () => {
		const schema = z.object({ selectedOptions: z.array(z.enum(['A', 'B'])).length(1) })
		const fetchImpl = vi.fn().mockResolvedValue(cannedResponse({ selectedOptions: ['B'] }))

		const result = await askStructured(cfg, messages, schema, { fetchImpl })

		expect(result).toEqual({ selectedOptions: ['B'] })
	})

	it('POSTs to the chat-completions endpoint with bearer auth and JSON body', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const fetchImpl = vi.fn().mockResolvedValue(cannedResponse({ selectedOptions: ['A'] }))

		await askStructured(cfg, messages, schema, { fetchImpl })

		expect(fetchImpl).toHaveBeenCalledTimes(1)
		const [url, init] = fetchImpl.mock.calls[0]
		expect(url).toBe('https://api.example.com/v1/chat/completions')
		expect(init.method).toBe('POST')
		expect(init.headers['Content-Type']).toBe('application/json')
		expect(init.headers.Authorization).toBe('Bearer sk-test-123')
	})

	it('forces a tool call to submit_answer and carries the schema in the tool', async () => {
		const schema = z.object({ blanks: z.array(z.string()).length(2) })
		const fetchImpl = vi.fn().mockResolvedValue(cannedResponse({ blanks: ['x', 'y'] }))

		await askStructured(cfg, messages, schema, { fetchImpl })

		const init = fetchImpl.mock.calls[0][1]
		const body = JSON.parse(init.body)

		expect(body.model).toBe('gpt-4o-mini')
		expect(body.messages).toEqual(messages)
		expect(body.temperature).toBe(0)
		expect(body.tool_choice).toEqual({
			type: 'function',
			function: { name: 'submit_answer' },
		})
		expect(Array.isArray(body.tools)).toBe(true)
		expect(body.tools).toHaveLength(1)
		expect(body.tools[0].type).toBe('function')
		expect(body.tools[0].function.name).toBe('submit_answer')
		// schema is carried as JSON-schema parameters describing the blanks payload
		expect(body.tools[0].function.parameters).toBeTruthy()
		expect(JSON.stringify(body.tools[0].function.parameters)).toContain('blanks')
	})

	it('remembers named tool_choice incompatibility and retries with required', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const onNamedToolChoiceUnsupported = vi.fn(async () => {})
		const model = { ...cfg, onNamedToolChoiceUnsupported }
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						error: {
							param: 'tool_choice',
							message: "Invalid tool_choice type: 'object'; expected string",
						},
					}),
					{ status: 422, headers: { 'Content-Type': 'application/json' } },
				),
			)
			.mockResolvedValueOnce(cannedResponse({ selectedOptions: ['A'] }))

		await expect(askStructured(model, messages, schema, { fetchImpl })).resolves.toEqual({
			selectedOptions: ['A'],
		})

		expect(fetchImpl).toHaveBeenCalledTimes(2)
		expect(JSON.parse(fetchImpl.mock.calls[0][1].body).tool_choice).toEqual({
			type: 'function',
			function: { name: 'submit_answer' },
		})
		expect(JSON.parse(fetchImpl.mock.calls[1][1].body).tool_choice).toBe('required')
		expect(model.disableNamedToolChoice).toBe(true)
		expect(onNamedToolChoiceUnsupported).toHaveBeenCalledOnce()
	})

	it('passes the abort signal through to fetch', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const fetchImpl = vi.fn().mockResolvedValue(cannedResponse({ selectedOptions: ['A'] }))
		const controller = new AbortController()

		await askStructured(cfg, messages, schema, { fetchImpl, signal: controller.signal })

		expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal)
	})

	it('throws when the response has no tool call', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const malformed = new Response(
			JSON.stringify({ choices: [{ message: { content: 'hi, no tool here' } }] }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		)
		const fetchImpl = vi.fn().mockResolvedValue(malformed)

		await expect(askStructured(cfg, messages, schema, { fetchImpl })).rejects.toThrow()
	})

	it('throws when the tool-call arguments fail schema validation', async () => {
		const schema = z.object({ selectedOptions: z.array(z.enum(['A', 'B'])).length(1) })
		// 'Z' is out of the enum -> schema.parse must reject.
		const fetchImpl = vi.fn().mockResolvedValue(cannedResponse({ selectedOptions: ['Z'] }))

		await expect(askStructured(cfg, messages, schema, { fetchImpl })).rejects.toThrow()
	})

	it('throws on a non-OK HTTP response', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { message: 'bad key' } }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			}),
		)

		await expect(askStructured(cfg, messages, schema, { fetchImpl })).rejects.toThrow()
	})

	it('falls back to globalThis.fetch when no fetchImpl is supplied', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const spy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(cannedResponse({ selectedOptions: ['A'] }))
		try {
			const result = await askStructured(cfg, messages, schema)
			expect(result).toEqual({ selectedOptions: ['A'] })
			expect(spy).toHaveBeenCalledTimes(1)
		} finally {
			spy.mockRestore()
		}
	})

	const qwenCfg: LLMConfig = {
		baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		model: 'qwen3.7-max',
		apiKey: 'sk-q',
	}

	/** 含图题：serialize 的多模态分支把 user content 产成交错块数组（文本块 + image_url 块）。 */
	const imageMessages: LLMMessage[] = [
		{ role: 'system', content: 'sys' },
		{
			role: 'user',
			content: [
				{ type: 'text', text: 'q' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
			],
		},
	]

	it('enables thinking and relaxes tool_choice to auto for text-only Qwen questions', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const fetchImpl = vi.fn().mockResolvedValue(cannedResponse({ selectedOptions: ['A'] }))

		await askStructured(qwenCfg, messages, schema, { fetchImpl })

		const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
		expect(body.enable_thinking).toBe(true)
		expect(body.tool_choice).toBe('auto')
	})

	it('enables thinking but keeps forced tool_choice for Qwen image questions', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const fetchImpl = vi.fn().mockResolvedValue(cannedResponse({ selectedOptions: ['A'] }))

		await askStructured(qwenCfg, imageMessages, schema, { fetchImpl })

		const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
		expect(body.enable_thinking).toBe(true)
		expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'submit_answer' } })
	})

	it('does NOT add enable_thinking for non-Qwen providers', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const fetchImpl = vi.fn().mockResolvedValue(cannedResponse({ selectedOptions: ['A'] }))

		await askStructured(cfg, messages, schema, { fetchImpl })

		const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
		expect(body.enable_thinking).toBeUndefined()
	})

	it('retries image questions with relaxed tool_choice while keeping thinking when forced tool_choice is rejected', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const thinkingErr = new Response(
			JSON.stringify({
				error: {
					message:
						'The tool_choice parameter does not support being set to required or object in thinking mode',
				},
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		)
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(thinkingErr)
			.mockResolvedValueOnce(cannedResponse({ selectedOptions: ['A'] }))

		const result = await askStructured(qwenCfg, imageMessages, schema, { fetchImpl })

		expect(result).toEqual({ selectedOptions: ['A'] })
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		const retryBody = JSON.parse(fetchImpl.mock.calls[1][1].body)
		expect(retryBody.tool_choice).toBe('auto')
		expect(retryBody.enable_thinking).toBe(true)
	})

	it('still throws on a 400 that is not the thinking-mode tool_choice case', async () => {
		const schema = z.object({ selectedOptions: z.array(z.string()) })
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { message: 'bad request: missing model' } }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			}),
		)

		await expect(askStructured(qwenCfg, messages, schema, { fetchImpl })).rejects.toThrow()
		expect(fetchImpl).toHaveBeenCalledTimes(1)
	})
})
