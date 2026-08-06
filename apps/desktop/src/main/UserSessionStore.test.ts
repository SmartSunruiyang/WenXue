import { describe, expect, it, vi } from 'vitest'
import {
	UserSessionStore,
	type UserSession,
	type UserSessionStoreOptions,
} from './UserSessionStore'

const validSession: UserSession = {
	userId: 'user_123',
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
	expiresAt: 4102444800000,
	gatewayBaseUrl: 'https://gateway.example',
}

function createStore(options: UserSessionStoreOptions = {}): UserSessionStore {
	return new UserSessionStore({
		gatewayBaseUrl: 'https://gateway.example',
		fetchImpl: verificationFetch(validSession.userId),
		...options,
	})
}

function verificationFetch(userId: string): typeof fetch {
	return (async () =>
		new Response(JSON.stringify({ ok: true, userId }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})) as typeof fetch
}

describe('UserSessionStore', () => {
	it('stores a gateway-verified user session in memory and exposes only public fields', async () => {
		const store = createStore()

		expect(store.current()).toBeNull()

		const publicSession = await store.setSession(validSession)

		expect(publicSession).toEqual({
			userId: 'user_123',
			expiresAt: 4102444800000,
			gatewayBaseUrl: 'https://gateway.example',
		})
		expect(store.current()).toEqual(publicSession)
		expect(store.requireSession()).toEqual(validSession)
	})

	it('rejects missing tokens and expired sessions', async () => {
		const store = createStore({
			now: () => 2000,
		})

		await expect(
			store.setSession({
				...validSession,
				accessToken: '',
			}),
		).rejects.toThrow('用户 session 无效')
		await expect(
			store.setSession({
				...validSession,
				expiresAt: 1000,
			}),
		).rejects.toThrow('用户登录已过期')
	})

	it('clears the current user session', async () => {
		const store = createStore()

		await store.setSession(validSession)
		store.clear()

		expect(store.current()).toBeNull()
		expect(() => store.requireSession()).toThrow('请先登录问学账号')
	})

	it('allows same-account refresh and rejects replacing an active account', async () => {
		const store = createStore()
		await store.setSession(validSession)

		await store.setSession({
			...validSession,
			accessToken: 'refreshed-access-token',
			refreshToken: 'refreshed-refresh-token',
		})
		expect(store.requireSession().accessToken).toBe('refreshed-access-token')

		await expect(
			store.setSession({
				...validSession,
				userId: 'user_456',
			}),
		).rejects.toThrow('问学账号身份校验失败，请重新登录')
		expect(store.requireSession().userId).toBe('user_123')
	})

	it('retains expired account ownership until explicit sign-out', async () => {
		let now = 1000
		const store = createStore({
			now: () => now,
		})
		await store.setSession({ ...validSession, expiresAt: 2000 })
		now = 3000

		expect(store.current()).toBeNull()
		expect(() => store.requireSession()).toThrow('用户登录已过期，请重新登录')
		await expect(
			store.setSession({ ...validSession, userId: 'user_456', expiresAt: 4000 }),
		).rejects.toThrow('问学账号身份校验失败，请重新登录')

		await store.setSession({ ...validSession, expiresAt: 4000 })
		expect(store.requireSession().userId).toBe('user_123')
	})

	it('ignores renderer-supplied gateway addresses', async () => {
		const fetchImpl = vi.fn(verificationFetch(validSession.userId))
		const store = createStore({ fetchImpl })

		await store.setSession({
			...validSession,
			gatewayBaseUrl: 'https://attacker.example',
		})

		expect(store.requireSession().gatewayBaseUrl).toBe('https://gateway.example')
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://gateway.example/v1/auth/activate',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
			}),
		)
	})

	it('rejects a renderer user id that does not match the token owner', async () => {
		const store = createStore({ fetchImpl: verificationFetch('real-token-owner') })

		await expect(store.setSession(validSession)).rejects.toThrow('问学账号身份校验失败，请重新登录')
		expect(store.current()).toBeNull()
	})

	it('fails closed when the trusted gateway cannot verify the token', async () => {
		const store = createStore({
			fetchImpl: (async () =>
				new Response(JSON.stringify({ error: 'invalid token' }), {
					status: 401,
					headers: { 'content-type': 'application/json' },
				})) as typeof fetch,
		})

		await expect(store.setSession(validSession)).rejects.toThrow('问学账号身份校验失败，请重新登录')
		expect(store.current()).toBeNull()
	})

	it('times out even when a custom fetch implementation ignores abort signals', async () => {
		const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch
		const store = createStore({ fetchImpl, verificationTimeoutMs: 5 })

		await expect(store.setSession(validSession)).rejects.toThrow(
			'无法验证问学账号，请检查网络后重试',
		)
		expect(store.current()).toBeNull()
	})
})
