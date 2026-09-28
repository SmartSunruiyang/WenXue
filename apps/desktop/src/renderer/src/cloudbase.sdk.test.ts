import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface AuthResult {
	data: {
		session: { user: { id: string; user_metadata: { name: string; picture: string } } } | null
	}
	error?: unknown
}

interface SdkAuth {
	setSession(input: { access_token: string; refresh_token: string }): Promise<AuthResult>
	getSession(): Promise<AuthResult>
	refreshUser(): Promise<AuthResult>
	updateUserBasicInfo(input: { name: string; picture: string }): Promise<void>
}

interface RequestOptions {
	method?: string
	body?: Record<string, unknown>
}

let service: typeof import('./cloudbase')
let auth: SdkAuth
let remoteProfile: { sub: string; email: string; name: string; picture: string }
let profileReadError: Error | null
let requests: { path: string; method?: string; body?: Record<string, unknown> }[]
let environmentIndex = 0

beforeEach(async () => {
	vi.resetModules()
	const values = new Map<string, string>()
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		clear: () => values.clear(),
	}
	vi.stubGlobal('localStorage', storage)
	vi.stubGlobal('window', {
		localStorage: storage,
		sessionStorage: storage,
		addEventListener: vi.fn(),
		location: { href: 'https://profile.test/', search: '', hash: '' },
	})
	vi.stubGlobal('document', {})
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.reject(new Error('Unexpected network request'))),
	)
	const { default: cloudbase } = await import('@cloudbase/js-sdk')
	remoteProfile = {
		sub: 'profile-user',
		email: 'profile@example.test',
		name: '原昵称',
		picture: 'https://profile.test/original.png',
	}
	profileReadError = null
	requests = []
	const request = async (url: string, options: RequestOptions = {}) => {
		const path = new URL(url).pathname
		requests.push({ path, method: options.method, body: options.body })
		if (path === '/auth/v1/token') {
			return {
				access_token: 'synthetic-access-token',
				refresh_token: 'synthetic-refresh-token',
				expires_in: 3600,
				token_type: 'Bearer',
				scope: 'openid',
			}
		}
		if (path === '/auth/v1/user/basic/edit') {
			remoteProfile = { ...remoteProfile, ...options.body }
			return {}
		}
		if (path === '/auth/v1/user/me') {
			if (profileReadError) throw profileReadError
			return { ...remoteProfile }
		}
		throw new Error(`Unexpected SDK request: ${path}`)
	}
	const app = cloudbase.init({
		env: `profile-sdk-test-${++environmentIndex}`,
		auth: { detectSessionInUrl: false },
	})
	const createAuth = app.auth
	const createInterceptedAuth = (options: Record<string, unknown> = {}) =>
		Reflect.apply(createAuth, app, [{ ...options, request, baseRequest: request }])
	auth = createInterceptedAuth({ persistence: 'local' }) as unknown as SdkAuth
	expect(
		(
			await auth.setSession({
				access_token: 'synthetic-access-token',
				refresh_token: 'synthetic-refresh-token',
			})
		).error,
	).toBeNull()
	expect((await auth.refreshUser()).error).toBeNull()
	vi.spyOn(app, 'auth').mockImplementation(createInterceptedAuth)
	vi.spyOn(cloudbase, 'init').mockReturnValue(app)
	service = await import('./cloudbase')
	requests.length = 0
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('installed CloudBase SDK account profile contract', () => {
	it('writes name and permanent picture, then updates the SDK session from the user endpoint', async () => {
		const update = {
			name: '新昵称',
			picture: 'cloud://profile-test.bucket/avatars/profile-user/new.png',
		}
		await auth.updateUserBasicInfo(update)
		expect(requests).toEqual([
			{ path: '/auth/v1/user/basic/edit', method: 'POST', body: update },
			{ path: '/auth/v1/user/me', method: 'GET', body: undefined },
		])
		expect((await auth.getSession()).data.session?.user).toMatchObject({
			id: 'profile-user',
			user_metadata: update,
		})
	})

	it('restores remotely changed nickname and avatar instead of the SDK cached profile', async () => {
		remoteProfile = {
			...remoteProfile,
			name: '另一设备更新的昵称',
			picture: 'https://profile.test/remote.png',
		}
		expect((await auth.getSession()).data.session?.user.user_metadata.name).toBe('原昵称')
		expect(requests).toEqual([])

		await expect(service.getLauncherSession()).resolves.toMatchObject({
			userId: 'profile-user',
			nickname: remoteProfile.name,
			avatarUrl: remoteProfile.picture,
		})
		expect(requests.some(({ path }) => path === '/auth/v1/user/me')).toBe(true)
		expect(fetch).not.toHaveBeenCalled()
	})

	it('reports failed profile refresh even when the SDK still has a cached session', async () => {
		profileReadError = new Error('Failed to fetch')
		expect((await auth.getSession()).data.session?.user.id).toBe('profile-user')
		expect((await auth.refreshUser()).error).toBeTruthy()
		await expect(service.getLauncherSession()).rejects.toThrow()
		expect(fetch).not.toHaveBeenCalled()
	})
})
