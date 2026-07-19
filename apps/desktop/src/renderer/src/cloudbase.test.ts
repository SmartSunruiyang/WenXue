import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloudbaseMock = vi.hoisted(() => ({
	init: vi.fn(),
	signInWithPassword: vi.fn(),
	signOut: vi.fn(),
	getSession: vi.fn(),
	refreshSession: vi.fn(),
	fetch: vi.fn(),
	database: vi.fn(),
	collection: vi.fn(),
	where: vi.fn(),
	watch: vi.fn(),
}))

vi.mock('@cloudbase/js-sdk', () => ({
	default: {
		init: cloudbaseMock.init,
	},
}))

import {
	cloudbaseConfig,
	readCloudBaseErrorMessage,
	readLauncherAuthSession,
	refreshLauncherSession,
	registerLauncher,
	signInLauncher,
	validateLauncherCredentials,
	watchDesktopSignal,
} from './cloudbase'
import { strings } from './strings'

const VALID_PASSWORD = 'AuthTest9!'
const ACCESS_TOKEN = 'access-token-secret'

function mockSuccessfulSignIn(): void {
	cloudbaseMock.signInWithPassword.mockResolvedValue({
		data: {
			session: {
				access_token: ACCESS_TOKEN,
				refresh_token: 'refresh-token',
				expires_in: 3600,
				user: {
					id: 'user_123',
					user_metadata: {
						username: 'alice',
					},
				},
			},
		},
		error: null,
	})
}

