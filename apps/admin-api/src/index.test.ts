import { afterEach, describe, expect, it, vi } from 'vitest'

import { clientUpdatePolicy, me, users, userStatus } from './index.mjs'

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
	let metadata: Record<string, unknown> | null = null
	const operations: string[] = []
	const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		const headers = new Headers(init?.headers)
		if (url.pathname === '/auth/v1/user/me') {
			return Response.json({ sub: 'admin-uid', status: 'ACTIVE' })
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
								Name: 'new-account',
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
			return Response.json({ list: metadata ? [metadata] : [] })
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
		[
			'a direct Functions Framework JSON event',
			{ userId: 'user_123', status: 'disabled', note: 'reviewed' },
		],
		[
			'a wrapped HTTP event',
			{ body: JSON.stringify({ userId: 'user_123', status: 'disabled', note: 'reviewed' }) },
		],
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
			username: 'new-account',
			totalTokens: 5,
		})
		expect(operations).toEqual([
			'DescribeUserList',
			'audit:requested',
			'ModifyUser',
			'DescribeUserList',
			'note-upsert',
			'audit:succeeded',
		])
	})

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
				username: 'new-account',
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
