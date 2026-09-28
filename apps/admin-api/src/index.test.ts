import cloudbase from '@cloudbase/node-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	announcements,
	clientUpdatePolicy,
	me,
	publicDesktopDownloads,
	users,
	userStatus,
} from './index.mjs'

const authCredentialNames = [
	'TENCENTCLOUD_SECRETID',
	'TENCENTCLOUD_SECRET_ID',
	'TENCENT_CLOUD_SECRET_ID',
	'TENCENT_SECRET_ID',
	'TENCENTCLOUD_SECRETKEY',
	'TENCENTCLOUD_SECRET_KEY',
	'TENCENT_CLOUD_SECRET_KEY',
	'TENCENT_SECRET_KEY',
	'TENCENTCLOUD_SESSIONTOKEN',
	'TENCENTCLOUD_SESSION_TOKEN',
	'TENCENTCLOUD_TOKEN',
]

function createAdminFetch() {
	let userStatus = 'ACTIVE'
	let metadata: Record<string, unknown> | null = {
		_id: 'user_123',
		uid: 'user_123',
		note: 'reviewed',
	}
	const operations: string[] = []
	const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		const headers = new Headers(init?.headers)
		if (url.pathname === '/auth/v1/token/introspect') {
			return Response.json({ sub: 'admin-uid', active: true })
		}
		if (url.hostname === 'tcb.tencentcloudapi.com') {
			const action = headers.get('x-tc-action')
			operations.push(String(action))
			if (action === 'ModifyUser') {
				userStatus = JSON.parse(String(init?.body)).UserStatus as string
				return Response.json({ Response: { Data: { Success: true } } })
			}
			return Response.json({
				Response: {
					Data: {
						Total: 1,
						UserList: [
							{
								Uid: 'user_123',
								Email: 'new@example.com',
								NickName: '新用户',
								UserStatus: userStatus,
							},
						],
					},
				},
			})
		}
		if (url.pathname.includes('/admin_users/documents/admin-uid')) {
			return Response.json({ _id: 'admin-uid', role: 'admin', status: 'active' })
		}
		if (url.pathname.includes('/user_accounts/documents')) {
			if (init?.method === 'PATCH') {
				operations.push('note-upsert')
				const payload = JSON.parse(String(init.body))
				expect(payload.upsert).toBe(true)
				expect(payload.data.$set).not.toHaveProperty('active')
				metadata = { _id: 'user_123', ...payload.data.$set }
				return Response.json({ doc: metadata })
			}
			return url.pathname.endsWith('/documents/user_123')
				? Response.json(metadata)
				: Response.json({ list: metadata ? [metadata] : [] })
		}
		if (url.pathname.includes('/token_usage/documents')) {
			return Response.json({
				list: [
					{
						_id: 'usage-1',
						uid: 'user_123',
						model: 'qwen-plus',
						inputTokens: 2,
						outputTokens: 3,
						totalTokens: 5,
						ts: 1782896640000,
					},
				],
			})
		}
		if (url.pathname.includes('/user_permission_audit/documents')) {
			const payload = JSON.parse(String(init?.body))
			operations.push(`audit:${String(payload.data[0].outcome)}`)
			return Response.json({ insertedIds: ['audit-1'] }, { status: 201 })
		}
		throw new Error(`Unexpected request path: ${url.pathname}`)
	})
	return { fetchImpl, operations }
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

