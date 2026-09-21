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
	buildUsageRecord,
	buildUsageSummary,
	clearAuthorizationCache,
	DASHSCOPE_CHAT_COMPLETIONS_URL,
	extractBearerToken,
	extractUsageFromSseFrame,
	handleChatCompletions,
	handleLauncherActivation,
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
	beforeEach(() => {})

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

	it('resolves omitted profile status from the exact Auth account on every request', async () => {
		const getAuthUser = vi
			.fn()
			.mockResolvedValueOnce({ uid: USER_ID, active: true })
			.mockResolvedValueOnce({ uid: USER_ID, active: false })
		const input = {
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			env: DEFAULT_ENV,
			fetchImpl: async () => Response.json({ sub: USER_ID, type: 'external' }),
			getAuthUser,
		}
		await expect(resolveCloudBaseUser(input)).resolves.toEqual({ uid: USER_ID })
		await expect(resolveCloudBaseUser(input)).rejects.toMatchObject({ status: 403 })
		expect(getAuthUser).toHaveBeenCalledTimes(2)
		expect(getAuthUser).toHaveBeenCalledWith(USER_ID, expect.any(Number))
	})

	it.each(['BLOCKED', 'UNKNOWN', '', null, 1])(
		'does not replace explicit invalid profile status %s with a management lookup',
		async (status) => {
			const getAuthUser = vi.fn().mockResolvedValue({ uid: USER_ID, active: true })
			await expect(
				resolveCloudBaseUser({
					headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
					env: DEFAULT_ENV,
					fetchImpl: async () => Response.json({ sub: USER_ID, status }),
					getAuthUser,
				}),
			).rejects.toMatchObject({ status: 403 })
			expect(getAuthUser).not.toHaveBeenCalled()
		},
	)

	it.each([
		{ user: null, status: 403 },
		{ user: { uid: 'wrong-user', active: true }, status: 503 },
	])('rejects unavailable or mismatched authoritative accounts', async ({ user, status }) => {
		await expect(
			resolveCloudBaseUser({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				env: DEFAULT_ENV,
				fetchImpl: async () => Response.json({ sub: USER_ID }),
				getAuthUser: async () => user,
			}),
		).rejects.toMatchObject({ status })
	})

	it('fails closed without a status resolver or when management lookup fails', async () => {
		const input = {
			headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
			env: DEFAULT_ENV,
			fetchImpl: async () => Response.json({ sub: USER_ID }),
		}
		await expect(resolveCloudBaseUser(input)).rejects.toMatchObject({ status: 503 })
		await expect(
			resolveCloudBaseUser({
				...input,
				getAuthUser: async () => {
					throw new Error('secret-provider-detail')
				},
			}),
		).rejects.toMatchObject({
			status: 503,
			message: '暂时无法确认账号状态，请稍后重试。',
		})
	})

	it('passes only the remaining activation budget to the status lookup', async () => {
		vi.useFakeTimers()
		const getAuthUser = vi.fn().mockResolvedValue({ uid: USER_ID, active: true })
		try {
			const activation = handleLauncherActivation({
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				env: DEFAULT_ENV,
				fetchImpl: async () => {
					await new Promise((resolve) => setTimeout(resolve, 2_000))
					return Response.json({ sub: USER_ID })
				},
				getAuthUser,
			})
			await vi.advanceTimersByTimeAsync(2_000)
			await expect(activation).resolves.toEqual({ ok: true, userId: USER_ID })
			expect(getAuthUser).toHaveBeenCalledWith(USER_ID, 8_000)
		} finally {
			vi.useRealTimers()
		}
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

	it('permanently rejects legacy registration without sending credentials or creating users', async () => {
		const fetchImpl = vi.fn()
		vi.stubGlobal('fetch', fetchImpl)
		try {
			for (const body of [
				'invalid json',
				JSON.stringify({ username: 'charlie', password: 'AuthTest9!' }),
				JSON.stringify({ email: 'user@example.com', password: 'AuthTest9!' }),
			]) {
				const response = await launcherRegister({ body }, { sse: vi.fn() })
				expect(response.statusCode).toBe(410)
				expect(response.body).not.toContain('AuthTest9!')
			}
			expect(fetchImpl).not.toHaveBeenCalled()
		} finally {
			vi.unstubAllGlobals()
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

	it.each(['activate', 'chat', 'usage'])(
		'injects an exact UID management lookup into the %s runtime target',
		async (target) => {
			vi.stubEnv('TENCENTCLOUD_SECRETID', 'test-secret-id')
			vi.stubEnv('TENCENTCLOUD_SECRETKEY', 'test-secret-key')
			vi.stubEnv('DASHSCOPE_API_KEY', 'test-dashscope-key')
			vi.stubEnv('CLOUDBASE_USAGE_API_KEY', 'test-usage-key')
			const managementCalls: unknown[] = []
			const businessFetch = createGatewayFetch({ userProfile: { sub: USER_ID } })
			vi.stubGlobal('fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
				if (String(url) !== 'https://tcb.tencentcloudapi.com') return businessFetch(url, init)
				const headers = new Headers(init?.headers)
				expect(headers.get('x-tc-action')).toBe('DescribeUserList')
				expect(headers.get('authorization')).toContain('TC3-HMAC-SHA256')
				expect(headers.get('authorization')).not.toContain(ACCESS_TOKEN)
				managementCalls.push(JSON.parse(String(init?.body)))
				return Response.json({
					Response: { Data: { Total: 1, UserList: [{ Uid: USER_ID, UserStatus: 'ACTIVE' }] } },
				})
			})
			const event = {
				headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
				body: JSON.stringify({
					model: 'qwen3.7-max',
					messages: [{ role: 'user', content: 'hello' }],
				}),
			}
			const context = { sse: vi.fn() }
			try {
				if (target === 'activate') {
					await expect(launcherActivate(event, context)).resolves.toMatchObject({ statusCode: 200 })
				} else if (target === 'chat') {
					await expect(main(event, context)).resolves.toHaveProperty('choices')
				} else {
					await expect(usageSummary(event, context)).resolves.toHaveProperty('totalTokens')
				}
				expect(managementCalls).toEqual([
					{
						EnvId: DEFAULT_ENV.cloudbaseEnvId,
						UidList: [USER_ID],
						PageNo: 1,
						PageSize: 100,
					},
				])
			} finally {
				vi.unstubAllGlobals()
				vi.unstubAllEnvs()
			}
		},
	)

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
		expect(dockerfile).toContain(
			'COPY packages/client-operations /app/node_modules/@wenxue/client-operations',
		)
		expect(prepareScript).toContain(
			"['apps/admin-api/src/cloudbaseAuth.mjs', 'apps/admin-api/src/cloudbaseAuth.mjs']",
		)
		expect(prepareScript).toContain(
			"['packages/client-operations/index.mjs', 'packages/client-operations/index.mjs']",
		)
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
