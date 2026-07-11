import { describe, expect, it } from 'vitest'

import {
	assertUsageRecordSafe,
	buildDashScopeRequest,
	buildTencentCloudSignedRequest,
	buildUsageRecord,
	buildUsageSummary,
	clearAuthorizationCache,
	DASHSCOPE_CHAT_COMPLETIONS_URL,
	extractBearerToken,
	extractUsageFromSseFrame,
	handleChatCompletions,
	handleLauncherRegistration,
	handleUsageSummary,
	readUsageRecords,
	resolveCloudBaseUser,
	writeUsageRecord,
} from './gateway.mjs'
import { launcherRegister, main, usageSummary } from './index.mjs'

const ACCESS_TOKEN = 'cloudbase-access-token'
const USER_ID = 'user_123'
const ACTIVE_USER = {
	_id: USER_ID,
	uid: USER_ID,
	active: true,
	createdAt: '2026-07-01T00:00:00.000Z',
	updatedAt: '2026-07-01T00:00:00.000Z',
}
const DEFAULT_ENV = {
	cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
	cloudbaseClientId: 'client-id',
	cloudbaseClientSecret: '',
	cloudbaseUsageApiKey: 'cloudbase-usage-api-key',
	dashscopeApiKey: 'server-dashscope-key',
	cloudbaseRegion: 'ap-shanghai',
	tencentCloudSecretId: 'secret-id',
	tencentCloudSecretKey: 'secret-key',
	tencentCloudToken: '',
}

