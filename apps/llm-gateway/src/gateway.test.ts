import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	me as originalAdminMe,
	usageSummary as originalAdminUsageSummary,
	users as originalAdminUsers,
	userStatus as originalAdminUserStatus,
} from '../../admin-api/src/index.mjs'
import { resetAdminConsoleFileCache, serveAdminConsole } from './adminConsole.mjs'
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
	handleLauncherActivation,
	handleLauncherRegistration,
	handleUsageSummary,
	readUsageRecords,
	resolveCloudBaseUser,
	writeUsageRecord,
} from './gateway.mjs'
import {
	adminConsole,
	adminMe,
	adminUsageSummary,
	adminUsers,
	adminUserStatus,
	healthCheck,
	launcherActivate,
	launcherRegister,
	main,
	resetLauncherRegistrationRateLimits,
	usageSummary,
} from './index.mjs'

const ACCESS_TOKEN = 'cloudbase-access-token'
const USER_ID = 'user_123'
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
	beforeEach(() => {
		resetLauncherRegistrationRateLimits()
	})

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

	it.each([
		{ model: 'qwen-plus', messages: [{ role: 'user', content: 'hello' }] },
		{ model: 'qwen3.7-max', messages: [], stream: false },
		{
			model: 'qwen3.7-max',
			messages: [{ role: 'user', content: 'hello' }],
			max_tokens: 32_769,
		},
	])('rejects an unsafe chat request before authentication or upstream fetch: %j', async (body) => {
		const fetchImpl = vi.fn()

		await expect(
			handleChatCompletions({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				rawBody: JSON.stringify(body),
				env: DEFAULT_ENV,
				fetchImpl,
			}),
		).rejects.toMatchObject({ status: 400 })
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it.each(
		['', ' ', 'browser 1', '../browser', '浏览器', 'a'.repeat(129), [], ['one', 'two']].map(
			(browserId) => ({ browserId }),
		),
	)(
		'rejects an invalid browser id before authentication or upstream fetch: $browserId',
		async ({ browserId }) => {
			const fetchImpl = vi.fn()

			await expect(
				handleChatCompletions({
					headers: {
						authorization: `Bearer ${ACCESS_TOKEN}`,
						'X-WenXue-Browser-Id': browserId,
					},
					rawBody: JSON.stringify({
						model: 'qwen3.7-max',
						messages: [{ role: 'user', content: 'hello' }],
					}),
					env: DEFAULT_ENV,
					fetchImpl,
				}),
			).rejects.toMatchObject({ status: 400, message: 'Invalid X-WenXue-Browser-Id header' })
			expect(fetchImpl).not.toHaveBeenCalled()
		},
	)

	it.each(['a', 'a'.repeat(128)])(
		'accepts the browser id length boundary: %s',
		async (browserId) => {
			const result = await handleChatCompletions({
				headers: {
					authorization: `Bearer ${ACCESS_TOKEN}`,
					'x-wenxue-browser-id': browserId,
				},
				rawBody: JSON.stringify({
					model: 'qwen3.7-max',
					messages: [{ role: 'user', content: 'hello' }],
				}),
				env: DEFAULT_ENV,
				fetchImpl: createGatewayFetch({}),
			})

			expect(result.usageRecord.browserId).toBe(browserId)
			expect(result.usagePersisted).toBe(true)
		},
	)

	it('requires user authentication even when a browser id is supplied', async () => {
		const fetchImpl = vi.fn()

		await expect(
			handleChatCompletions({
				headers: { 'x-wenxue-browser-id': 'browser-1' },
				rawBody: JSON.stringify({
					model: 'qwen3.7-max',
					messages: [{ role: 'user', content: 'hello' }],
				}),
				env: DEFAULT_ENV,
				fetchImpl,
			}),
		).rejects.toMatchObject({ status: 401 })
		expect(fetchImpl).not.toHaveBeenCalled()
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
		expect(record).not.toHaveProperty('browserId')
	})

	it('allows validated browser metadata while rejecting sensitive usage fields and values', () => {
		const record = buildUsageRecord({
			uid: USER_ID,
			browserId: 'task-1',
			model: 'qwen3.7-max',
			usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
			latencyMs: 123,
			requestId: 'request-1',
		})

		expect(() => assertUsageRecordSafe(record)).not.toThrow()
		expect(() => assertUsageRecordSafe({ ...record, prompt: 'private text' })).toThrow()
		expect(() => assertUsageRecordSafe({ ...record, model: 'sk-private-secret' })).toThrow()
		expect(() => assertUsageRecordSafe({ ...record, browserId: 'bad browser' })).toThrow()
	})

	it('registers a validated launcher account without writing an authorization row', async () => {
		const calls: Array<{
			url: string
			headers: Headers
			body: Record<string, unknown>
		}> = []

		const result = await handleLauncherRegistration({
			rawBody: JSON.stringify({ username: 'alice', password: 'AuthTest9!' }),
			env: DEFAULT_ENV,
			now: () => 1782660000000,
			fetchImpl: async (url, init) => {
				calls.push({
					url: String(url),
					headers: new Headers(init?.headers),
					body: JSON.parse(String(init?.body)),
				})
				return Response.json({ Response: { RequestId: 'request-1' } })
			},
		})

		expect(result).toEqual({ ok: true, username: 'alice' })
		expect(calls).toHaveLength(1)
		expect(calls[0].url).toBe('https://tcb.tencentcloudapi.com')
		expect(calls[0].body).toMatchObject({
			EnvId: 'wenxue-d8gz76tacc3659f05',
			Name: 'alice',
			NickName: 'alice',
			Password: 'AuthTest9!',
			Type: 'externalUser',
			UserStatus: 'ACTIVE',
		})
		expect(calls[0].body).not.toHaveProperty('Uid')
		expect(calls[0].headers.get('x-tc-action')).toBe('CreateUser')
		expect(calls[0].headers.get('x-tc-version')).toBe('2018-06-08')
		expect(calls[0].headers.get('authorization')).toContain('TC3-HMAC-SHA256 Credential=secret-id/')
	})

	it('rejects invalid launcher usernames before calling CloudBase', async () => {
		const cases = [
			{ username: 'abcd', message: '用户名长度必须为 5–24 位' },
			{ username: 'a'.repeat(25), message: '用户名长度必须为 5–24 位' },
			{ username: '1alice', message: '用户名只能包含英文字母和数字，且必须以英文字母开头' },
			{ username: 'ali_ce', message: '用户名只能包含英文字母和数字，且必须以英文字母开头' },
			{ username: '问学user', message: '用户名只能包含英文字母和数字，且必须以英文字母开头' },
		]
		for (const item of cases) {
			let called = false
			await expect(
				handleLauncherRegistration({
					rawBody: JSON.stringify({ username: item.username, password: 'AuthTest9!' }),
					env: DEFAULT_ENV,
					fetchImpl: async () => {
						called = true
						return Response.json({})
					},
				}),
			).rejects.toMatchObject({ message: item.message, status: 400 })
			expect(called).toBe(false)
		}
	})

	it('accepts a five-character alphabetic username', async () => {
		await expect(
			handleLauncherRegistration({
				rawBody: JSON.stringify({ username: 'abcde', password: 'AuthTest9!' }),
				env: DEFAULT_ENV,
				fetchImpl: async () => Response.json({ Response: { RequestId: 'request-short' } }),
			}),
		).resolves.toEqual({ ok: true, username: 'abcde' })
	})

	it('rejects weak launcher passwords before calling CloudBase', async () => {
		const cases = [
			{ password: 'AuthTe1', message: '密码长度必须为 8–32 位' },
			{ password: `Aa1!${'x'.repeat(29)}`, message: '密码长度必须为 8–32 位' },
			{ password: '!AuthTest9', message: '密码必须以英文字母开头' },
			{ password: '1AuthTest!', message: '密码必须以英文字母开头' },
			{
				password: 'authtest9',
				message: '密码必须包含大写字母、小写字母、数字和特殊符号中的至少 3 类',
			},
			{ password: 'Auth Test9!', message: '密码包含不支持的字符' },
			{ password: 'Auth测试99!', message: '密码包含不支持的字符' },
			{ password: 'AuthTest9~', message: '密码包含不支持的字符' },
		]
		for (const item of cases) {
			let called = false
			await expect(
				handleLauncherRegistration({
					rawBody: JSON.stringify({ username: 'alice', password: item.password }),
					env: DEFAULT_ENV,
					fetchImpl: async () => {
						called = true
						return Response.json({})
					},
				}),
			).rejects.toMatchObject({ message: item.message, status: 400 })
			expect(called).toBe(false)
		}
	})

	it('accepts eight-character passwords with a letter first and three character categories', async () => {
		for (const password of ['AuthTes1', 'aUTHtes1', `Aa1${'x'.repeat(29)}`]) {
			const fetchImpl = vi.fn(async () =>
				Response.json({ Response: { RequestId: 'request-password-boundary' } }),
			)
			await expect(
				handleLauncherRegistration({
					rawBody: JSON.stringify({ username: 'alice', password }),
					env: DEFAULT_ENV,
					fetchImpl,
				}),
			).resolves.toEqual({ ok: true, username: 'alice' })
			expect(fetchImpl).toHaveBeenCalledTimes(1)
		}
	})

	it('bounds CreateUser request and response body reads to ten seconds', async () => {
		vi.useFakeTimers()
		try {
			for (const stallBody of [false, true]) {
				const registration = handleLauncherRegistration({
					rawBody: JSON.stringify({ username: 'alice', password: 'AuthTest9!' }),
					env: { ...DEFAULT_ENV, requestTimeoutMs: 60_000 },
					fetchImpl: ((_, init) => {
						if (!stallBody) {
							return new Promise<Response>((_, reject) => {
								init?.signal?.addEventListener('abort', () => reject(abortError()))
							})
						}
						return Promise.resolve({
							ok: true,
							status: 200,
							text: () =>
								new Promise<string>((_, reject) => {
									init?.signal?.addEventListener('abort', () => reject(abortError()))
								}),
						} as Response)
					}) as typeof fetch,
				})
				const rejection = expect(registration).rejects.toMatchObject({
					message: 'Upstream request timed out',
					status: 504,
				})

				await vi.advanceTimersByTimeAsync(10_000)
				await rejection
			}
		} finally {
			vi.useRealTimers()
		}
	})

	it('keeps duplicate registration as 409 without a database write', async () => {
		const calls: string[] = []
		await expect(
			handleLauncherRegistration({
				rawBody: JSON.stringify({ username: 'alice', password: 'AuthTest9!' }),
				env: DEFAULT_ENV,
				fetchImpl: async (url) => {
					calls.push(String(url))
					return Response.json({
						Response: {
							Error: { Code: 'ResourceInUse.UserName', Message: 'user already exists' },
						},
					})
				},
			}),
		).rejects.toMatchObject({ message: '用户名已存在', status: 409 })
		expect(calls).toEqual(['https://tcb.tencentcloudapi.com'])
	})

	it('activates an authenticated CloudBase user without a database write', async () => {
		const calls: string[] = []
		const result = await handleLauncherActivation({
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			env: DEFAULT_ENV,
			fetchImpl: async (url) => {
				calls.push(String(url))
				return Response.json({ status: 'ACTIVE', sub: USER_ID })
			},
		})

		expect(result).toEqual({ ok: true, userId: USER_ID })
		expect(calls).toHaveLength(1)
		expect(calls[0]).toContain('/auth/v1/user/me')
		expect(calls[0]).not.toContain('/database/')
	})

	it('rejects activation when CloudBase marks the user as blocked', async () => {
		await expect(
			handleLauncherActivation({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				env: DEFAULT_ENV,
				fetchImpl: async () => Response.json({ status: 'BLOCKED', sub: USER_ID }),
			}),
		).rejects.toMatchObject({ status: 403 })
	})

	it('rejects activation without a bearer token before any database write', async () => {
		let called = false
		await expect(
			handleLauncherActivation({
				headers: {},
				env: DEFAULT_ENV,
				fetchImpl: async () => {
					called = true
					return Response.json({})
				},
			}),
		).rejects.toMatchObject({ status: 401 })
		expect(called).toBe(false)
	})

	it('builds deterministic Tencent Cloud TC3 signed requests', () => {
		const request = buildTencentCloudSignedRequest({
			secretId: 'secret-id',
			secretKey: 'secret-key',
			token: 'session-token',
			region: 'ap-shanghai',
			action: 'CreateUser',
			now: () => 1782660000000,
			payload: { EnvId: 'wenxue-d8gz76tacc3659f05', Name: 'alice' },
		})
		const headers = new Headers(request.headers)

		expect(request.method).toBe('POST')
		expect(request.body).toBe(JSON.stringify({ EnvId: 'wenxue-d8gz76tacc3659f05', Name: 'alice' }))
		expect(headers.get('x-tc-token')).toBe('session-token')
		expect(headers.get('x-tc-timestamp')).toBe('1782660000')
		expect(headers.get('authorization')).toContain('SignedHeaders=content-type;host')
		expect(headers.get('authorization')).toContain('Signature=')
	})

	it('rejects missing or invalid CloudBase bearer tokens', async () => {
		await expect(
			resolveCloudBaseUser({
				headers: {},
				env: DEFAULT_ENV,
				fetchImpl: async () => Response.json({ status: 'ACTIVE', sub: USER_ID }),
			}),
		).rejects.toThrow('登录已过期/无权限')

		await expect(
			resolveCloudBaseUser({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				env: DEFAULT_ENV,
				fetchImpl: async () => Response.json({}, { status: 401 }),
			}),
		).rejects.toThrow('登录已过期/无权限')
	})

	it('reads the active CloudBase profile and extracts the user id', async () => {
		const calls: Array<{ url: string; authorization: string | null }> = []
		const user = await resolveCloudBaseUser({
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			env: DEFAULT_ENV,
			fetchImpl: async (url, init) => {
				const headers = new Headers(init?.headers)
				calls.push({ url: String(url), authorization: headers.get('authorization') })
				return Response.json({ status: 'ACTIVE', sub: USER_ID })
			},
		})

		expect(user).toEqual({ uid: USER_ID })
		expect(calls).toHaveLength(1)
		expect(calls[0].url).toContain('/auth/v1/user/me')
		expect(calls[0].url).toContain('client_id=client-id')
		expect(calls[0].authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
	})

	it('reports a successful CloudBase profile response with invalid JSON as an upstream error', async () => {
		await expect(
			resolveCloudBaseUser({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				env: DEFAULT_ENV,
				fetchImpl: async () => new Response('<html>temporary proxy error</html>'),
			}),
		).rejects.toMatchObject({
			message: 'Upstream returned invalid JSON',
			status: 502,
		})
	})

	it('times out a stalled user-profile response body without leaking the token', async () => {
		vi.useFakeTimers()
		try {
			let failure: unknown
			const profileRequest = resolveCloudBaseUser({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				env: { ...DEFAULT_ENV, requestTimeoutMs: 1_000 },
				fetchImpl: (async (_, init) =>
					({
						ok: true,
						status: 200,
						text: () =>
							new Promise<string>((_, reject) => {
								init?.signal?.addEventListener('abort', () => reject(abortError()))
							}),
					}) as Response) as typeof fetch,
			}).catch((error: unknown) => {
				failure = error
			})

			await vi.advanceTimersByTimeAsync(1_000)
			await profileRequest

			expect(failure).toMatchObject({ message: 'Upstream request timed out', status: 504 })
			expect(failure).toBeInstanceOf(Error)
			expect((failure as Error).message).not.toContain(ACCESS_TOKEN)
		} finally {
			vi.useRealTimers()
		}
	})

	it('rejects blocked CloudBase users before calling DashScope', async () => {
		const calls: string[] = []

		await expect(
			handleChatCompletions({
				headers: {
					authorization: `Bearer ${ACCESS_TOKEN}`,
					'x-wenxue-browser-id': 'browser-1',
				},
				rawBody: JSON.stringify({
					model: 'qwen3.7-max',
					stream: false,
					messages: [{ role: 'user', content: 'hello' }],
				}),
				env: DEFAULT_ENV,
				fetchImpl: createGatewayFetch({
					calls,
					userProfile: { status: 'BLOCKED', sub: USER_ID },
				}),
			}),
		).rejects.toThrow('无权限：当前用户未启用或已被禁用。')

		expect(calls.some((url) => url.includes('/auth/v1/user/me'))).toBe(true)
		expect(calls.some((url) => url === DASHSCOPE_CHAT_COMPLETIONS_URL)).toBe(false)
	})

	it('proxies non-streaming requests for active users and writes usage under the user id', async () => {
		clearAuthorizationCache()
		const calls: string[] = []
		const usageWrites: unknown[] = []
		const dashScopeHeaders: Headers[] = []
		const dashScopeBodies: unknown[] = []

		const result = await handleChatCompletions({
			headers: {
				authorization: `Bearer ${ACCESS_TOKEN}`,
				'X-WenXue-Browser-Id': 'task-1',
			},
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
			fetchImpl: createGatewayFetch({ calls, usageWrites, dashScopeHeaders, dashScopeBodies }),
		})

		expect(result.responseBody).toMatchObject({
			choices: [{ message: { role: 'assistant', content: 'ok' } }],
		})
		expect(result.usageRecord).toMatchObject({
			uid: USER_ID,
			browserId: 'task-1',
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
						browserId: 'task-1',
						model: 'qwen3.7-max',
						totalTokens: 5,
					}),
				],
			},
		])
		expect(calls.filter((url) => url.includes('/auth/v1/user/me'))).toHaveLength(1)
		expect(calls.filter((url) => url.includes('/collections/token_usage/documents'))).toHaveLength(
			1,
		)
		expect(dashScopeHeaders).toHaveLength(1)
		expect(dashScopeHeaders[0].get('x-wenxue-browser-id')).toBeNull()
		expect(dashScopeHeaders[0].get('authorization')).toBe('Bearer server-dashscope-key')
		expect(JSON.stringify(dashScopeBodies)).not.toContain('task-1')
		expect(JSON.stringify(usageWrites)).not.toMatch(
			/prompt|content|authorization|bearer|api_key|apikey|refresh_token|hello|cloudbase-access-token|server-dashscope-key/i,
		)
	})

	it('proxies streamed DashScope SSE and returns a safe usage record', async () => {
		const dashScopeBodies: unknown[] = []
		const dashScopeHeaders: Headers[] = []
		const usageWrites: unknown[] = []
		const sentChunks: string[] = []
		let ended = false

		const result = await handleChatCompletions({
			headers: new Headers({
				authorization: `Bearer ${ACCESS_TOKEN}`,
				'x-wenxue-browser-id': 'Browser_2',
			}),
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
			fetchImpl: createGatewayFetch({ dashScopeBodies, dashScopeHeaders, usageWrites }),
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
			browserId: 'Browser_2',
			model: 'qwen3.7-max',
			inputTokens: 2,
			outputTokens: 3,
			totalTokens: 5,
			latencyMs: 456,
		})
		expect(result.usagePersisted).toBe(true)
		expect(usageWrites).toEqual([{ data: [result.usageRecord] }])
		expect(() => assertUsageRecordSafe(result.usageRecord)).not.toThrow()
		expect(dashScopeHeaders).toHaveLength(1)
		expect(dashScopeHeaders[0].get('x-wenxue-browser-id')).toBeNull()
		expect(JSON.stringify(usageWrites)).not.toMatch(
			/prompt|content|authorization|bearer|api_key|apikey|refresh_token|sk-|hello|cloudbase-access-token|server-dashscope-key/i,
		)
	})

	it('parses streamed usage when the SSE data line is split across network chunks', async () => {
		const encoder = new TextEncoder()
		const usageWrites: unknown[] = []
		const sentChunks: string[] = []
		const usageFrame =
			'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n'
		const dashScopeResponse = new Response(
			new ReadableStream({
				start(controller) {
					for (const part of [
						usageFrame.slice(0, 17),
						usageFrame.slice(17, 51),
						usageFrame.slice(51),
					]) {
						controller.enqueue(encoder.encode(part))
					}
					controller.close()
				},
			}),
		)

		const result = await handleChatCompletions({
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			rawBody: JSON.stringify({
				model: 'qwen3.7-max',
				stream: true,
				messages: [{ role: 'user', content: 'hello' }],
			}),
			sse: {
				closed: false,
				send: (chunk: string) => sentChunks.push(chunk),
				end() {},
				on() {},
			},
			env: DEFAULT_ENV,
			fetchImpl: createGatewayFetch({ dashScopeResponse, usageWrites }),
		})

		expect(sentChunks.join('')).toBe(usageFrame)
		expect(result.usageRecord).toMatchObject({
			inputTokens: 2,
			outputTokens: 3,
			totalTokens: 5,
		})
		expect(usageWrites).toHaveLength(1)
	})

	it('rejects an upstream SSE frame that grows beyond the buffer limit', async () => {
		const dashScopeResponse = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(`data: ${'x'.repeat(1024 * 1024)}`))
					controller.close()
				},
			}),
		)

		await expect(
			handleChatCompletions({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				rawBody: JSON.stringify({
					model: 'qwen3.7-max',
					stream: true,
					messages: [{ role: 'user', content: 'hello' }],
				}),
				sse: {
					closed: false,
					send() {},
					end() {},
					on() {},
				},
				env: DEFAULT_ENV,
				fetchImpl: createGatewayFetch({ dashScopeResponse }),
			}),
		).rejects.toMatchObject({
			message: 'DashScope SSE frame exceeds the size limit',
			status: 502,
		})
	})

	it('times out a stalled non-streaming DashScope response body', async () => {
		vi.useFakeTimers()
		try {
			let markBodyStarted!: () => void
			const bodyStarted = new Promise<void>((resolve) => {
				markBodyStarted = resolve
			})
			const request = handleChatCompletions({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				rawBody: JSON.stringify({
					model: 'qwen3.7-max',
					stream: false,
					messages: [{ role: 'user', content: 'hello' }],
				}),
				env: { ...DEFAULT_ENV, requestTimeoutMs: 1_000 },
				fetchImpl: (async (url) => {
					if (String(url).includes('/auth/v1/user/me')) {
						return Response.json({ status: 'ACTIVE', sub: USER_ID })
					}
					return {
						ok: true,
						status: 200,
						json: () => {
							markBodyStarted()
							return new Promise(() => {})
						},
					} as Response
				}) as typeof fetch,
			})
			await bodyStarted
			const rejection = expect(request).rejects.toMatchObject({
				message: 'Upstream request timed out',
				status: 504,
			})

			await vi.advanceTimersByTimeAsync(1_000)
			await rejection
		} finally {
			vi.useRealTimers()
		}
	})

	it('times out a streamed DashScope body that stops producing chunks', async () => {
		vi.useFakeTimers()
		try {
			let markChunkSent!: () => void
			const chunkSent = new Promise<void>((resolve) => {
				markChunkSent = resolve
			})
			const stalledResponse = new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))
					},
				}),
			)
			const request = handleChatCompletions({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				rawBody: JSON.stringify({
					model: 'qwen3.7-max',
					stream: true,
					messages: [{ role: 'user', content: 'hello' }],
				}),
				sse: {
					closed: false,
					send() {
						markChunkSent()
					},
					end() {},
					on() {},
				},
				env: { ...DEFAULT_ENV, requestTimeoutMs: 1_000 },
				fetchImpl: createGatewayFetch({ dashScopeResponse: stalledResponse }),
			})
			await chunkSent
			const rejection = expect(request).rejects.toMatchObject({
				message: 'Upstream request timed out',
				status: 504,
			})

			await vi.advanceTimersByTimeAsync(1_000)
			await rejection
		} finally {
			vi.useRealTimers()
		}
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

			expect(calls.some((url) => url.includes('/auth/v1/user/me'))).toBe(true)
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
		process.env.TENCENTCLOUD_SECRETID = 'secret-id'
		process.env.TENCENTCLOUD_SECRETKEY = 'secret-key'
		globalThis.fetch = (async () =>
			Response.json({ Response: { RequestId: 'request-4' } })) as typeof fetch

		try {
			const response = await launcherRegister(
				{ body: JSON.stringify({ username: 'charlie', password: 'AuthTest9!' }) },
				{
					sse() {
						throw new Error('SSE should not be used for launcher registration')
					},
				},
			)

			expect(response.statusCode).toBe(201)
			expect(response.headers).toMatchObject({ 'access-control-allow-origin': '*' })
			expect(JSON.parse(response.body)).toMatchObject({
				ok: true,
				username: 'charlie',
			})
		} finally {
			globalThis.fetch = previousFetch
			restoreEnv('TENCENTCLOUD_SECRETID', previousSecretId)
			restoreEnv('TENCENTCLOUD_SECRETKEY', previousSecretKey)
		}
	})

	it('exposes authenticated launcher activation through its own target', async () => {
		const previousFetch = globalThis.fetch
		globalThis.fetch = (async () =>
			Response.json({ status: 'ACTIVE', sub: USER_ID })) as typeof fetch

		try {
			const response = await launcherActivate(
				{ headers: { authorization: `Bearer ${ACCESS_TOKEN}` } },
				{
					sse() {
						throw new Error('SSE should not be used for launcher activation')
					},
				},
			)

			expect(response.statusCode).toBe(200)
			expect(response.headers).toMatchObject({ 'access-control-allow-origin': '*' })
			expect(JSON.parse(response.body)).toEqual({ ok: true, userId: USER_ID })
		} finally {
			globalThis.fetch = previousFetch
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

	it('detects registration preflight from access-control request headers', async () => {
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
			headers: { 'access-control-allow-origin': '*' },
		})
	})

	it('answers activation CORS preflight without requiring a bearer token', async () => {
		const response = await launcherActivate(
			{
				headers: {
					'access-control-request-method': 'POST',
					'access-control-request-headers': 'authorization',
				},
			},
			{
				sse() {
					throw new Error('SSE should not be used for launcher activation')
				},
			},
		)

		expect(response).toMatchObject({
			statusCode: 204,
			body: '',
			headers: {
				'access-control-allow-origin': '*',
				'access-control-allow-headers': 'content-type, authorization',
			},
		})
	})

	it('rate limits a warm instance by trusted IP and username with Retry-After', async () => {
		const previousFetch = globalThis.fetch
		const previousSecretId = process.env.TENCENTCLOUD_SECRETID
		const previousSecretKey = process.env.TENCENTCLOUD_SECRETKEY
		const previousUsageApiKey = process.env.CLOUDBASE_USAGE_API_KEY
		process.env.TENCENTCLOUD_SECRETID = 'secret-id'
		process.env.TENCENTCLOUD_SECRETKEY = 'secret-key'
		process.env.CLOUDBASE_USAGE_API_KEY = 'cloudbase-usage-api-key'
		globalThis.fetch = (async () =>
			Response.json({ Response: { Data: { Uid: 'cloudbase-rate-user' } } })) as typeof fetch

		try {
			for (let attempt = 0; attempt < 5; attempt += 1) {
				const response = await launcherRegister(
					{
						body: JSON.stringify({ username: 'alice', password: 'AuthTest9!' }),
						headers: {
							'x-forwarded-for': `spoofed-${attempt}, 203.0.113.9`,
						},
					},
					{
						sse() {
							throw new Error('SSE should not be used for launcher registration')
						},
					},
				)
				expect(response.statusCode).toBe(201)
			}

			const limited = await launcherRegister(
				{
					body: JSON.stringify({ username: 'alice', password: 'AuthTest9!' }),
					headers: { 'x-forwarded-for': 'another-spoof, 203.0.113.9' },
				},
				{
					sse() {
						throw new Error('SSE should not be used for launcher registration')
					},
				},
			)

			expect(limited.statusCode).toBe(429)
			expect(limited.headers).toMatchObject({ 'retry-after': '60' })
			expect(limited.body).not.toContain('AuthTest9!')
			resetLauncherRegistrationRateLimits()
			await expect(
				launcherRegister(
					{
						body: JSON.stringify({ username: 'alice', password: 'AuthTest9!' }),
						headers: { 'x-forwarded-for': 'another-spoof, 203.0.113.9' },
					},
					{
						sse() {
							throw new Error('SSE should not be used for launcher registration')
						},
					},
				),
			).resolves.toMatchObject({ statusCode: 201 })
		} finally {
			globalThis.fetch = previousFetch
			restoreEnv('TENCENTCLOUD_SECRETID', previousSecretId)
			restoreEnv('TENCENTCLOUD_SECRETKEY', previousSecretKey)
			restoreEnv('CLOUDBASE_USAGE_API_KEY', previousUsageApiKey)
		}
	})

	it('applies a global registration limit across distinct IP and username keys', async () => {
		const previousFetch = globalThis.fetch
		globalThis.fetch = (async () => {
			throw new Error('invalid passwords must not reach CloudBase')
		}) as typeof fetch

		try {
			for (let attempt = 0; attempt < 200; attempt += 1) {
				const response = await launcherRegister(
					{
						body: JSON.stringify({
							username: `user${String(attempt).padStart(5, '0')}`,
							password: 'bad',
						}),
						headers: { 'x-real-ip': `198.51.100.${attempt}` },
					},
					{
						sse() {
							throw new Error('SSE should not be used for launcher registration')
						},
					},
				)
				expect(response.statusCode).toBe(400)
			}
			const limited = await launcherRegister(
				{
					body: JSON.stringify({ username: 'user99999', password: 'bad' }),
					headers: { 'x-real-ip': '198.51.100.250' },
				},
				{
					sse() {
						throw new Error('SSE should not be used for launcher registration')
					},
				},
			)
			expect(limited).toMatchObject({
				statusCode: 429,
				headers: { 'retry-after': '60' },
			})
		} finally {
			globalThis.fetch = previousFetch
		}
	})

	it('exposes a credential-free health check target', () => {
		const previousFetch = globalThis.fetch
		globalThis.fetch = (async () => {
			throw new Error('health check must not call an external service')
		}) as typeof fetch

		try {
			const response = healthCheck()

			expect(response).toMatchObject({
				statusCode: 200,
				headers: {
					'content-type': 'application/json; charset=utf-8',
				},
			})
			expect(JSON.parse(response.body)).toEqual({
				ok: true,
				service: 'wenxue-llm-gateway',
				revision: 'admin-runtime-consolidated-v2',
			})
		} finally {
			globalThis.fetch = previousFetch
		}
	})

	it('configures health, launcher, AdminConsole, and AdminApi routes', () => {
		const config = JSON.parse(
			readFileSync(new URL('../cloudbase-functions.json', import.meta.url), 'utf8'),
		) as { functions: Array<{ target: string; triggerPath: string }> }

		expect(config.functions).toContainEqual(
			expect.objectContaining({ target: 'healthCheck', triggerPath: '/healthz' }),
		)
		expect(config.functions).toContainEqual(
			expect.objectContaining({ target: 'launcherRegister', triggerPath: '/v1/auth/register' }),
		)
		expect(config.functions).toContainEqual(
			expect.objectContaining({ target: 'launcherActivate', triggerPath: '/v1/auth/activate' }),
		)
		expect(config.functions).toContainEqual(
			expect.objectContaining({ target: 'adminConsole', triggerPath: '/admin' }),
		)
		expect(config.functions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					target: 'adminMe',
					triggerPath: '/api/admin/v1/me',
				}),
				expect.objectContaining({
					target: 'adminUsageSummary',
					triggerPath: '/api/admin/v1/usage/summary',
				}),
				expect.objectContaining({
					target: 'adminUsers',
					triggerPath: '/api/admin/v1/users',
				}),
				expect.objectContaining({
					target: 'adminUserStatus',
					triggerPath: '/api/admin/v1/user-status',
				}),
			]),
		)
	})

	it('reuses the AdminApi Function mode targets without copying their implementation', () => {
		expect(adminMe).toBe(originalAdminMe)
		expect(adminUsageSummary).toBe(originalAdminUsageSummary)
		expect(adminUsers).toBe(originalAdminUsers)
		expect(adminUserStatus).toBe(originalAdminUserStatus)
	})

	it('packages the gateway, AdminApi, and built AdminConsole with their topology intact', () => {
		const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
		const prepareScript = readFileSync(
			new URL('../scripts/prepare-cloudbase-deploy.mjs', import.meta.url),
			'utf8',
		)

		expect(dockerfile).toContain('WORKDIR /app\n')
		expect(dockerfile).toContain('WORKDIR /app/apps/llm-gateway')
		expect(dockerfile).toContain(
			'CMD ["node", "/app/node_modules/@cloudbase/functions-framework/bin/tcb-ff.js"',
		)
		expect(dockerfile).toContain('COPY apps/llm-gateway/src ./src')
		expect(dockerfile).toContain('COPY apps/admin-api/src /app/apps/admin-api/src')
		expect(dockerfile).toContain('COPY apps/admin/dist /app/apps/admin/dist')
		expect(prepareScript).toContain("VITE_BASE_PATH: '/admin/'")
		expect(prepareScript).toContain("VITE_WENXUE_ADMIN_API_BASE_URL: ''")
	})

	it('serves the AdminConsole index and immutable assets from the consolidated runtime', async () => {
		resetAdminConsoleFileCache()
		const files = new Map([
			['/tmp/admin-dist/index.html', Buffer.from('<!doctype html><title>admin</title>')],
			['/tmp/admin-dist/assets/app-123.js', Buffer.from('console.log("admin")')],
		])
		const readFileImpl = vi.fn(async (path: string) => {
			const body = files.get(path)
			if (!body) {
				const error = new Error('missing') as NodeJS.ErrnoException
				error.code = 'ENOENT'
				throw error
			}
			return body
		})

		const indexResponse = await serveAdminConsole({
			url: 'https://example.com/admin?tab=usage',
			distRoot: '/tmp/admin-dist',
			readFileImpl,
		})
		expect(indexResponse).toMatchObject({
			statusCode: 200,
			headers: {
				'cache-control': 'no-cache',
				'content-type': 'text/html; charset=utf-8',
				'x-content-type-options': 'nosniff',
			},
			body: Buffer.from('<!doctype html><title>admin</title>'),
		})

		const assetResponse = await serveAdminConsole({
			url: 'https://example.com/admin/assets/app-123.js',
			distRoot: '/tmp/admin-dist',
			readFileImpl,
		})
		expect(assetResponse).toMatchObject({
			statusCode: 200,
			headers: {
				'cache-control': 'public, max-age=31536000, immutable',
				'content-type': 'text/javascript; charset=utf-8',
			},
			body: Buffer.from('console.log("admin")'),
		})
	})

	it('rejects AdminConsole traversal and non-read methods', async () => {
		const readFileImpl = vi.fn()
		const traversal = await serveAdminConsole({
			url: 'https://example.com/admin/assets/%2e%2e/secret.txt',
			distRoot: '/tmp/admin-dist',
			readFileImpl,
		})
		const post = await serveAdminConsole({
			url: 'https://example.com/admin',
			method: 'POST',
			distRoot: '/tmp/admin-dist',
			readFileImpl,
		})
		const unexpectedDeepLink = await serveAdminConsole({
			url: 'https://example.com/admin/secret.txt',
			distRoot: '/tmp/admin-dist',
			readFileImpl,
		})

		expect(traversal.statusCode).toBe(404)
		expect(unexpectedDeepLink.statusCode).toBe(404)
		expect(post).toMatchObject({
			statusCode: 405,
			headers: { allow: 'GET, HEAD' },
		})
		expect(readFileImpl).not.toHaveBeenCalled()
	})

	it('exposes the AdminConsole target through the gateway entry module', () => {
		expect(adminConsole).toBeTypeOf('function')
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
							browserId: 'browser-1',
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
				browserId: 'browser-1',
				totalTokens: 5,
				ts: 1782660000000,
			}),
		])
		expect(calls[0]?.authorization).toBe('Bearer cloudbase-usage-api-key')
		expect(decodeURIComponent(calls[0]?.url ?? '')).toContain(`"uid":"${USER_ID}"`)
	})

	it('paginates usage records so cumulative totals are not capped at 500 rows', async () => {
		const calls: string[] = []
		const makeRecord = (index: number) => ({
			_id: `record-${index}`,
			uid: USER_ID,
			model: 'qwen3.7-max',
			inputTokens: 1,
			outputTokens: 1,
			totalTokens: 2,
			latencyMs: 1,
			requestId: `request-${index}`,
			ts: 1782660000000 + index,
			createdAt: '2026-06-28T15:20:00.000Z',
		})

		const records = await readUsageRecords({
			uid: USER_ID,
			envId: 'wenxue-d8gz76tacc3659f05',
			apiKey: 'cloudbase-usage-api-key',
			fetchImpl: async (url) => {
				calls.push(String(url))
				const query = JSON.parse(new URL(String(url)).searchParams.get('query') ?? '{}') as Record<
					string,
					unknown
				>
				return Response.json({
					list:
						'$and' in query
							? [makeRecord(0)]
							: Array.from({ length: 500 }, (_, index) => makeRecord(500 - index)),
				})
			},
		})

		expect(records).toHaveLength(501)
		expect(calls).toHaveLength(2)
		const secondUrl = new URL(calls[1])
		expect(secondUrl.searchParams.has('skip')).toBe(false)
		expect(JSON.parse(secondUrl.searchParams.get('query') ?? '{}')).toEqual({
			$and: [
				{ uid: USER_ID },
				{
					$or: [{ ts: { $lt: 1782660000001 } }, { ts: 1782660000001, _id: { $lt: 'record-1' } }],
				},
			],
		})
		expect(buildUsageSummary(records).totalTokens).toBe(1002)
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
			byBrowser: [{ key: 'cloud', totalTokens: 5 }],
		})
	})

	it('keeps browser groups distinct and preserves unassociated history in authenticated summaries', async () => {
		const usageRecords = [
			{ browserId: 'browser-1', inputTokens: 2, outputTokens: 3 },
			{ browserId: 'browser-2', inputTokens: 4, outputTokens: 6 },
			{ browserId: 'browser-1', inputTokens: 1, outputTokens: 2 },
			{ inputTokens: 7, outputTokens: 8 },
		].map((record, index) =>
			buildUsageRecord({
				uid: USER_ID,
				browserId: record.browserId,
				model: 'qwen3.7-max',
				usage: {
					inputTokens: record.inputTokens,
					outputTokens: record.outputTokens,
					totalTokens: record.inputTokens + record.outputTokens,
				},
				latencyMs: 123,
				requestId: `request-${index}`,
				now: () => 1782660000000 + index,
			}),
		)

		const result = await handleUsageSummary({
			headers: {
				authorization: `Bearer ${ACCESS_TOKEN}`,
				'x-wenxue-browser-id': 'another-browser',
			},
			env: DEFAULT_ENV,
			fetchImpl: createGatewayFetch({ usageRecords }),
		})

		expect(result).toMatchObject({
			totalInputTokens: 14,
			totalOutputTokens: 19,
			totalTokens: 33,
			byBrowser: [
				{ key: 'cloud', label: 'cloud', inputTokens: 7, outputTokens: 8, totalTokens: 15 },
				{ key: 'browser-2', label: 'browser-2', inputTokens: 4, outputTokens: 6, totalTokens: 10 },
				{ key: 'browser-1', label: 'browser-1', inputTokens: 3, outputTokens: 5, totalTokens: 8 },
			],
			byModel: [{ key: 'qwen3.7-max', totalTokens: 33 }],
			daily: [{ key: '2026-06-28', totalTokens: 33 }],
		})
		expect(result.recent.map((record) => record.browserId)).toEqual([
			'cloud',
			'browser-1',
			'browser-2',
			'browser-1',
		])
		expect(JSON.stringify(result)).not.toMatch(
			/user_123|prompt|content|authorization|bearer|api_key|apikey|sk-|cloudbase-access-token/i,
		)
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
	dashScopeHeaders?: Headers[]
	usageWrites?: unknown[]
	userProfile?: Record<string, unknown>
	dashScopeResponse?: Response
	usageWriteStatus?: number
	usageRecords?: Record<string, unknown>[]
}): typeof fetch {
	return (async (url, init) => {
		const href = String(url)
		options.calls?.push(href)
		if (href.includes('/auth/v1/user/me')) {
			const headers = new Headers(init?.headers)
			if (headers.get('authorization') !== `Bearer ${ACCESS_TOKEN}`) {
				return Response.json({}, { status: 401 })
			}
			return Response.json(options.userProfile ?? { status: 'ACTIVE', sub: USER_ID })
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
			options.dashScopeHeaders?.push(new Headers(init?.headers))
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

function abortError() {
	const error = new Error('aborted')
	error.name = 'AbortError'
	return error
}
