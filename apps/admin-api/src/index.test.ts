import { afterEach, describe, expect, it, vi } from 'vitest'

import { me, userStatus } from './index.mjs'

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
					'access-control-request-headers': 'authorization,content-type',
				},
			},
			{},
		)

		expect(response.statusCode).toBe(204)
		expect(response.headers['access-control-allow-methods']).toContain('OPTIONS')
		expect(response.body).toBe('')
	})

	it.each([
		['a direct Functions Framework JSON event', { userId: 'user_123', status: 'disabled' }],
		['a wrapped HTTP event', { body: JSON.stringify({ userId: 'user_123', status: 'disabled' }) }],
	])('passes %s through as the user status request body', async (_label, event) => {
		vi.stubEnv('CLOUDBASE_ADMIN_API_KEY', 'test-admin-key')
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ active: true, sub: 'admin-uid' }))
			.mockResolvedValueOnce(Response.json({ _id: 'admin-uid', role: 'admin', status: 'active' }))
			.mockResolvedValueOnce(
				Response.json({
					_id: 'user_123',
					uid: 'user_123',
					active: true,
					createdAt: '2026-07-01T00:00:00.000Z',
					updatedAt: '2026-07-01T00:00:00.000Z',
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					doc: {
						_id: 'user_123',
						uid: 'user_123',
						active: false,
						createdAt: '2026-07-01T00:00:00.000Z',
						updatedAt: '2026-07-14T00:00:00.000Z',
					},
				}),
			)
			.mockResolvedValueOnce(Response.json({ insertedIds: ['audit-1'] }, { status: 201 }))
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
		})
		expect(fetchImpl).toHaveBeenCalledTimes(5)
	})
})