describe('Admin API CloudBase adapter', () => {
	it('treats browser CORS preflight headers as OPTIONS when method is omitted', async () => {
		const response = await me(
			{
				headers: {
					origin: 'https://wenxue-admin.example.test',
					'access-control-request-method': 'GET',
					'access-control-request-headers': 'authorization,content-type,idempotency-key',
				},
			},
			{},
		)

		expect(response.statusCode).toBe(204)
		expect(response.headers['access-control-allow-methods']).toContain('OPTIONS')
		expect(response.headers['access-control-allow-headers']).toContain('idempotency-key')
		expect(response.body).toBe('')
	})

	it.each([
		['a direct Functions Framework JSON event', { userId: 'user_123', status: 'disabled' }],
		[
			'a direct JSON event with a plain business body',
			{ userId: 'user_123', status: 'disabled', body: 'Please read this announcement.' },
		],
		[
			'a direct JSON event with a JSON-looking business body',
			{
				userId: 'user_123',
				status: 'disabled',
				body: '{"message":"Please read this announcement."}',
			},
		],
		['a wrapped HTTP event', { body: JSON.stringify({ userId: 'user_123', status: 'disabled' }) }],
		[
			'a wrapped HTTP event with envelope metadata',
			{
				body: JSON.stringify({ userId: 'user_123', status: 'disabled' }),
				httpMethod: 'PATCH',
				headers: { authorization: 'Bearer test-token' },
			},
		],
		['a wrapped object body', { body: { userId: 'user_123', status: 'disabled' } }],
		[
			'a wrapped base64 body',
			{
				body: Buffer.from(JSON.stringify({ userId: 'user_123', status: 'disabled' })).toString(
					'base64',
				),
				isBase64Encoded: true,
			},
		],
		['a wrapped raw body', { rawBody: JSON.stringify({ userId: 'user_123', status: 'disabled' }) }],
	])('passes %s through as the user status request body', async (_label, event) => {
		vi.stubEnv('CLOUDBASE_ADMIN_API_KEY', 'test-admin-key')
		vi.stubEnv('TENCENTCLOUD_SECRETID', 'test-secret-id')
		vi.stubEnv('TENCENTCLOUD_SECRETKEY', 'test-secret-key')
		const { fetchImpl, operations } = createAdminFetch()
		vi.stubGlobal('fetch', fetchImpl)

		const response = await userStatus(event, {
			httpContext: {
				httpMethod: 'PATCH',
				headers: { authorization: 'Bearer test-token' },
				url: 'https://example.test/api/admin/v1/user-status',
			},
		})

		expect(response.statusCode).toBe(200)
		expect(JSON.parse(response.body).user).toMatchObject({
			userId: 'user_123',
			status: 'disabled',
			note: 'reviewed',
			email: 'new@example.com',
			nickname: '新用户',
			totalTokens: 5,
		})
		expect(operations).toEqual([
			'DescribeUserList',
			'audit:requested',
			'ModifyUser',
			'DescribeUserList',
			'audit:applied',
		])
	})

	it('rejects malformed JSON in a body-only HTTP wrapper', async () => {
		vi.stubEnv('CLOUDBASE_ADMIN_API_KEY', 'test-admin-key')
		const { fetchImpl, operations } = createAdminFetch()
		vi.stubGlobal('fetch', fetchImpl)

		const response = await userStatus(
			{ body: '{invalid' },
			{
				httpContext: {
					httpMethod: 'PATCH',
					headers: { authorization: 'Bearer test-token' },
				},
			},
		)

		expect(response.statusCode).toBe(400)
		expect(JSON.parse(response.body).error.message).toBe('Invalid JSON body')
		expect(operations).toEqual([])
	})

	it.each(['Please read this announcement.', '{"message":"Please read this announcement."}'])(
		'preserves a direct announcement body through publication: %s',
		async (body) => {
			vi.stubEnv('CLOUDBASE_ADMIN_API_KEY', 'test-admin-key')
			const { fetchImpl } = createAdminFetch()
			vi.stubGlobal('fetch', fetchImpl)
			const documents = new Map<string, Record<string, unknown>>()
			const transaction = {
				collection(collection: string) {
					return {
						doc(id: string) {
							const key = `${collection}/${id}`
							return {
								async get() {
									return { data: documents.get(key) ?? null }
								},
								async set(data: Record<string, unknown>) {
									documents.set(key, { _id: id, ...data })
									return { updated: 1 }
								},
							}
						},
					}
				},
			}
			vi.spyOn(cloudbase, 'init').mockReturnValue({
				database: () => ({
					runTransaction: <T>(callback: (value: typeof transaction) => Promise<T>) =>
						callback(transaction),
				}),
			} as unknown as ReturnType<typeof cloudbase.init>)

			const response = await announcements(
				{ importance: 'normal', title: 'System notice', body, audience: {} },
				{
					httpContext: {
						httpMethod: 'POST',
						headers: {
							authorization: 'Bearer test-token',
							'idempotency-key': 'notice-body-regression',
						},
					},
				},
			)

			expect(response.statusCode).toBe(201)
			const published = JSON.parse(response.body).announcement
			expect(published.body).toBe(body)
			expect(documents.get(`client_announcements/${published.id}`)?.body).toBe(body)
		},
	)

	it.each([
		['TENCENTCLOUD_SECRETID', 'TENCENTCLOUD_SECRETKEY', 'TENCENTCLOUD_SESSIONTOKEN'],
		['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY', 'TENCENTCLOUD_SESSION_TOKEN'],
		['TENCENT_CLOUD_SECRET_ID', 'TENCENT_CLOUD_SECRET_KEY', 'TENCENTCLOUD_TOKEN'],
		['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENTCLOUD_TOKEN'],
	])('wires the %s credential family to the Auth directory', async (idName, keyName, tokenName) => {
		for (const name of authCredentialNames) vi.stubEnv(name, undefined)
		vi.stubEnv('CLOUDBASE_ADMIN_API_KEY', 'test-admin-key')
		vi.stubEnv('CLOUDBASE_REGION', 'ap-guangzhou')
		vi.stubEnv(idName, 'alias-secret-id')
		vi.stubEnv(keyName, 'alias-secret-key')
		vi.stubEnv(tokenName, 'alias-session-token')
		const { fetchImpl } = createAdminFetch()
		vi.stubGlobal('fetch', fetchImpl)
		const response = await users({ headers: { authorization: 'Bearer test-token' } }, {})
		expect(response.statusCode).toBe(200)
		expect(JSON.parse(response.body).users).toEqual([
			expect.objectContaining({
				userId: 'user_123',
				email: 'new@example.com',
				nickname: '新用户',
				status: 'active',
				totalTokens: 5,
			}),
		])
		const authRequest = fetchImpl.mock.calls.find(
			([url]) => String(url) === 'https://tcb.tencentcloudapi.com',
		)
		const headers = new Headers(authRequest?.[1]?.headers)
		expect(headers.get('authorization')).toContain('Credential=alias-secret-id/')
		expect(headers.get('x-tc-region')).toBe('ap-guangzhou')
		expect(headers.get('x-tc-token')).toBe('alias-session-token')
	})

	it('reads client update query parameters from the Functions Framework URL', async () => {
		vi.stubEnv('CLOUDBASE_ADMIN_API_KEY', 'test-admin-key')
		vi.stubEnv(
			'WENXUE_RELEASE_EVENT_TOKEN_SECRET',
			'test-release-event-token-secret-32-bytes-minimum',
		)
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 404 }))
			.mockResolvedValueOnce(Response.json({ list: [] }))
		vi.stubGlobal('fetch', fetchImpl)

		const response = await clientUpdatePolicy(
			{},
			{
				httpContext: {
					httpMethod: 'GET',
					headers: { 'x-real-ip': '203.0.113.20' },
					url: `https://example.test/v1/client/update-policy?runtime=electron&platform=darwin&arch=arm64&channel=stable&version=0.1.0&installIdHash=${'a'.repeat(64)}`,
				},
			},
		)

		expect(response.statusCode).toBe(200)
		expect(JSON.parse(response.body)).toEqual({ policy: null })
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		const requestUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]))
		expect(JSON.parse(requestUrl.searchParams.get('query') ?? '')).toEqual({
			runtime: 'electron',
			channel: 'stable',
		})
	})
})

it('dispatches the public desktop download GET anonymously through the real store', async () => {
	vi.stubEnv('CLOUDBASE_ADMIN_API_KEY', 'test-admin-key')
	const fetchImpl = vi.fn<typeof fetch>(async (input) => {
		expect(String(input)).toMatch(
			/\/desktop_release_rollouts\/documents\/release-slot%3Aelectron%3A(stable|beta)/,
		)
		return Response.json(null)
	})
	vi.stubGlobal('fetch', fetchImpl)
	const response = await publicDesktopDownloads({}, { httpContext: { headers: {} } })
	expect(response.statusCode).toBe(200)
	expect(JSON.parse(response.body)).toEqual({ release: null })
	expect(response.headers['cache-control']).toBe('no-store')
	expect(fetchImpl).toHaveBeenCalledTimes(2)
})