describe('CloudBase LLM gateway behavior', () => {
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

	it('builds a uid-scoped usage record without prompt, key, or auth leaks', () => {
		const record = buildUsageRecord({
			uid: USER_ID,
			model: 'qwen-plus',
			usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
			latencyMs: 321,
			requestId: 'req-m0',
			now: () => 1782604800000,
		})

		expect(record).toMatchObject({
			uid: USER_ID,
			model: 'qwen-plus',
			inputTokens: 3,
			outputTokens: 4,
			totalTokens: 7,
			latencyMs: 321,
			requestId: 'req-m0',
			createdAt: '2026-06-28T00:00:00.000Z',
		})
		expect(() => assertUsageRecordSafe(record)).not.toThrow()
		expect(JSON.stringify(record)).not.toMatch(
			/prompt|content|authorization|bearer|refresh_token|sk-/i,
		)
	})

	it('registers a launcher account by creating a CloudBase external user', async () => {
		const calls: Array<{
			url: string
			headers: Headers
			body: Record<string, unknown>
		}> = []

		const result = await handleLauncherRegistration({
			rawBody: JSON.stringify({
				username: 'alice',
				password: 'pass123',
			}),
			env: DEFAULT_ENV,
			now: () => 1782660000000,
			fetchImpl: async (url, init) => {
				calls.push({
					url: String(url),
					headers: new Headers(init?.headers),
					body: JSON.parse(String(init?.body)),
				})
				if (String(url).includes('/collections/user_accounts/documents')) {
					return Response.json({ insertedIds: ['cloudbase-user-1'] }, { status: 201 })
				}
				return Response.json({
					Response: {
						Uid: 'cloudbase-user-1',
						RequestId: 'request-1',
					},
				})
			},
		})

		expect(result).toEqual({
			ok: true,
			userId: 'cloudbase-user-1',
			username: 'alice',
		})
		expect(calls).toHaveLength(2)
		expect(calls[0].url).toBe('https://tcb.tencentcloudapi.com')
		expect(calls[0].body).toMatchObject({
			EnvId: 'wenxue-d8gz76tacc3659f05',
			Name: 'alice',
			NickName: 'alice',
			Password: 'pass123',
			Type: 'externalUser',
			UserStatus: 'ACTIVE',
		})
		expect(calls[0].headers.get('x-tc-action')).toBe('CreateUser')
		expect(calls[0].headers.get('x-tc-version')).toBe('2018-06-08')
		expect(calls[0].headers.get('authorization')).toContain('TC3-HMAC-SHA256 Credential=secret-id/')
		expect(calls[1].url).toBe(
			'https://wenxue-d8gz76tacc3659f05.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)/collections/user_accounts/documents',
		)
		expect(calls[1].headers.get('authorization')).toBe('Bearer cloudbase-usage-api-key')
		expect(calls[1].body).toEqual({
			data: [
				{
					_id: 'cloudbase-user-1',
					uid: 'cloudbase-user-1',
					active: true,
					firstSeenAt: '2026-06-28T15:20:00.000Z',
					lastSeenAt: '2026-06-28T15:20:00.000Z',
					createdAt: '2026-06-28T15:20:00.000Z',
					updatedAt: '2026-06-28T15:20:00.000Z',
				},
			],
		})
	})

	it('does not require email or phone when validating launcher registration input', async () => {
		await expect(
			handleLauncherRegistration({
				rawBody: JSON.stringify({
					username: 'bob',
					password: 'pass123',
				}),
				env: DEFAULT_ENV,
				fetchImpl: async () =>
					Response.json({
						Response: {
							Uid: 'cloudbase-user-2',
							RequestId: 'request-2',
						},
					}),
			}),
		).resolves.toMatchObject({ userId: 'cloudbase-user-2' })
	})

	it('looks up the CloudBase user id when CreateUser omits it', async () => {
		const calls: Array<{
			action: string | null
			body: Record<string, unknown>
		}> = []

		const result = await handleLauncherRegistration({
			rawBody: JSON.stringify({
				username: 'carol',
				password: 'pass123',
			}),
			env: DEFAULT_ENV,
			now: () => 1782660000000,
			fetchImpl: async (url, init) => {
				const headers = new Headers(init?.headers)
				const action = headers.get('x-tc-action')
				const body = JSON.parse(String(init?.body))
				calls.push({ action, body })
				if (String(url).includes('/collections/user_accounts/documents')) {
					return Response.json({ insertedIds: ['cloudbase-user-lookup'] }, { status: 201 })
				}
				if (action === 'DescribeUserList') {
					return Response.json({
						Response: {
							Data: {
								Total: 1,
								UserList: [
									{
										Uid: 'cloudbase-user-lookup',
										Name: 'carol',
										Type: 'externalUser',
									},
								],
							},
							RequestId: 'request-lookup',
						},
					})
				}
				return Response.json({
					Response: {
						RequestId: 'request-create',
					},
				})
			},
		})

		expect(result).toMatchObject({ userId: 'cloudbase-user-lookup', username: 'carol' })
		expect(calls.map((call) => call.action)).toEqual(['CreateUser', 'DescribeUserList', null])
		expect(calls[1].body).toMatchObject({
			EnvId: 'wenxue-d8gz76tacc3659f05',
			Name: 'carol',
			PageNo: 1,
			PageSize: 10,
		})
		expect(calls[2].body).toMatchObject({
			data: [
				expect.objectContaining({
					_id: 'cloudbase-user-lookup',
					uid: 'cloudbase-user-lookup',
					active: true,
				}),
			],
		})
	})

	it('maps CloudBase duplicate username errors to a clear registration error', async () => {
		await expect(
			handleLauncherRegistration({
				rawBody: JSON.stringify({
					username: 'alice',
					password: 'pass123',
				}),
				env: DEFAULT_ENV,
				fetchImpl: async () =>
					Response.json({
						Response: {
							Error: {
								Code: 'ResourceInUse.UserName',
								Message: 'user already exists',
							},
							RequestId: 'request-3',
						},
					}),
			}),
		).rejects.toMatchObject({
			message: '用户名已存在',
			status: 409,
		})
	})

	it('builds deterministic Tencent Cloud TC3 signed requests', () => {
		const request = buildTencentCloudSignedRequest({
			secretId: 'secret-id',
			secretKey: 'secret-key',
			token: 'session-token',
			region: 'ap-shanghai',
			action: 'CreateUser',
			now: () => 1782660000000,
			payload: {
				EnvId: 'wenxue-d8gz76tacc3659f05',
				Name: 'alice',
			},
		})
		const headers = new Headers(request.headers)

		expect(request.method).toBe('POST')
		expect(request.body).toBe(
			JSON.stringify({
				EnvId: 'wenxue-d8gz76tacc3659f05',
				Name: 'alice',
			}),
		)
		expect(headers.get('x-tc-token')).toBe('session-token')
		expect(headers.get('x-tc-timestamp')).toBe('1782660000')
		expect(headers.get('authorization')).toContain('SignedHeaders=content-type;host')
		expect(headers.get('authorization')).toContain('Signature=')
	})

	it('rejects missing or inactive CloudBase bearer tokens before account lookup', async () => {
		await expect(
			resolveCloudBaseUser({
				headers: {},
				env: DEFAULT_ENV,
				fetchImpl: async () => Response.json({ active: true, sub: USER_ID }),
			}),
		).rejects.toThrow('登录已过期/无权限')

		await expect(
			resolveCloudBaseUser({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				env: DEFAULT_ENV,
				fetchImpl: async () => Response.json({ active: false, sub: USER_ID }),
			}),
		).rejects.toThrow('登录已过期/无权限')
	})

	it('introspects CloudBase access tokens and extracts the CloudBase user id', async () => {
		const calls: Array<{ url: string; authorization: string | null }> = []
		const user = await resolveCloudBaseUser({
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			env: DEFAULT_ENV,
			fetchImpl: async (url, init) => {
				const headers = new Headers(init?.headers)
				calls.push({ url: String(url), authorization: headers.get('authorization') })
				return Response.json({ active: true, sub: USER_ID })
			},
		})

		expect(user).toEqual({ uid: USER_ID })
		expect(calls).toHaveLength(1)
		expect(calls[0].url).toContain('/auth/v1/token/introspect')
		expect(calls[0].url).toContain('client_id=client-id')
		expect(calls[0].authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
	})

	it('rejects disabled or missing user_accounts before calling DashScope', async () => {
		for (const account of [{ ...ACTIVE_USER, active: false }, null]) {
			const calls: string[] = []

			await expect(
				handleChatCompletions({
					headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
					rawBody: JSON.stringify({
						model: 'qwen3.7-max',
						stream: false,
						messages: [{ role: 'user', content: 'hello' }],
					}),
					env: DEFAULT_ENV,
					fetchImpl: createGatewayFetch({
						calls,
						userAccount: account,
					}),
				}),
			).rejects.toThrow('无权限：当前用户未启用或已被禁用。')

			expect(calls.some((url) => url.includes('/auth/v1/token/introspect'))).toBe(true)
			expect(calls.some((url) => url.includes('/collections/user_accounts/documents'))).toBe(true)
			expect(calls.some((url) => url === DASHSCOPE_CHAT_COMPLETIONS_URL)).toBe(false)
		}
	})

	it('proxies non-streaming requests for active users and writes usage under the user id', async () => {
		clearAuthorizationCache()
		const calls: string[] = []
		const usageWrites: unknown[] = []

		const result = await handleChatCompletions({
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			rawBody: JSON.stringify({
				model: 'qwen3.7-max',
				stream: false,
				messages: [{ role: 'user', content: 'hello' }],
			}),
			env: DEFAULT_ENV,
			now: (() => {
				const ticks = [1782633600000, 1782633600456]
				return () => ticks.shift() ?? 1782633600456
			})(),
			fetchImpl: createGatewayFetch({ calls, usageWrites }),
		})

		expect(result.responseBody).toMatchObject({
			choices: [{ message: { role: 'assistant', content: 'ok' } }],
		})
		expect(result.usageRecord).toMatchObject({
			uid: USER_ID,
			model: 'qwen3.7-max',
			totalTokens: 5,
			latencyMs: 456,
		})
		expect(result.usagePersisted).toBe(true)
		expect(usageWrites).toEqual([
			{
				data: [
					expect.objectContaining({
						uid: USER_ID,
						model: 'qwen3.7-max',
						totalTokens: 5,
					}),
				],
			},
		])
		expect(
			calls.filter((url) => url.includes('/collections/user_accounts/documents')),
		).toHaveLength(1)
		expect(calls.filter((url) => url.includes('/collections/token_usage/documents'))).toHaveLength(
			1,
		)
	})

	it('proxies streamed DashScope SSE and returns a safe usage record', async () => {
		const dashScopeBodies: unknown[] = []
		const usageWrites: unknown[] = []
		const sentChunks: string[] = []
		let ended = false

		const result = await handleChatCompletions({
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			rawBody: JSON.stringify({
				model: 'qwen3.7-max',
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
			env: DEFAULT_ENV,
			now: (() => {
				const ticks = [1782633600000, 1782633600456]
				return () => ticks.shift() ?? 1782633600456
			})(),
			fetchImpl: createGatewayFetch({ dashScopeBodies, usageWrites }),
		})

		expect(dashScopeBodies).toEqual([
			{
				model: 'qwen3.7-max',
				stream: true,
				stream_options: { include_usage: true },
				messages: [{ role: 'user', content: 'hello' }],
			},
		])
		expect(sentChunks.join('')).toContain('data: {"choices":[{"delta":{"content":"hi"}}]}')
		expect(ended).toBe(true)
		expect(result.usageRecord).toMatchObject({
			uid: USER_ID,
			model: 'qwen3.7-max',
			inputTokens: 2,
			outputTokens: 3,
			totalTokens: 5,
			latencyMs: 456,
		})
		expect(result.usagePersisted).toBe(true)
		expect(usageWrites).toHaveLength(1)
		expect(() => assertUsageRecordSafe(result.usageRecord)).not.toThrow()
	})

	it('fails instead of writing zero usage when upstream omits usage', async () => {
		await expect(
			handleChatCompletions({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				rawBody: JSON.stringify({
					model: 'qwen3.7-max',
					stream: false,
					messages: [{ role: 'user', content: 'hello' }],
				}),
				env: DEFAULT_ENV,
				fetchImpl: createGatewayFetch({
					dashScopeResponse: Response.json({ choices: [{ message: { content: 'hello' } }] }),
				}),
			}),
		).rejects.toThrow('DashScope usage is missing from upstream response')
	})

	it('returns the upstream response when usage persistence fails after a measured response', async () => {
		const result = await handleChatCompletions({
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			rawBody: JSON.stringify({
				model: 'qwen3.7-max',
				stream: false,
				messages: [{ role: 'user', content: 'hello' }],
			}),
			env: DEFAULT_ENV,
			fetchImpl: createGatewayFetch({ usageWriteStatus: 500 }),
		})

		expect(result.responseBody).toMatchObject({
			choices: [{ message: { role: 'assistant', content: 'ok' } }],
		})
		expect(result.usageRecord).toMatchObject({ uid: USER_ID, totalTokens: 5 })
		expect(result.usagePersisted).toBe(false)
	})

	it('writes usage records through the CloudBase NoSQL REST API without sensitive fields', async () => {
		const calls: Array<{ url: string; authorization: string | null; body: unknown }> = []
		await writeUsageRecord({
			record: buildUsageRecord({
				uid: USER_ID,
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
							uid: USER_ID,
							model: 'qwen-plus',
							totalTokens: 5,
						}),
					],
				},
			},
		])
		expect(JSON.stringify(calls[0].body)).not.toMatch(
			/prompt|content|authorization|bearer|api_key|apikey|refresh_token|sk-/i,
		)
	})

	it('reads Authorization from CloudBase Functions Framework httpContext headers', async () => {
		const previousFetch = globalThis.fetch
		const previousDashScopeKey = process.env.DASHSCOPE_API_KEY
		const previousUsageApiKey = process.env.CLOUDBASE_USAGE_API_KEY
		process.env.DASHSCOPE_API_KEY = 'server-dashscope-key'
		process.env.CLOUDBASE_USAGE_API_KEY = 'cloudbase-usage-api-key'

		const calls: string[] = []
		globalThis.fetch = createGatewayFetch({ calls })

		try {
			const result = await main(
				{
					model: 'qwen3.7-max',
					stream: false,
					messages: [{ role: 'user', content: 'hello' }],
				},
				{
					httpContext: {
						headers: {
							authorization: `Bearer ${ACCESS_TOKEN}`,
						},
					},
					sse() {
						throw new Error('SSE should not be used for non-stream requests')
					},
				},
			)

			expect(calls.some((url) => url.includes('/auth/v1/token/introspect'))).toBe(true)
			expect(result).toMatchObject({
				usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
			})
		} finally {
			globalThis.fetch = previousFetch
			restoreEnv('DASHSCOPE_API_KEY', previousDashScopeKey)
			restoreEnv('CLOUDBASE_USAGE_API_KEY', previousUsageApiKey)
		}
	})

	it('exposes launcher registration through its own Function mode target', async () => {
		const previousFetch = globalThis.fetch
		const previousSecretId = process.env.TENCENTCLOUD_SECRETID
		const previousSecretKey = process.env.TENCENTCLOUD_SECRETKEY
		const previousUsageApiKey = process.env.CLOUDBASE_USAGE_API_KEY
		process.env.TENCENTCLOUD_SECRETID = 'secret-id'
		process.env.TENCENTCLOUD_SECRETKEY = 'secret-key'
		process.env.CLOUDBASE_USAGE_API_KEY = 'cloudbase-usage-api-key'
		globalThis.fetch = (async () =>
			Response.json({
				Response: {
					Uid: 'cloudbase-user-3',
					RequestId: 'request-4',
				},
			})) as typeof fetch

		try {
			const response = await launcherRegister(
				{
					body: JSON.stringify({
						username: 'charlie',
						password: 'pass123',
					}),
				},
				{
					sse() {
						throw new Error('SSE should not be used for launcher registration')
					},
				},
			)

			expect(response.statusCode).toBe(201)
			expect(response.headers).toMatchObject({
				'access-control-allow-origin': '*',
			})
			expect(JSON.parse(response.body)).toMatchObject({
				ok: true,
				userId: 'cloudbase-user-3',
				username: 'charlie',
			})
		} finally {
			globalThis.fetch = previousFetch
			restoreEnv('TENCENTCLOUD_SECRETID', previousSecretId)
			restoreEnv('TENCENTCLOUD_SECRETKEY', previousSecretKey)
			restoreEnv('CLOUDBASE_USAGE_API_KEY', previousUsageApiKey)
		}
	})

	it('answers launcher registration CORS preflight without running registration', async () => {
		const previousFetch = globalThis.fetch
		globalThis.fetch = (async () => {
			throw new Error('registration should not run for preflight requests')
		}) as typeof fetch

		try {
			const response = await launcherRegister(
				{
					httpMethod: 'OPTIONS',
					headers: {
						origin: 'http://localhost:5173',
						'access-control-request-method': 'POST',
					},
				},
				{
					sse() {
						throw new Error('SSE should not be used for launcher registration')
					},
				},
			)

			expect(response).toMatchObject({
				statusCode: 204,
				body: '',
				headers: {
					'access-control-allow-origin': '*',
					'access-control-allow-methods': 'POST, OPTIONS',
					'access-control-allow-headers': 'content-type, authorization',
				},
			})
		} finally {
			globalThis.fetch = previousFetch
		}
	})

	it('detects launcher registration preflight from access-control request headers', async () => {
		const response = await launcherRegister(
			{
				headers: {
					origin: 'http://localhost:5173',
					'access-control-request-method': 'POST',
					'access-control-request-headers': 'content-type',
				},
			},
			{
				sse() {
					throw new Error('SSE should not be used for launcher registration')
				},
			},
		)

		expect(response).toMatchObject({
			statusCode: 204,
			body: '',
			headers: {
				'access-control-allow-origin': '*',
			},
		})
	})

	it('builds token usage summary without leaking uid or sensitive fields', () => {
		const summary = buildUsageSummary([
			{
				_id: `${USER_ID}:req-1:1782660000000`,
				ts: 1782660000000,
				uid: USER_ID,
				model: 'qwen-plus',
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				latencyMs: 500,
				requestId: 'req-1',
				createdAt: '2026-06-28T15:20:00.000Z',
			},
			{
				_id: `${USER_ID}:req-2:1782663600000`,
				ts: 1782663600000,
				uid: USER_ID,
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
		expect(JSON.stringify(summary)).not.toMatch(/user_123|authorization|bearer|api_key|apikey|sk-/i)
	})

	it('queries token_usage records for the authenticated uid', async () => {
		const calls: Array<{ url: string; authorization: string | null }> = []
		const records = await readUsageRecords({
			uid: USER_ID,
			envId: 'wenxue-d8gz76tacc3659f05',
			apiKey: 'cloudbase-usage-api-key',
			fetchImpl: async (url, init) => {
				const headers = new Headers(init?.headers)
				calls.push({ url: String(url), authorization: headers.get('authorization') })
				return Response.json({
					list: [
						{
							_id: 'record-1',
							uid: USER_ID,
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
				uid: USER_ID,
				totalTokens: 5,
				ts: 1782660000000,
			}),
		])
		expect(calls[0]?.authorization).toBe('Bearer cloudbase-usage-api-key')
		expect(decodeURIComponent(calls[0]?.url ?? '')).toContain(`"uid":"${USER_ID}"`)
	})

	it('returns a cloud usage summary for the authenticated user', async () => {
		const result = await handleUsageSummary({
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			env: DEFAULT_ENV,
			fetchImpl: createGatewayFetch({
				usageRecords: [
					{
						_id: 'record-1',
						uid: USER_ID,
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
			}),
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
		globalThis.fetch = createGatewayFetch({
			usageRecords: [
				{
					_id: 'record-1',
					uid: USER_ID,
					model: 'qwen3.7-max',
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

		try {
			await expect(
				usageSummary(
					{},
					{
						httpContext: {
							headers: {
								authorization: `Bearer ${ACCESS_TOKEN}`,
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
			restoreEnv('CLOUDBASE_USAGE_API_KEY', previousUsageApiKey)
		}
	})

	it('extracts bearer tokens case-insensitively', () => {
		expect(extractBearerToken({ Authorization: 'Bearer token-1' })).toBe('token-1')
		expect(extractBearerToken(new Headers({ authorization: 'Bearer token-2' }))).toBe('token-2')
	})
})

function createGatewayFetch(options: {
	calls?: string[]
	dashScopeBodies?: unknown[]
	usageWrites?: unknown[]
	userAccount?: Record<string, unknown> | null
	introspection?: Record<string, unknown>
	dashScopeResponse?: Response
	usageWriteStatus?: number
	usageRecords?: Record<string, unknown>[]
}): typeof fetch {
	return (async (url, init) => {
		const href = String(url)
		options.calls?.push(href)
		if (href.includes('/auth/v1/token/introspect')) {
			const headers = new Headers(init?.headers)
			if (headers.get('authorization') !== `Bearer ${ACCESS_TOKEN}`) {
				return Response.json({ active: false }, { status: 401 })
			}
			return Response.json(options.introspection ?? { active: true, sub: USER_ID })
		}
		if (href.includes('/collections/user_accounts/documents')) {
			const account = options.userAccount === undefined ? ACTIVE_USER : options.userAccount
			return Response.json({ list: account ? [account] : [] })
		}
		if (href.includes('/collections/token_usage/documents')) {
			if (init?.method === 'GET') {
				return Response.json({ list: options.usageRecords ?? [] })
			}
			options.usageWrites?.push(JSON.parse(String(init?.body)))
			return Response.json(
				{ insertedIds: ['usage-record-id'] },
				{ status: options.usageWriteStatus ?? 201 },
			)
		}
		if (href === DASHSCOPE_CHAT_COMPLETIONS_URL) {
			options.dashScopeBodies?.push(JSON.parse(String(init?.body)))
			if (options.dashScopeResponse) return options.dashScopeResponse
			const requestBody = JSON.parse(String(init?.body)) as { stream?: boolean }
			if (requestBody.stream) {
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
			}
			return Response.json({
				choices: [{ message: { role: 'assistant', content: 'ok' } }],
				usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
			})
		}
		return Response.json({ error: 'unexpected url' }, { status: 500 })
	}) as typeof fetch
}

function restoreEnv(name: string, previous: string | undefined) {
	if (previous === undefined) {
		delete process.env[name]
	} else {
		process.env[name] = previous
	}
}
