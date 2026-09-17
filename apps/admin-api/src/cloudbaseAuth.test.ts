import { describe, expect, it, vi } from 'vitest'

import { createCloudBaseAuthDirectory } from './cloudbaseAuth.mjs'

const credentials = {
	envId: 'test-env',
	secretId: 'test-secret-id',
	secretKey: 'test-secret-key',
	token: 'test-session-token',
	region: 'ap-shanghai',
	now: () => Date.parse('2026-09-18T00:00:00.000Z'),
}

function authUser(uid = 'user-1', status = 'ACTIVE') {
	return { Uid: uid, UserStatus: status, Name: `login-${uid}` }
}

function userPage(users: Record<string, unknown>[], total = users.length) {
	return Response.json({ Response: { Data: { Total: total, UserList: users } } })
}

function createDirectory(responses: Response[]) {
	const fetchImpl = vi.fn<typeof fetch>(async () => {
		const response = responses.shift()
		if (!response) throw new Error('Unexpected request')
		return response
	})
	return { directory: createCloudBaseAuthDirectory({ ...credentials, fetchImpl }), fetchImpl }
}

function requestBody(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, index: number) {
	return JSON.parse(String(fetchImpl.mock.calls[index]?.[1]?.body)) as Record<string, unknown>
}

describe('CloudBase Auth user directory', () => {
	it('signs the documented management API and returns only permitted account fields', async () => {
		const { directory, fetchImpl } = createDirectory([
			userPage([
				{
					...authUser(),
					NickName: '测试用户',
					Type: 'externalUser',
					LastLoginTime: '2026-09-17T22:00:00Z',
					Phone: 'private-phone',
					Password: 'private-password',
					Email: 'private@example.test',
				},
			]),
		])

		await expect(directory.listUsers()).resolves.toEqual([
			{
				_id: 'user-1',
				uid: 'user-1',
				active: true,
				status: 'active',
				username: 'login-user-1',
				displayName: '测试用户',
				userType: 'externalUser',
				lastSeenAt: '2026-09-17T22:00:00.000Z',
			},
		])
		const [url, init] = fetchImpl.mock.calls[0]
		expect(url).toBe('https://tcb.tencentcloudapi.com')
		expect(init?.method).toBe('POST')
		const headers = new Headers(init?.headers)
		expect(headers.get('x-tc-action')).toBe('DescribeUserList')
		expect(headers.get('x-tc-version')).toBe('2018-06-08')
		expect(headers.get('x-tc-region')).toBe('ap-shanghai')
		expect(headers.get('x-tc-token')).toBe('test-session-token')
		expect(headers.get('authorization')).toMatch(
			/^TC3-HMAC-SHA256 Credential=test-secret-id\/2026-09-18\/tcb\/tc3_request, SignedHeaders=content-type;host, Signature=[a-f0-9]{64}$/,
		)
		expect(requestBody(fetchImpl, 0)).toEqual({ EnvId: 'test-env', PageNo: 1, PageSize: 100 })
	})

	it('reads beyond the first 100 Auth users without a fixed total limit', async () => {
		const firstPage = Array.from({ length: 100 }, (_, index) => authUser(`user-${index}`))
		const { directory, fetchImpl } = createDirectory([
			userPage(firstPage, 101),
			userPage([authUser('last-user', 'BLOCKED')], 101),
		])
		const users = await directory.listUsers()
		expect(users).toHaveLength(101)
		expect(users[100]).toMatchObject({ uid: 'last-user', active: false, status: 'disabled' })
		expect(requestBody(fetchImpl, 1)).toEqual({ EnvId: 'test-env', PageNo: 2, PageSize: 100 })
	})

	it('uses UidList to read a single account and returns null only for an authoritative empty result', async () => {
		const { directory, fetchImpl } = createDirectory([userPage([])])
		await expect(directory.getUser('new-user')).resolves.toBeNull()
		expect(requestBody(fetchImpl, 0)).toEqual({
			EnvId: 'test-env',
			PageNo: 1,
			PageSize: 100,
			UidList: ['new-user'],
		})
	})

	it('rejects a single-user response containing another identity', async () => {
		const { directory } = createDirectory([userPage([authUser('another-user')])])
		await expect(directory.getUser('expected-user')).rejects.toMatchObject({ status: 502 })
	})

	it.each([
		['missing identity', { UserStatus: 'ACTIVE' }],
		['missing status', { Uid: 'user-1' }],
		['unknown status', authUser('user-1', 'PENDING')],
	])('fails closed for %s', async (_label, row) => {
		const { directory } = createDirectory([userPage([row])])
		await expect(directory.listUsers()).rejects.toMatchObject({ status: 502 })
	})

	it.each([
		{ Response: {} },
		{ Response: { Data: { Total: '1', UserList: [authUser()] } } },
		{ Response: { Data: { Total: 1, UserList: [] } } },
		{ Response: { Data: { Total: 0, UserList: null } } },
		{ Response: { Data: { Total: 2, UserList: [authUser(), authUser()] } } },
	])('rejects malformed or incomplete directory data', async (payload) => {
		const { directory } = createDirectory([Response.json(payload)])
		await expect(directory.listUsers()).rejects.toMatchObject({ status: 502 })
	})

	it('fails closed if the directory total changes during pagination', async () => {
		const { directory } = createDirectory([
			userPage(
				Array.from({ length: 100 }, (_, index) => authUser(`user-${index}`)),
				101,
			),
			userPage([authUser('last-user')], 102),
		])
		await expect(directory.listUsers()).rejects.toThrow(/incomplete or changed/)
	})

	it.each([true, false])('writes %s to Auth and verifies the returned status', async (active) => {
		const { directory, fetchImpl } = createDirectory([
			Response.json({ Response: { Data: { Success: true } } }),
			userPage([authUser('user-1', active ? 'ACTIVE' : 'BLOCKED')]),
		])
		await expect(directory.setUserStatus('user-1', active)).resolves.toMatchObject({ active })
		expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('x-tc-action')).toBe('ModifyUser')
		expect(requestBody(fetchImpl, 0)).toEqual({
			EnvId: 'test-env',
			Uid: 'user-1',
			UserStatus: active ? 'ACTIVE' : 'BLOCKED',
		})
		expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get('x-tc-action')).toBe(
			'DescribeUserList',
		)
		expect(requestBody(fetchImpl, 1).UidList).toEqual(['user-1'])
	})

	it.each([{ Success: false }, {}, null])(
		'does not accept an unconfirmed ModifyUser result',
		async (data) => {
			const { directory, fetchImpl } = createDirectory([
				Response.json({ Response: { Data: data } }),
			])
			await expect(directory.setUserStatus('user-1', false)).rejects.toMatchObject({ status: 502 })
			expect(fetchImpl).toHaveBeenCalledTimes(1)
		},
	)

	it.each([{ users: [authUser()] }, { users: [] }])(
		'does not claim success when status readback fails',
		async ({ users }) => {
			const { directory } = createDirectory([
				Response.json({ Response: { Data: { Success: true } } }),
				userPage(users),
			])
			await expect(directory.setUserStatus('user-1', false)).rejects.toThrow(
				/could not be verified/,
			)
		},
	)

	it('fails before any network request if management credentials are missing', async () => {
		const fetchImpl = vi.fn<typeof fetch>()
		const directory = createCloudBaseAuthDirectory({ envId: 'test-env', fetchImpl })
		await expect(directory.listUsers()).rejects.toMatchObject({ status: 503 })
		await expect(directory.setUserStatus('user-1', false)).rejects.toMatchObject({ status: 503 })
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it.each([
		Response.json({
			Response: { Error: { Code: 'AuthFailure', Message: 'test-secret-key test-session-token' } },
		}),
		new Response('test-secret-key test-session-token', { status: 403 }),
		new Response('test-secret-key test-session-token'),
	])('redacts upstream error bodies', async (response) => {
		const { directory } = createDirectory([response])
		const error = await directory.listUsers().catch((failure: Error) => failure)
		expect(error).toMatchObject({ status: 502 })
		expect(String(error)).not.toContain('test-secret-key')
		expect(String(error)).not.toContain('test-session-token')
	})

	it('redacts a transport rejection that includes credentials', async () => {
		const directory = createCloudBaseAuthDirectory({
			...credentials,
			fetchImpl: async () => {
				throw new Error('test-secret-key test-session-token')
			},
		})
		const error = await directory.listUsers().catch((failure: Error) => failure)
		expect(error).toMatchObject({ status: 502 })
		expect(String(error)).not.toContain('test-secret-key')
	})

	it('bounds response body parsing by the same request deadline', async () => {
		let signal: AbortSignal | null | undefined
		const directory = createCloudBaseAuthDirectory({
			...credentials,
			timeoutMs: 5,
			fetchImpl: async (_url, init) => {
				signal = init?.signal
				return new Response(new ReadableStream<Uint8Array>({ start() {} }))
			},
		})
		await expect(directory.listUsers()).rejects.toMatchObject({ status: 504 })
		expect(signal?.aborted).toBe(true)
	})
})