describe('desktop CloudBase auth session parsing', () => {
	beforeEach(() => {
		cloudbaseMock.init.mockReturnValue({
			auth: () => ({
				signInWithPassword: cloudbaseMock.signInWithPassword,
				signOut: cloudbaseMock.signOut,
				getSession: cloudbaseMock.getSession,
				refreshSession: cloudbaseMock.refreshSession,
			}),
			database: cloudbaseMock.database,
		})
		cloudbaseMock.signInWithPassword.mockReset()
		cloudbaseMock.signOut.mockReset()
		cloudbaseMock.getSession.mockReset()
		cloudbaseMock.refreshSession.mockReset()
		cloudbaseMock.fetch.mockReset()
		cloudbaseMock.database.mockReset()
		cloudbaseMock.collection.mockReset()
		cloudbaseMock.where.mockReset()
		cloudbaseMock.watch.mockReset()
		cloudbaseMock.database.mockReturnValue({ collection: cloudbaseMock.collection })
		cloudbaseMock.collection.mockReturnValue({ where: cloudbaseMock.where })
		cloudbaseMock.where.mockReturnValue({ watch: cloudbaseMock.watch })
		cloudbaseMock.watch.mockReturnValue({ close: vi.fn() })
		cloudbaseMock.signOut.mockResolvedValue({ error: null })
		cloudbaseMock.getSession.mockResolvedValue({ data: null, error: null })
		vi.stubGlobal('fetch', cloudbaseMock.fetch)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it('initializes auth with the bundled publishable key when env override is absent', () => {
		expect(cloudbaseConfig.hasAccessKey).toBe(true)
	})

	it('watches only the selected public-safe desktop signal document', () => {
		const callbacks = { onChange: vi.fn(), onError: vi.fn() }

		const watcher = watchDesktopSignal('desktop_release_signal', 'electron:stable', callbacks)

		expect(cloudbaseMock.collection).toHaveBeenCalledWith('desktop_release_signal')
		expect(cloudbaseMock.where).toHaveBeenCalledWith({ _id: 'electron:stable' })
		expect(cloudbaseMock.watch).toHaveBeenCalledWith(callbacks)
		expect(watcher).toBe(cloudbaseMock.watch.mock.results[0]?.value)
	})

	it('validates username boundaries without trimming input into validity', () => {
		expect(validateLauncherCredentials('A1234', VALID_PASSWORD)).toBeNull()
		expect(validateLauncherCredentials(`A${'1'.repeat(23)}`, VALID_PASSWORD)).toBeNull()
		expect(validateLauncherCredentials('', VALID_PASSWORD)).toBe('usernameRequired')
		expect(validateLauncherCredentials('A123', VALID_PASSWORD)).toBe('usernameLength')
		expect(validateLauncherCredentials(`A${'1'.repeat(24)}`, VALID_PASSWORD)).toBe('usernameLength')
		expect(validateLauncherCredentials('1Abcd', VALID_PASSWORD)).toBe('usernameFormat')
		expect(validateLauncherCredentials('Abc_12', VALID_PASSWORD)).toBe('usernameFormat')
		expect(validateLauncherCredentials(' Abc12', VALID_PASSWORD)).toBe('usernameFormat')
	})

	it('validates the CloudBase password boundary and complexity rules', () => {
		expect(validateLauncherCredentials('Alice1', 'AuthTest1')).toBeNull()
		expect(validateLauncherCredentials('Alice1', 'AuthTest!')).toBeNull()
		expect(validateLauncherCredentials('Alice1', `Aa1!${'a'.repeat(28)}`)).toBeNull()
		expect(validateLauncherCredentials('Alice1', 'Aa1()!@#$%^&*|?><_-')).toBeNull()
		expect(validateLauncherCredentials('Alice1', '')).toBe('passwordRequired')
		expect(validateLauncherCredentials('Alice1', 'AuthTes1')).toBe('passwordLength')
		expect(validateLauncherCredentials('Alice1', 'A'.repeat(33))).toBe('passwordLength')
		expect(validateLauncherCredentials('Alice1', '!AuthTest9')).toBe('passwordFirstCharacter')
		expect(validateLauncherCredentials('Alice1', 'AuthTest9 ')).toBe('passwordCharacterSet')
		expect(validateLauncherCredentials('Alice1', 'Auth测Test9!')).toBe('passwordCharacterSet')
		expect(validateLauncherCredentials('Alice1', 'Auth😀Test9!')).toBe('passwordCharacterSet')
		expect(validateLauncherCredentials('Alice1', 'AuthTest9.')).toBe('passwordCharacterSet')
		expect(validateLauncherCredentials('Alice1', 'Authentication')).toBe('passwordComplexity')
	})

	it('clears the CloudBase SDK login timeout after a successful sign in', async () => {
		vi.useFakeTimers()
		cloudbaseMock.signInWithPassword.mockResolvedValue({
			data: {
				session: {
					access_token: 'access-token',
					refresh_token: 'refresh-token',
					expires_in: 3600,
					user: { id: 'user_123', username: 'Alice1' },
				},
			},
			error: null,
		})

		await expect(signInLauncher('Alice1', VALID_PASSWORD)).resolves.toEqual(
			expect.objectContaining({ userId: 'user_123', username: 'Alice1' }),
		)
		expect(vi.getTimerCount()).toBe(0)
	})

	it('times out when the CloudBase SDK login promise never settles', async () => {
		vi.useFakeTimers()
		cloudbaseMock.signInWithPassword.mockReturnValue(new Promise(() => undefined))

		const login = signInLauncher('Alice1', VALID_PASSWORD)
		const expectation = expect(login).rejects.toThrow(strings.auth.error.timeout)
		await vi.advanceTimersByTimeAsync(12_000)
		await expectation

		expect(vi.getTimerCount()).toBe(0)
	})

	it('refreshes an expired launcher session through the CloudBase SDK', async () => {
		cloudbaseMock.refreshSession.mockResolvedValue({
			data: {
				session: {
					access_token: 'fresh-access-token',
					refresh_token: 'fresh-refresh-token',
					expires_in: 3600,
					user: { id: 'user_123', username: 'Alice1' },
				},
			},
			error: null,
		})

		await expect(refreshLauncherSession('old-refresh-token')).resolves.toMatchObject({
			userId: 'user_123',
			accessToken: 'fresh-access-token',
			refreshToken: 'fresh-refresh-token',
		})
		expect(cloudbaseMock.refreshSession).toHaveBeenCalledWith('old-refresh-token')
	})

	it('rejects invalid credentials before calling the SDK or registration gateway', async () => {
		await expect(signInLauncher('1Alice', VALID_PASSWORD)).rejects.toThrow(
			strings.auth.validation.usernameFormat,
		)
		await expect(registerLauncher('Alice1', 'AuthTes1')).rejects.toThrow(
			strings.auth.validation.passwordLength,
		)

		expect(cloudbaseMock.signInWithPassword).not.toHaveBeenCalled()
		expect(cloudbaseMock.fetch).not.toHaveBeenCalled()
	})

	it('registers, signs in, then activates with the access token without logging it', async () => {
		vi.useFakeTimers()
		const callSequence: string[] = []
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		cloudbaseMock.fetch
			.mockImplementationOnce(async () => {
				callSequence.push('register')
				return Response.json({ ok: true }, { status: 201 })
			})
			.mockImplementationOnce(async () => {
				callSequence.push('activate')
				return new Response(null, { status: 204 })
			})
		cloudbaseMock.signInWithPassword.mockImplementation(async () => {
			callSequence.push('signIn')
			return {
				data: {
					session: {
						access_token: ACCESS_TOKEN,
						refresh_token: 'refresh-token',
						expires_in: 3600,
						user: {
							id: 'user_123',
							user_metadata: { username: 'alice' },
						},
					},
				},
				error: null,
			}
		})

		await expect(registerLauncher('Alice1', VALID_PASSWORD)).resolves.toEqual(
			expect.objectContaining({
				userId: 'user_123',
				username: 'alice',
				accessToken: ACCESS_TOKEN,
			}),
		)

		expect(callSequence).toEqual(['register', 'signIn', 'activate'])
		expect(cloudbaseMock.fetch).toHaveBeenNthCalledWith(
			1,
			'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com/v1/auth/register',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					username: 'Alice1',
					password: VALID_PASSWORD,
				}),
				signal: expect.any(AbortSignal),
			}),
		)
		expect(cloudbaseMock.signInWithPassword).toHaveBeenCalledWith({
			username: 'Alice1',
			password: VALID_PASSWORD,
		})
		expect(cloudbaseMock.fetch).toHaveBeenNthCalledWith(
			2,
			'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com/v1/auth/activate',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${ACCESS_TOKEN}`,
				},
				body: JSON.stringify({}),
				signal: expect.any(AbortSignal),
			}),
		)
		const activationBody = cloudbaseMock.fetch.mock.calls[1]?.[1]?.body
		expect(activationBody).not.toContain(ACCESS_TOKEN)
		expect(consoleError).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('normalizes a username/password session into the main-process handoff shape', () => {
		const session = readLauncherAuthSession(
			{
				session: {
					access_token: 'access-token',
					refresh_token: 'refresh-token',
					expires_in: 3600,
					user: {
						id: 'user_123',
						user_metadata: {
							username: 'alice',
						},
					},
				},
			},
			{
				now: () => 1000,
				gatewayBaseUrl: 'https://gateway.example',
			},
		)

		expect(session).toEqual({
			userId: 'user_123',
			username: 'alice',
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: 3601000,
			gatewayBaseUrl: 'https://gateway.example',
		})
	})

	it('returns null when CloudBase does not provide a real session', () => {
		expect(readLauncherAuthSession({ session: undefined })).toBeNull()
		expect(readLauncherAuthSession({ session: { access_token: 'token' } })).toBeNull()
	})

	it('recovers an existing username with the correct password and activates it', async () => {
		cloudbaseMock.fetch
			.mockResolvedValueOnce(Response.json({ error: { code: 'USERNAME_EXISTS' } }, { status: 409 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
		mockSuccessfulSignIn()

		await expect(registerLauncher('Alice1', VALID_PASSWORD)).resolves.toEqual(
			expect.objectContaining({ userId: 'user_123', accessToken: ACCESS_TOKEN }),
		)
		expect(cloudbaseMock.signInWithPassword).toHaveBeenCalledOnce()
		expect(cloudbaseMock.fetch).toHaveBeenCalledTimes(2)
	})

	it('returns a safe message when an existing username cannot sign in', async () => {
		cloudbaseMock.fetch.mockResolvedValue(
			Response.json({ error: { code: 'USERNAME_EXISTS' } }, { status: 409 }),
		)
		cloudbaseMock.signInWithPassword.mockResolvedValue({
			data: null,
			error: { message: 'Invalid username or password' },
		})

		await expect(registerLauncher('Alice1', VALID_PASSWORD)).rejects.toThrow(
			strings.auth.error.usernameExists,
		)
		expect(cloudbaseMock.fetch).toHaveBeenCalledOnce()
	})

	it('preserves an actionable network error while recovering an existing username', async () => {
		cloudbaseMock.fetch.mockResolvedValue(
			Response.json({ error: { code: 'USERNAME_EXISTS' } }, { status: 409 }),
		)
		cloudbaseMock.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'))

		await expect(registerLauncher('Alice1', VALID_PASSWORD)).rejects.toThrow(
			strings.auth.error.network,
		)
		expect(cloudbaseMock.signOut).not.toHaveBeenCalled()
	})

	it('preserves an actionable timeout while recovering an existing username', async () => {
		vi.useFakeTimers()
		cloudbaseMock.fetch.mockResolvedValue(
			Response.json({ error: { code: 'USERNAME_EXISTS' } }, { status: 409 }),
		)
		cloudbaseMock.signInWithPassword.mockReturnValue(new Promise(() => undefined))

		const registration = registerLauncher('Alice1', VALID_PASSWORD)
		const expectation = expect(registration).rejects.toThrow(strings.auth.error.timeout)
		await vi.advanceTimersByTimeAsync(12_000)
		await expectation

		expect(cloudbaseMock.signOut).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('preserves the SDK login error after a newly created registration', async () => {
		cloudbaseMock.fetch.mockResolvedValue(Response.json({ ok: true }, { status: 201 }))
		cloudbaseMock.signInWithPassword.mockResolvedValue({
			data: null,
			error: { message: 'CloudBase login unavailable' },
		})

		await expect(registerLauncher('Alice1', VALID_PASSWORD)).rejects.toThrow(
			'CloudBase login unavailable',
		)
		expect(cloudbaseMock.fetch).toHaveBeenCalledOnce()
	})

	it('aborts a registration request after twelve seconds with a specific message', async () => {
		vi.useFakeTimers()
		cloudbaseMock.fetch.mockImplementation(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('The operation was aborted', 'AbortError')),
						{ once: true },
					)
				}),
		)

		const registration = registerLauncher('Alice1', VALID_PASSWORD)
		const expectation = expect(registration).rejects.toThrow(strings.auth.error.timeout)
		await vi.advanceTimersByTimeAsync(12_000)
		await expectation

		expect(cloudbaseMock.signInWithPassword).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('normalizes raw registration network failures into actionable Chinese', async () => {
		cloudbaseMock.fetch.mockRejectedValue(new TypeError('Failed to fetch'))

		await expect(registerLauncher('Alice1', VALID_PASSWORD)).rejects.toThrow(
			strings.auth.error.network,
		)
		expect(cloudbaseMock.signInWithPassword).not.toHaveBeenCalled()
	})

	it('normalizes activation network failures after a successful SDK login', async () => {
		cloudbaseMock.fetch
			.mockResolvedValueOnce(Response.json({ ok: true }, { status: 201 }))
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
		mockSuccessfulSignIn()

		await expect(registerLauncher('Alice1', VALID_PASSWORD)).rejects.toThrow(
			strings.auth.error.network,
		)
		expect(cloudbaseMock.fetch).toHaveBeenCalledTimes(2)
		expect(cloudbaseMock.signOut).toHaveBeenCalledOnce()
	})

	it('aborts activation after twelve seconds', async () => {
		vi.useFakeTimers()
		cloudbaseMock.fetch
			.mockResolvedValueOnce(Response.json({ ok: true }, { status: 201 }))
			.mockImplementationOnce(
				(_input: RequestInfo | URL, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener(
							'abort',
							() => reject(new DOMException('The operation was aborted', 'AbortError')),
							{ once: true },
						)
					}),
			)
		mockSuccessfulSignIn()

		const registration = registerLauncher('Alice1', VALID_PASSWORD)
		const expectation = expect(registration).rejects.toThrow(strings.auth.error.timeout)
		await vi.advanceTimersByTimeAsync(12_000)
		await expectation

		expect(cloudbaseMock.fetch).toHaveBeenCalledTimes(2)
		expect(cloudbaseMock.signOut).toHaveBeenCalledOnce()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('parses activation errors while redacting the bearer token', async () => {
		cloudbaseMock.fetch
			.mockResolvedValueOnce(Response.json({ ok: true }, { status: 201 }))
			.mockResolvedValueOnce(
				Response.json({ error: { message: `账号激活失败：${ACCESS_TOKEN}` } }, { status: 503 }),
			)
		mockSuccessfulSignIn()

		let message = ''
		try {
			await registerLauncher('Alice1', VALID_PASSWORD)
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		}

		expect(message).toContain('账号激活失败')
		expect(message).toContain('[REDACTED]')
		expect(message).not.toContain(ACCESS_TOKEN)
		expect(cloudbaseMock.signOut).toHaveBeenCalledOnce()
	})

	it('preserves the activation error when best-effort sign out also fails', async () => {
		cloudbaseMock.fetch
			.mockResolvedValueOnce(Response.json({ ok: true }, { status: 201 }))
			.mockResolvedValueOnce(
				Response.json({ error: { message: '账号激活暂时不可用' } }, { status: 503 }),
			)
		mockSuccessfulSignIn()
		cloudbaseMock.signOut.mockRejectedValue(new Error('sign out failed'))

		await expect(registerLauncher('Alice1', VALID_PASSWORD)).rejects.toThrow('账号激活暂时不可用')
		expect(cloudbaseMock.signOut).toHaveBeenCalledOnce()
	})

	it('reads CloudBase JSON error messages', () => {
		expect(
			readCloudBaseErrorMessage(
				new Error('{"code":"INVALID_PARAMS","msg":"用户名格式不正确"}'),
				'账号操作失败',
			),
		).toBe('用户名格式不正确')
	})

	it('reads nested backend error messages', () => {
		expect(
			readCloudBaseErrorMessage(
				{
					error: {
						message: '注册服务未配置',
					},
				},
				'账号操作失败',
			),
		).toBe('注册服务未配置')
	})
})
