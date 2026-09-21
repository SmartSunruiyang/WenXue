import { afterEach, describe, expect, it, vi } from 'vitest'

import { clientUpdatePolicy, me, userStatus } from './index.mjs'

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
		['a direct Functions Framework JSON event', { userId: 'user_123', status: 'disabled' }],
		['a wrapped HTTP event', { body: JSON.stringify({ userId: 'user_123', status: 'disabled' }) }],
	])('passes %s through as the user status request body', async (_label, event) => {
		vi.stubEnv('CLOUDBASE_ADMIN_API_KEY', 'test-admin-key')
		vi.stubEnv('TENCENTCLOUD_SECRETID', 'test-secret-id')
		vi.stubEnv('TENCENTCLOUD_SECRETKEY', 'test-secret-key')
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ active: true, sub: 'admin-uid' }))
			.mockResolvedValueOnce(Response.json({ _id: 'admin-uid', role: 'admin', status: 'active' }))
			.mockResolvedValueOnce(
				Response.json({
					Response: {
						Data: {
							Total: 1,
							UserList: [
								{
									Uid: 'user_123',
									Email: 'user@example.com',
									NickName: '昵称',
									UserStatus: 'ACTIVE',
									Type: 'externalUser',
								},
							],
						},
					},
				}),
			)
			.mockResolvedValueOnce(Response.json({ _id: 'user_123', uid: 'user_123', note: 'reviewed' }))
			.mockResolvedValueOnce(Response.json({ insertedIds: ['audit-request'] }, { status: 201 }))
			.mockResolvedValueOnce(Response.json({ Response: { Data: { Success: true } } }))
			.mockResolvedValueOnce(Response.json({ insertedIds: ['audit-result'] }, { status: 201 }))
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
		})
		expect(fetchImpl).toHaveBeenCalledTimes(7)
		expect(new Headers(fetchImpl.mock.calls[5][1]?.headers).get('x-tc-action')).toBe('ModifyUser')
		expect(JSON.parse(String(fetchImpl.mock.calls[5][1]?.body))).toMatchObject({
			Uid: 'user_123',
			UserStatus: 'BLOCKED',
		})
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
