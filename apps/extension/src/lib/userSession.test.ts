import { describe, expect, it, vi } from 'vitest'

import { WENXUE_GATEWAY_BASE_URL } from '@/agent/constants'
import {
	WENXUE_USER_SESSION_KEY,
	loadExtensionUserSession,
	normalizeExtensionUserSession,
	saveExtensionUserSession,
	type UserSessionStorageArea,
} from '@/lib/userSession'

describe('userSession', () => {
	const session = {
		userId: 'user_123',
		accessToken: 'access-token',
		refreshToken: 'refresh-token',
		expiresAt: 1782633600000,
		gatewayBaseUrl: WENXUE_GATEWAY_BASE_URL,
	}

	it('normalizes user sessions and rejects obsolete token session shapes', () => {
		expect(normalizeExtensionUserSession(session)).toEqual(session)
		expect(
			normalizeExtensionUserSession({
				...session,
				gatewayBaseUrl: `${WENXUE_GATEWAY_BASE_URL}/v1/`,
			}),
		).toEqual(session)
		expect(
			normalizeExtensionUserSession({
				token: 'legacy-local-token',
				localId: 'legacy-local-id',
				createdAt: 100_000,
				gatewayBaseUrl: WENXUE_GATEWAY_BASE_URL,
			}),
		).toBeNull()
		expect(normalizeExtensionUserSession({ ...session, gatewayBaseUrl: 'https://attacker.example' }))
			.toBeNull()
	})

	it('saves and loads the session from chrome storage shape', async () => {
		const backing = new Map<string, unknown>()
		const storage: UserSessionStorageArea = {
			get: vi.fn(async (keys) => {
				const key = Array.isArray(keys) ? keys[0] : keys
				return { [key]: backing.get(key) }
			}),
			set: vi.fn(async (values) => {
				Object.entries(values).forEach(([key, value]) => backing.set(key, value))
			}),
			remove: vi.fn(async (key) => {
				backing.delete(key)
			}),
		}

		await saveExtensionUserSession(storage, session)

		expect(storage.set).toHaveBeenCalledWith({
			[WENXUE_USER_SESSION_KEY]: session,
		})
		await expect(
			loadExtensionUserSession(storage, {
				now: () => 1782630000000,
			}),
		).resolves.toEqual(session)
	})

	it('refreshes a session when it is expired or near expiry', async () => {
		const storage = createStorage({
			[WENXUE_USER_SESSION_KEY]: {
				...session,
				accessToken: 'old-access-token',
				expiresAt: 1000,
			},
		})
		const refresh = vi.fn(async () => ({
			...session,
			accessToken: 'new-access-token',
			refreshToken: 'new-refresh-token',
			expiresAt: 20_000,
		}))

		await expect(
			loadExtensionUserSession(storage, {
				now: () => 1000,
				refresh,
				refreshSkewMs: 60_000,
			}),
		).resolves.toEqual(
			expect.objectContaining({
				accessToken: 'new-access-token',
				refreshToken: 'new-refresh-token',
			}),
		)
		expect(refresh).toHaveBeenCalledOnce()
		expect(storage.set).toHaveBeenLastCalledWith({
			[WENXUE_USER_SESSION_KEY]: expect.objectContaining({ accessToken: 'new-access-token' }),
		})
	})

	it('keeps a valid token when proactive refresh fails but hides expired tokens', async () => {
		const validStorage = createStorage({
			[WENXUE_USER_SESSION_KEY]: {
				...session,
				expiresAt: 2000,
			},
		})
		const expiredStorage = createStorage({
			[WENXUE_USER_SESSION_KEY]: {
				...session,
				expiresAt: 999,
			},
		})
		const refresh = vi.fn(async () => {
			throw new Error('refresh failed')
		})

		await expect(
			loadExtensionUserSession(validStorage, {
				now: () => 1000,
				refresh,
				refreshSkewMs: 60_000,
			}),
		).resolves.toEqual(expect.objectContaining({ accessToken: 'access-token' }))
		await expect(
			loadExtensionUserSession(expiredStorage, {
				now: () => 1000,
				refresh,
				refreshSkewMs: 60_000,
			}),
		).resolves.toBeNull()
	})
})

function createStorage(initial: Record<string, unknown>): UserSessionStorageArea {
	return {
		get: vi.fn(async (keys) => {
			const names = Array.isArray(keys) ? keys : [keys]
			return Object.fromEntries(names.map((key) => [key, initial[key]]))
		}),
		set: vi.fn(async (values) => {
			Object.assign(initial, values)
		}),
		remove: vi.fn(async (key) => {
			delete initial[key]
		}),
	}
}
