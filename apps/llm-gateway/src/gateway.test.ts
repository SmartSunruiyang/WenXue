import { describe, expect, it } from 'vitest'

import {
	assertUsageRecordSafe,
	buildDashScopeRequest,
	buildUsageSummary,
	buildUsageRecord,
	extractBearerToken,
	extractUsageFromSseFrame,
	handleChatCompletions,
	handleUsageSummary,
	readUsageRecords,
	resolveCloudBaseUser,
	writeUsageRecord,
} from './gateway.mjs'
import { main, usageSummary } from './index.mjs'

describe('CloudBase LLM gateway M0 behavior', () => {
	it('injects stream_options.include_usage for streamed DashScope requests without mutating input', () => {
		const input = {
			model: 'qwen-plus',
			stream: true,
			stream_options: { include_usage: false },
			messages: [{ role: 'user', content: 'ping' }],
		}

		const request = buildDashScopeRequest(input, 'server-dashscope-key')

		expect(request.body).toEqual({
			model: 'qwen-plus',
			stream: true,
			stream_options: { include_usage: true },
			messages: [{ role: 'user', content: 'ping' }],
		})
		expect(input.stream_options.include_usage).toBe(false)
		expect(request.headers.authorization).toBe('Bearer server-dashscope-key')
	})

	it('preserves vision, tool choice, and thinking parameters when proxying requests', () => {
		const input = {
			model: 'qwen-vl-plus',
			stream: true,
			tool_choice: 'auto',
			tools: [{ type: 'function', function: { name: 'search' } }],
			enable_thinking: true,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'read this' },
						{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
					],
				},
			],
		}

		const request = buildDashScopeRequest(input, 'server-dashscope-key')

		expect(request.body).toMatchObject({
			model: 'qwen-vl-plus',
			stream: true,
			tool_choice: 'auto',
			tools: [{ type: 'function', function: { name: 'search' } }],
			enable_thinking: true,
			messages: input.messages,
			stream_options: { include_usage: true },
		})
	})

	it('extracts non-zero usage from a streamed SSE data frame', () => {
		const usage = extractUsageFromSseFrame(
			'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":5,"total_tokens":12}}\n\n',
		)

		expect(usage).toEqual({
			inputTokens: 7,
			outputTokens: 5,
			totalTokens: 12,
		})
	})

	it('builds a uid-scoped usage record without prompt, key, or authorization leaks', () => {
		const record = buildUsageRecord({
			uid: 'uid-m0',
			model: 'qwen-plus',
			usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
			latencyMs: 321,
			requestId: 'req-m0',
			now: () => 1782604800000,
		})

		expect(record).toMatchObject({
			uid: 'uid-m0',
			model: 'qwen-plus',
			inputTokens: 3,
			outputTokens: 4,
			totalTokens: 7,
			latencyMs: 321,
			requestId: 'req-m0',
			createdAt: '2026-06-28T00:00:00.000Z',
		})
		expect(() => assertUsageRecordSafe(record)).not.toThrow()
		expect(JSON.stringify(record)).not.toMatch(/prompt|content|authorization|bearer|sk-/i)
	})

	it('rejects missing bearer tokens before proxying', async () => {
		await expect(
			resolveCloudBaseUser({
				headers: {},
				envId: 'wenxue-d8gz76tacc3659f05',
				clientId: 'wenxue-d8gz76tacc3659f05',
				clientSecret: '',
				fetchImpl: async () => new Response('{}'),
			}),
		).rejects.toThrow('Missing bearer token')
	})

	it('resolves uid through CloudBase token introspection', async () => {
		const calls: Array<{ url: string; authorization: string | null; deviceId: string | null }> = []
		const user = await resolveCloudBaseUser({
			headers: { authorization: 'Bearer app-access-token' },
			envId: 'wenxue-d8gz76tacc3659f05',
			clientId: 'client-id',
			fetchImpl: async (url, init) => {
				const headers = new Headers(init?.headers)
				calls.push({
					url: String(url),
					authorization: headers.get('authorization'),
					deviceId: headers.get('x-device-id'),
				})
				return Response.json({
					sub: 'uid-from-cloudbase',
				})
			},
		})

		expect(user).toEqual({ uid: 'uid-from-cloudbase' })
		expect(calls).toEqual([
			{
				url: 'https://wenxue-d8gz76tacc3659f05.api.tcloudbasegateway.com/auth/v1/token/introspect?client_id=client-id',
				authorization: 'Bearer app-access-token',
				deviceId: 'wenxue-llm-gateway',
			},
		])
	})

	it('rejects inactive or malformed CloudBase tokens', async () => {
		await expect(
			resolveCloudBaseUser({
				headers: { authorization: 'Bearer inactive-token' },
				envId: 'wenxue-d8gz76tacc3659f05',
				clientId: 'client-id',
				fetchImpl: async () => Response.json({ active: false }),
			}),
		).rejects.toThrow('CloudBase token is inactive')

		await expect(
			resolveCloudBaseUser({
				headers: { authorization: 'Bearer malformed-token' },
				envId: 'wenxue-d8gz76tacc3659f05',
				clientId: 'client-id',
				fetchImpl: async () => Response.json({}),
			}),
		).rejects.toThrow('CloudBase token has no uid')
	})

	it('extracts bearer tokens case-insensitively', () => {
		expect(extractBearerToken({ Authorization: 'Bearer token-1' })).toBe('token-1')
		expect(extractBearerToken(new Headers({ authorization: 'Bearer token-2' }))).toBe('token-2')
	})

	it('proxies streamed DashScope SSE and returns a safe usage record', async () => {
		const dashScopeBodies: unknown[] = []
		const usageWrites: unknown[] = []
		const sentChunks: string[] = []
		let ended = false

		const result = await handleChatCompletions({
			headers: { authorization: 'Bearer cloudbase-access-token' },
			rawBody: JSON.stringify({
				model: 'qwen-plus',
				stream: true,
				messages: [{ role: 'user', content: 'hello' }],
			}),
			sse: {
				closed: false,
				send(chunk: string) {
					sentChunks.push(chunk)
				},
				end() {
					ended = true
				},
				on() {},
			},
			env: {
				cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
				cloudbaseClientId: 'client-id',
				cloudbaseClientSecret: '',
				cloudbaseUsageApiKey: 'cloudbase-usage-api-key',
				dashscopeApiKey: 'server-dashscope-key',
			},
			now: (() => {
				const ticks = [1782633600000, 1782633600456]
				return () => ticks.shift() ?? 1782633600456
			})(),
			fetchImpl: async (url, init) => {
				if (String(url).includes('/auth/v1/token/introspect')) {
					return Response.json({ active: true, sub: 'uid-m0' })
				}

				if (String(url).includes('/v1/database/')) {
					usageWrites.push(JSON.parse(String(init?.body)))
					return Response.json({ insertedIds: ['usage-record-id'] }, { status: 201 })
				}

				dashScopeBodies.push(JSON.parse(String(init?.body)))
				const body = new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder()
						controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
						controller.enqueue(
							encoder.encode(
								'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
							),
						)
						controller.enqueue(encoder.encode('data: [DONE]\n\n'))
						controller.close()
					},
				})
				return new Response(body, {
					status: 200,
					headers: { 'content-type': 'text/event-stream' },
				})
			},
		})

		expect(dashScopeBodies).toEqual([
			{
				model: 'qwen-plus',
				stream: true,
				stream_options: { include_usage: true },
				messages: [{ role: 'user', content: 'hello' }],
			},
		])
		expect(sentChunks.join('')).toContain('data: {"choices":[{"delta":{"content":"hi"}}]}')
		expect(ended).toBe(true)
		expect(result.usageRecord).toMatchObject({
			uid: 'uid-m0',
			model: 'qwen-plus',
			inputTokens: 2,
			outputTokens: 3,
			totalTokens: 5,
			latencyMs: 456,
		})
		expect(result.usagePersisted).toBe(true)
		expect(usageWrites).toHaveLength(1)
		expect(usageWrites[0]).toMatchObject({
			data: [
				{
					uid: 'uid-m0',
					model: 'qwen-plus',
					totalTokens: 5,
				},
			],
		})
		expect(() => assertUsageRecordSafe(result.usageRecord)).not.toThrow()
	})

	it('fails instead of writing zero usage when upstream omits usage', async () => {
		await expect(
			handleChatCompletions({
				headers: { authorization: 'Bearer cloudbase-access-token' },
				rawBody: JSON.stringify({
					model: 'qwen-plus',
					stream: false,
					messages: [{ role: 'user', content: 'hello' }],
				}),
				env: {
					cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
					cloudbaseClientId: 'client-id',
					cloudbaseClientSecret: '',
					cloudbaseUsageApiKey: 'cloudbase-usage-api-key',
					dashscopeApiKey: 'server-dashscope-key',
				},
				fetchImpl: async (url) => {
					if (String(url).includes('/auth/v1/token/introspect')) {
						return Response.json({ sub: 'uid-m1' })
					}
					return Response.json({ choices: [{ message: { content: 'hello' } }] })
				},
			}),
		).rejects.toThrow('DashScope usage is missing from upstream response')
	})

	it('writes usage records through the CloudBase NoSQL REST API without sensitive fields', async () => {
		const calls: Array<{ url: string; authorization: string | null; body: unknown }> = []
		await writeUsageRecord({
			record: buildUsageRecord({
				uid: 'uid-m1',
				model: 'qwen-plus',
				usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
				latencyMs: 123,
				requestId: 'req-m1',
				now: () => 1782659500000,
			}),
			envId: 'wenxue-d8gz76tacc3659f05',
			apiKey: 'cloudbase-usage-api-key',
			fetchImpl: async (url, init) => {
				const headers = new Headers(init?.headers)
				calls.push({
					url: String(url),
					authorization: headers.get('authorization'),
					body: JSON.parse(String(init?.body)),
				})
				return Response.json({ insertedIds: ['req-m1'] }, { status: 201 })
			},
		})

		expect(calls).toEqual([
			{
				url: 'https://wenxue-d8gz76tacc3659f05.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)/collections/token_usage/documents',
				authorization: 'Bearer cloudbase-usage-api-key',
				body: {
					data: [
						expect.objectContaining({
							uid: 'uid-m1',
							model: 'qwen-plus',
							totalTokens: 5,
						}),
					],
				},
			},
		])
		expect(JSON.stringify(calls[0].body)).not.toMatch(/prompt|content|authorization|bearer|api_key|apikey|sk-/i)
	})

	it('reads authorization from CloudBase Functions Framework httpContext headers', async () => {
		const previousFetch = globalThis.fetch
		const previousDashScopeKey = process.env.DASHSCOPE_API_KEY
		const previousUsageApiKey = process.env.CLOUDBASE_USAGE_API_KEY
		process.env.DASHSCOPE_API_KEY = 'server-dashscope-key'
		process.env.CLOUDBASE_USAGE_API_KEY = 'cloudbase-usage-api-key'

		const calls: Array<{ url: string; authorization: string | null }> = []
		globalThis.fetch = (async (url, init) => {
			const headers = new Headers(init?.headers)
			calls.push({
				url: String(url),
				authorization: headers.get('authorization'),
			})

			if (String(url).includes('/auth/v1/token/introspect')) {
				return Response.json({ sub: 'external-user-uid' })
			}

			if (String(url).includes('/v1/database/')) {
				return Response.json({ insertedIds: ['usage-record-id'] }, { status: 201 })
			}

			return Response.json({
				choices: [{ message: { role: 'assistant', content: 'ok' } }],
				usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
			})
		}) as typeof fetch

		try {
			const result = await main(
				{
					model: 'qwen-plus',
					stream: false,
					messages: [{ role: 'user', content: 'hello' }],
				},
				{
					httpContext: {
						headers: {
							authorization: 'Bearer product-user-token',
						},
					},
					sse() {
						throw new Error('SSE should not be used for non-stream requests')
					},
				},
			)

			expect(calls[0]).toMatchObject({
				url: 'https://wenxue-d8gz76tacc3659f05.api.tcloudbasegateway.com/auth/v1/token/introspect?client_id=wenxue-d8gz76tacc3659f05',
				authorization: 'Bearer product-user-token',
			})
			expect(result).toMatchObject({
				usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
			})
		} finally {
			globalThis.fetch = previousFetch
			if (previousDashScopeKey === undefined) {
				delete process.env.DASHSCOPE_API_KEY
			} else {
				process.env.DASHSCOPE_API_KEY = previousDashScopeKey
			}
			if (previousUsageApiKey === undefined) {
				delete process.env.CLOUDBASE_USAGE_API_KEY
			} else {
				process.env.CLOUDBASE_USAGE_API_KEY = previousUsageApiKey
			}
		}
	})

	it('builds token usage summary without leaking uid or sensitive fields', () => {
		const summary = buildUsageSummary([
			{
				_id: 'uid-m4:req-1:1782660000000',
				ts: 1782660000000,
				uid: 'uid-m4',
				model: 'qwen-plus',
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				latencyMs: 500,
				requestId: 'req-1',
				createdAt: '2026-06-28T15:20:00.000Z',
			},
			{
				_id: 'uid-m4:req-2:1782663600000',
				ts: 1782663600000,
				uid: 'uid-m4',
				model: 'qwen3.7-plus',
				inputTokens: 100,
				outputTokens: 50,
				totalTokens: 150,
				latencyMs: 700,
				requestId: 'req-2',
				createdAt: '2026-06-28T16:20:00.000Z',
			},
		])

		expect(summary).toMatchObject({
			totalInputTokens: 110,
			totalOutputTokens: 70,
			totalTokens: 180,
			byBrowser: [{ key: 'cloud', totalTokens: 180 }],
			byModel: [
				{ key: 'qwen3.7-plus', totalTokens: 150 },
				{ key: 'qwen-plus', totalTokens: 30 },
			],
			daily: [{ key: '2026-06-28', totalTokens: 180 }],
		})
		expect(summary.recent[0]).toEqual(
			expect.objectContaining({
				id: 'req-2:1782663600000',
				browserId: 'cloud',
				model: 'qwen3.7-plus',
				totalTokens: 150,
			}),
		)
		expect(JSON.stringify(summary)).not.toMatch(/uid-m4|authorization|bearer|api_key|apikey|sk-/i)
	})

	it('queries token_usage records for the authenticated uid', async () => {
		const calls: Array<{ url: string; authorization: string | null }> = []
		const records = await readUsageRecords({
			uid: 'uid-m4',
			envId: 'wenxue-d8gz76tacc3659f05',
			apiKey: 'cloudbase-usage-api-key',
			fetchImpl: async (url, init) => {
				const headers = new Headers(init?.headers)
				calls.push({ url: String(url), authorization: headers.get('authorization') })
				return Response.json({
					list: [
						{
							_id: 'record-1',
							uid: 'uid-m4',
							model: 'qwen-plus',
							inputTokens: { $numberInt: '2' },
							outputTokens: { $numberInt: '3' },
							totalTokens: { $numberInt: '5' },
							latencyMs: { $numberInt: '123' },
							requestId: 'req-1',
							ts: { $numberLong: '1782660000000' },
							createdAt: '2026-06-28T15:20:00.000Z',
						},
					],
				})
			},
		})

		expect(records).toEqual([
			expect.objectContaining({
				_id: 'record-1',
				uid: 'uid-m4',
				totalTokens: 5,
				ts: 1782660000000,
			}),
		])
		expect(calls[0]?.authorization).toBe('Bearer cloudbase-usage-api-key')
		expect(decodeURIComponent(calls[0]?.url ?? '')).toContain('"uid":"uid-m4"')
	})

	it('returns a cloud usage summary for the bearer token uid', async () => {
		const result = await handleUsageSummary({
			headers: { authorization: 'Bearer product-user-token' },
			env: {
				cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
				cloudbaseClientId: 'client-id',
				cloudbaseClientSecret: '',
				cloudbaseUsageApiKey: 'cloudbase-usage-api-key',
				dashscopeApiKey: 'server-dashscope-key',
			},
			fetchImpl: async (url) => {
				if (String(url).includes('/auth/v1/token/introspect')) {
					return Response.json({ active: true, sub: 'uid-m4' })
				}
				return Response.json({
					list: [
						{
							_id: 'record-1',
							uid: 'uid-m4',
							model: 'qwen-plus',
							inputTokens: 2,
							outputTokens: 3,
							totalTokens: 5,
							latencyMs: 123,
							requestId: 'req-1',
							ts: 1782660000000,
							createdAt: '2026-06-28T15:20:00.000Z',
						},
					],
				})
			},
		})

		expect(result).toMatchObject({
			totalInputTokens: 2,
			totalOutputTokens: 3,
			totalTokens: 5,
			byModel: [{ key: 'qwen-plus', totalTokens: 5 }],
		})
	})

	it('exposes usage summary through its own Function mode target', async () => {
		const previousFetch = globalThis.fetch
		const previousUsageApiKey = process.env.CLOUDBASE_USAGE_API_KEY
		process.env.CLOUDBASE_USAGE_API_KEY = 'cloudbase-usage-api-key'
		globalThis.fetch = (async (url) => {
			if (String(url).includes('/auth/v1/token/introspect')) {
				return Response.json({ active: true, sub: 'uid-m4' })
			}
			return Response.json({
				list: [
					{
						_id: 'record-1',
						uid: 'uid-m4',
						model: 'qwen-plus',
						inputTokens: 2,
						outputTokens: 3,
						totalTokens: 5,
						latencyMs: 123,
						requestId: 'req-1',
						ts: 1782660000000,
						createdAt: '2026-06-28T15:20:00.000Z',
					},
				],
			})
		}) as typeof fetch

		try {
			await expect(
				usageSummary(
					{},
					{
						httpContext: {
							headers: {
								authorization: 'Bearer product-user-token',
							},
						},
						sse() {
							throw new Error('SSE should not be used for usage summary')
						},
					},
				),
			).resolves.toMatchObject({ totalTokens: 5 })
		} finally {
			globalThis.fetch = previousFetch
			if (previousUsageApiKey === undefined) {
				delete process.env.CLOUDBASE_USAGE_API_KEY
			} else {
				process.env.CLOUDBASE_USAGE_API_KEY = previousUsageApiKey
			}
		}
	})
})
