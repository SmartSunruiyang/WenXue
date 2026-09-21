import { describe, expect, it, vi } from 'vitest'

import { buildTencentCloudSignedRequest, createCloudBaseAuthDirectory } from './cloudbaseAuth.mjs'

const config = { envId: 'env-test', secretId: 'secret-id', secretKey: 'secret-key' }
const authUser = (uid = 'uid-1') => ({
	Uid: uid,
	Email: `${uid}@example.com`,
	NickName: '昵称',
	UserStatus: 'ACTIVE',
	Type: 'externalUser',
	Password: 'do-not-expose',
})
const usersResponse = (users: unknown[], total = users.length) =>
	Response.json({ Response: { Data: { Total: total, UserList: users } } })

describe('CloudBase Auth account directory', () => {
	it('pages through real Auth accounts and returns only allowlisted account fields', async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				usersResponse(
					Array.from({ length: 100 }, (_, index) => authUser(`uid-${index}`)),
					101,
				),
			)
			.mockResolvedValueOnce(usersResponse([authUser('last')], 101))
		const users = await createCloudBaseAuthDirectory({ ...config, fetchImpl }).listUsers()
		expect(users).toHaveLength(101)
		expect(users[100]).toEqual({
			_id: 'last',
			uid: 'last',
			email: 'last@example.com',
			nickname: '昵称',
			active: true,
			status: 'active',
			userType: 'externalUser',
		})
		expect(JSON.stringify(users)).not.toContain('do-not-expose')
		expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({
			EnvId: 'env-test',
			PageNo: 2,
			PageSize: 100,
		})
		expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('x-tc-action')).toBe(
			'DescribeUserList',
		)
	})

	it('looks up the exact UID and does not confuse duplicate nicknames', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(usersResponse([authUser()]))
		const user = await createCloudBaseAuthDirectory({ ...config, fetchImpl }).getUser('uid-1')
		expect(user?.uid).toBe('uid-1')
		expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
			EnvId: 'env-test',
			UidList: ['uid-1'],
			PageNo: 1,
			PageSize: 100,
		})
		fetchImpl.mockResolvedValue(usersResponse([authUser('wrong')]))
		await expect(
			createCloudBaseAuthDirectory({ ...config, fetchImpl }).getUser('uid-1'),
		).rejects.toMatchObject({ status: 502 })
	})

	it('modifies only authoritative account status without changing identity or password', async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ Response: { Data: { Success: true } } }))
			.mockResolvedValueOnce(usersResponse([{ ...authUser(), UserStatus: 'BLOCKED' }]))
		await createCloudBaseAuthDirectory({ ...config, fetchImpl }).updateUserStatus('uid-1', false)
		expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('x-tc-action')).toBe('ModifyUser')
		expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
			EnvId: 'env-test',
			Uid: 'uid-1',
			UserStatus: 'BLOCKED',
		})
	})

	it.each([
		{ users: [] },
		{ users: [authUser()] },
		{ users: [{ ...authUser('wrong'), UserStatus: 'BLOCKED' }] },
	])(
		'rejects a successful write whose Auth readback is absent, stale or mismatched: %j',
		async ({ users }) => {
			const fetchImpl = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(Response.json({ Response: { Data: { Success: true } } }))
				.mockResolvedValueOnce(usersResponse(users))
			await expect(
				createCloudBaseAuthDirectory({ ...config, fetchImpl }).updateUserStatus('uid-1', false),
			).rejects.toMatchObject({ status: 502 })
		},
	)

	it('returns the valid Auth last-login timestamp without exposing raw metadata', async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				usersResponse([{ ...authUser(), LastLoginTime: '2026-09-22T08:30:00+08:00' }]),
			)
		const user = await createCloudBaseAuthDirectory({ ...config, fetchImpl }).getUser('uid-1')
		expect(user).toMatchObject({
			email: 'uid-1@example.com',
			nickname: '昵称',
			lastSeenAt: '2026-09-22T00:30:00.000Z',
		})
		expect(user).not.toHaveProperty('LastLoginTime')
	})

	it('rejects a changing total during Auth pagination', async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				usersResponse(
					Array.from({ length: 100 }, (_, index) => authUser(`uid-${index}`)),
					101,
				),
			)
			.mockResolvedValueOnce(usersResponse([authUser('last')], 102))
		await expect(
			createCloudBaseAuthDirectory({ ...config, fetchImpl }).listUsers(),
		).rejects.toMatchObject({ status: 502 })
	})

	it('fails closed before network requests when management credentials are missing', async () => {
		const fetchImpl = vi.fn<typeof fetch>()
		await expect(
			createCloudBaseAuthDirectory({ envId: config.envId, fetchImpl }).listUsers(),
		).rejects.toMatchObject({ status: 503 })
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it.each([
		{ Response: { Error: { Code: 'UnauthorizedOperation', Message: 'do-not-expose' } } },
		{ Response: { Data: { Total: 1, UserList: [] } } },
		{ Response: { Data: { Total: 1, UserList: [{ Uid: 'uid-1' }] } } },
		{ Response: { Data: { Total: '1', UserList: [authUser()] } } },
	])('rejects Auth errors and incomplete results without using legacy data', async (payload) => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
		await expect(
			createCloudBaseAuthDirectory({ ...config, fetchImpl }).listUsers(),
		).rejects.toMatchObject({ status: 502 })
	})

	it('requires a confirmed successful status mutation', async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ Response: { Data: { Success: false } } }))
		await expect(
			createCloudBaseAuthDirectory({ ...config, fetchImpl }).updateUserStatus('uid-1', true),
		).rejects.toMatchObject({ status: 502 })
	})

	it('bounds a stalled response body as well as the initial request', async () => {
		vi.useFakeTimers()
		try {
			const fetchImpl = vi
				.fn<typeof fetch>()
				.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as Response)
			const result = createCloudBaseAuthDirectory({
				...config,
				fetchImpl,
				timeoutMs: 60_000,
			}).listUsers()
			const rejection = expect(result).rejects.toMatchObject({ status: 504 })
			await vi.advanceTimersByTimeAsync(10_000)
			await rejection
		} finally {
			vi.useRealTimers()
		}
	})

	it('caps a UID lookup with its caller remaining authentication budget', async () => {
		vi.useFakeTimers()
		try {
			let requestSignal: AbortSignal | null | undefined
			const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_, init) => {
				requestSignal = init?.signal
				return { ok: true, json: () => new Promise(() => {}) } as Response
			})
			const result = createCloudBaseAuthDirectory({
				...config,
				fetchImpl,
				timeoutMs: 10_000,
			}).getUser('uid-1', 1_000)
			const rejection = expect(result).rejects.toMatchObject({ status: 504 })
			await vi.advanceTimersByTimeAsync(1_000)
			await rejection
			expect(requestSignal?.aborted).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('signs control plane calls with TC3 and includes temporary session credentials', () => {
		const request = buildTencentCloudSignedRequest({
			...config,
			region: 'ap-shanghai',
			token: 'session-token',
			action: 'DescribeUserList',
			payload: { EnvId: 'env-test', PageNo: 1 },
			now: () => 1782660000000,
		})
		const headers = new Headers(request.headers)
		expect(headers.get('x-tc-version')).toBe('2018-06-08')
		expect(headers.get('x-tc-token')).toBe('session-token')
		expect(headers.get('x-tc-timestamp')).toBe('1782660000')
		expect(headers.get('authorization')).toMatch(/^TC3-HMAC-SHA256 Credential=secret-id\//)
		expect(headers.get('authorization')).toContain('SignedHeaders=content-type;host')
	})
})
