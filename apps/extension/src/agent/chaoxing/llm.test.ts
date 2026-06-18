import type { LLMConfig } from '@page-agent/llms'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'

import { askStructured } from './llm'

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
})
