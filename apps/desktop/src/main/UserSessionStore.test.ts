import { describe, expect, it } from 'vitest'
import { UserSessionStore, type UserSession } from './UserSessionStore'

const validSession: UserSession = {
	userId: 'user_123',
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
	expiresAt: 4102444800000,
	gatewayBaseUrl: 'https://gateway.example',
}

describe('UserSessionStore', () => {
	it('stores the current user session in memory and exposes only public fields', () => {
		const store = new UserSessionStore({ gatewayBaseUrl: 'https://gateway.example' })

		expect(store.current()).toBeNull()

		const publicSession = store.setSession(validSession)

		expect(publicSession).toEqual({
			userId: 'user_123',
			expiresAt: 4102444800000,
			gatewayBaseUrl: 'https://gateway.example',
		})
		expect(store.current()).toEqual(publicSession)
		expect(store.requireSession()).toEqual(validSession)
	})

	it('rejects missing tokens and expired sessions', () => {
		const store = new UserSessionStore({
			now: () => 2000,
			gatewayBaseUrl: 'https://gateway.example',
		})

		expect(() =>
			store.setSession({
				...validSession,
				accessToken: '',
			}),
		).toThrow('用户 session 无效')
		expect(() =>
			store.setSession({
				...validSession,
				expiresAt: 1000,
			}),
		).toThrow('用户登录已过期')
	})

	it('clears the current user session', () => {
		const store = new UserSessionStore({ gatewayBaseUrl: 'https://gateway.example' })

		store.setSession(validSession)
		store.clear()

		expect(store.current()).toBeNull()
		expect(() => store.requireSession()).toThrow('请先登录问学账号')
	})

	it('ignores renderer-supplied gateway addresses', () => {
		const store = new UserSessionStore({ gatewayBaseUrl: 'https://gateway.example' })

		store.setSession({
			...validSession,
			gatewayBaseUrl: 'https://attacker.example',
		})

		expect(store.requireSession().gatewayBaseUrl).toBe('https://gateway.example')
	})
})
