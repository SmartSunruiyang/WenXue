import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from './strings'

const sdk = vi.hoisted(() => ({
	auth: vi.fn(),
	signInWithOtp: vi.fn(),
	signUp: vi.fn(),
	updateUser: vi.fn(),
	reauthenticate: vi.fn(),
	getUser: vi.fn(),
	getSession: vi.fn(),
	refreshUser: vi.fn(),
	verifyOtp: vi.fn(),
	signOut: vi.fn(),
	signInWithPassword: vi.fn(),
}))

vi.mock('@cloudbase/js-sdk', () => ({
	default: { init: () => ({ auth: sdk.auth }) },
}))

function session(userId = 'account-a') {
	return {
		session: {
			user: { id: userId, phone: '+86 13800138000' },
			access_token: 'access-token-secret',
			refresh_token: 'refresh-token-secret',
			expires_in: 3600,
		},
	}
}

function registeredUser() {
	return {
		id: 'account-a',
		phone: '+86 13800138000',
		username: 'Alice1',
		user_metadata: { hasPassword: true },
	}
}

function mockGatewayActivation() {
	const fetcher = vi.fn().mockResolvedValue(
		new Response(JSON.stringify({ ok: true, userId: 'account-a' }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}),
	)
	vi.stubGlobal('fetch', fetcher)
	return fetcher
}

describe('launcher phone authentication', () => {
	beforeEach(() => {
		vi.resetModules()
		vi.resetAllMocks()
		sdk.auth.mockReturnValue(sdk)
		sdk.signInWithOtp.mockResolvedValue({ data: { verifyOtp: sdk.verifyOtp }, error: null })
		sdk.signUp.mockResolvedValue({ data: { verifyOtp: sdk.verifyOtp }, error: null })
		sdk.reauthenticate.mockResolvedValue({ data: { updateUser: sdk.verifyOtp }, error: null })
		sdk.updateUser.mockResolvedValue({ data: { verifyOtp: sdk.verifyOtp }, error: null })
		sdk.getUser.mockResolvedValue({ data: { user: { id: 'account-a', phone: '' } }, error: null })
		sdk.getSession.mockResolvedValue({ data: session(), error: null })
		sdk.verifyOtp.mockResolvedValue({ data: session(), error: null })
		sdk.refreshUser.mockResolvedValue({
			data: { ...session(), user: session().session.user },
			error: null,
		})
		sdk.signOut.mockResolvedValue({ error: null })
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it('normalizes mainland numbers and rejects invalid input before sending', async () => {
		const { normalizeLauncherPhone, sendLauncherPhoneCode } = await import('./cloudbase')
		expect(normalizeLauncherPhone('+86 13800138000')).toBe('13800138000')
		for (const phone of ['', '123', '12800138000', '138001380001', '+1 13800138000']) {
			await expect(sendLauncherPhoneCode(phone, { kind: 'login' })).rejects.toThrow(
				strings.auth.phone.invalidNumber,
			)
		}
		expect(sdk.signInWithOtp).not.toHaveBeenCalled()
	})

	it('uses CloudBase OTP and returns a reusable launcher session with a masked label', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.getUser.mockResolvedValueOnce({ data: { user: registeredUser() } })
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		expect(sdk.signInWithOtp).toHaveBeenCalledWith({
			phone: '13800138000',
			options: { shouldCreateUser: false },
		})
		const result = await challenge.verify('123456')
		expect(sdk.verifyOtp).toHaveBeenCalledWith({ token: '123456' })
		expect(result).toMatchObject({ userId: 'account-a', username: 'Alice1' })
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.needCode)
	})

	it('keeps the send cooldown across cancelled forms and changed numbers', async () => {
		vi.useFakeTimers()
		const { sendLauncherPhoneCode, getLauncherPhoneResendAt } = await import('./cloudbase')
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		expect(getLauncherPhoneResendAt()).toBe(Date.now() + 60_000)
		challenge.cancel()
		await expect(sendLauncherPhoneCode('13900139000', { kind: 'login' })).rejects.toThrow(
			strings.auth.phone.rateLimit,
		)
		await vi.advanceTimersByTimeAsync(60_000)
		await sendLauncherPhoneCode('13900139000', { kind: 'login' })
		expect(sdk.signInWithOtp).toHaveBeenCalledTimes(2)
	})

	it('requires six digits and expires abandoned challenges without verifying them', async () => {
		vi.useFakeTimers()
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		for (const code of ['', '12345', 'abcdef', '1234567']) {
			await expect(challenge.verify(code)).rejects.toThrow(strings.auth.phone.invalidCode)
		}
		await vi.advanceTimersByTimeAsync(600_000)
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.expired)
		expect(sdk.verifyOtp).not.toHaveBeenCalled()
	})

	it('invalidates an old challenge when a new code is requested', async () => {
		vi.useFakeTimers()
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		const old = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		await vi.advanceTimersByTimeAsync(60_000)
		await sendLauncherPhoneCode('13900139000', { kind: 'login' })
		await expect(old.verify('123456')).rejects.toThrow(strings.auth.phone.needCode)
		expect(sdk.verifyOtp).not.toHaveBeenCalled()
	})

	it('allows correcting a rejected code without starting a new challenge', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.getUser.mockResolvedValueOnce({ data: { user: registeredUser() } })
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		sdk.verifyOtp.mockResolvedValueOnce({
			error: { code: 'invalid_argument', message: 'sensitive' },
		})
		await expect(challenge.verify('000000')).rejects.toThrow(strings.auth.phone.verifyError)
		await expect(challenge.verify('123456')).resolves.toMatchObject({ userId: 'account-a' })
	})

	it('binds only the current account, refreshes its profile and keeps its uid', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'bind',
			userId: 'account-a',
		})
		expect(sdk.updateUser).toHaveBeenCalledWith({ phone: '13800138000' })
		sdk.verifyOtp.mockResolvedValueOnce({ data: { user: { id: 'account-a' } }, error: null })
		await expect(challenge.verify('123456')).resolves.toMatchObject({ userId: 'account-a' })
		expect(sdk.verifyOtp).toHaveBeenCalledWith({ phone: '13800138000', token: '123456' })
		expect(sdk.refreshUser).toHaveBeenCalledOnce()
		expect(sdk.signInWithOtp).not.toHaveBeenCalled()
	})

	it('rejects an existing phone binding without sending a replacement code', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.getUser.mockResolvedValueOnce({ data: { user: { id: 'account-a', phone: '13900139000' } } })
		await expect(
			sendLauncherPhoneCode('13800138000', { kind: 'bind', userId: 'account-a' }),
		).rejects.toThrow(strings.auth.phone.alreadyBound)
		expect(sdk.updateUser).not.toHaveBeenCalled()
	})

	it('does not bind a phone already owned by another account', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.updateUser.mockResolvedValueOnce({ error: { code: 'phone_already_exists' } })
		await expect(
			sendLauncherPhoneCode('13800138000', { kind: 'bind', userId: 'account-a' }),
		).rejects.toThrow(strings.auth.phone.alreadyOwned)
		expect(sdk.getSession).not.toHaveBeenCalled()
	})

	it('refuses a stale account before sending or verifying a binding code', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		await expect(
			sendLauncherPhoneCode('13800138000', { kind: 'bind', userId: 'account-b' }),
		).rejects.toThrow(strings.auth.phone.sessionChanged)
		expect(sdk.updateUser).not.toHaveBeenCalled()
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'bind',
			userId: 'account-a',
		})
		sdk.getSession.mockResolvedValueOnce({ data: session('account-b') })
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.sessionChanged)
		expect(sdk.verifyOtp).not.toHaveBeenCalled()
	})

	it('refuses to return a different account after a successful binding', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'bind',
			userId: 'account-a',
		})
		sdk.getSession
			.mockResolvedValueOnce({ data: session() })
			.mockResolvedValueOnce({ data: session('account-b') })
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.sessionChanged)
	})

	it('blocks parallel sends and verifications', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.getUser.mockResolvedValueOnce({ data: { user: registeredUser() } })
		let completeSend!: (value: unknown) => void
		sdk.signInWithOtp.mockReturnValueOnce(
			new Promise((resolve) => {
				completeSend = resolve
			}),
		)
		const sending = sendLauncherPhoneCode('13800138000', { kind: 'login' })
		await expect(sendLauncherPhoneCode('13800138000', { kind: 'login' })).rejects.toThrow(
			strings.auth.phone.pending,
		)
		completeSend({ data: { verifyOtp: sdk.verifyOtp } })
		const challenge = await sending
		let completeVerify!: (value: unknown) => void
		sdk.verifyOtp.mockReturnValueOnce(
			new Promise((resolve) => {
				completeVerify = resolve
			}),
		)
		const verifying = challenge.verify('123456')
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.pending)
		completeVerify({ data: session() })
		await verifying
	})

	it('routes a number without an account to registration without creating a user', async () => {
		const { sendLauncherPhoneCode, LauncherRegistrationRequiredError } = await import('./cloudbase')
		sdk.signInWithOtp.mockResolvedValueOnce({ error: { code: 'not_found' } })
		await expect(sendLauncherPhoneCode('13800138000', { kind: 'login' })).rejects.toBeInstanceOf(
			LauncherRegistrationRequiredError,
		)
		expect(sdk.signInWithOtp).toHaveBeenCalledWith({
			phone: '13800138000',
			options: { shouldCreateUser: false },
		})
		expect(sdk.signUp).not.toHaveBeenCalled()
		expect(sdk.getSession).not.toHaveBeenCalled()
	})

	it('routes a newly recognized number to registration after OTP verification', async () => {
		const { sendLauncherPhoneCode, LauncherRegistrationRequiredError } = await import('./cloudbase')
		sdk.verifyOtp.mockResolvedValueOnce({ error: { code: 'not_found' } })
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		await expect(challenge.verify('123456')).rejects.toBeInstanceOf(
			LauncherRegistrationRequiredError,
		)
		expect(sdk.signUp).not.toHaveBeenCalled()
	})

	it('does not pass a phone-only account to the desktop session', async () => {
		const { sendLauncherPhoneCode, LauncherRegistrationRequiredError } = await import('./cloudbase')
		sdk.getUser.mockResolvedValueOnce({
			data: {
				user: { id: 'account-a', phone: '+86 13800138000', user_metadata: { hasPassword: false } },
			},
		})
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		await expect(challenge.verify('123456')).rejects.toMatchObject({
			phone: '13800138000',
			existingAccount: true,
			userId: 'account-a',
		})
		expect(LauncherRegistrationRequiredError).toBeTypeOf('function')
		expect(sdk.signOut).not.toHaveBeenCalled()
	})

	it('refuses a phone OTP session whose profile belongs to another number', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.getUser.mockResolvedValueOnce({
			data: { user: { ...registeredUser(), phone: '+86 13900139000' } },
		})
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.sessionChanged)
	})

	it('registers only after username, password and a verified unused phone', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		const fetcher = mockGatewayActivation()
		sdk.verifyOtp.mockResolvedValueOnce({
			data: {
				...session(),
				user: { ...registeredUser(), created_at: new Date().toISOString() },
			},
		})
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'register',
			username: 'Alice1',
			password: 'AuthTest9!',
		})
		expect(sdk.signUp).toHaveBeenCalledWith({
			phone: '13800138000',
			username: 'Alice1',
			password: 'AuthTest9!',
		})
		expect(fetcher).not.toHaveBeenCalled()
		await expect(challenge.verify('123456')).resolves.toMatchObject({ userId: 'account-a' })
		expect(fetcher).toHaveBeenCalledOnce()
	})

	it('does not hand off a newly registered session if the gateway refuses activation', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(new Response(JSON.stringify({ error: 'inactive' }), { status: 403 })),
		)
		sdk.verifyOtp.mockResolvedValueOnce({
			data: { ...session(), user: { ...registeredUser(), created_at: new Date().toISOString() } },
		})
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'register',
			username: 'Alice1',
			password: 'AuthTest9!',
		})
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.activationError)
	})

	it('refuses smart signup when verification logs into a previously registered phone', async () => {
		const { sendLauncherPhoneCode, LauncherPhoneAlreadyRegisteredError } =
			await import('./cloudbase')
		const fetcher = mockGatewayActivation()
		sdk.verifyOtp.mockResolvedValueOnce({
			data: {
				...session(),
				user: { ...registeredUser(), created_at: '2025-01-01T00:00:00.000Z' },
			},
		})
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'register',
			username: 'Alice1',
			password: 'AuthTest9!',
		})
		await expect(challenge.verify('123456')).rejects.toBeInstanceOf(
			LauncherPhoneAlreadyRegisteredError,
		)
		expect(sdk.signOut).toHaveBeenCalledOnce()
		expect(fetcher).not.toHaveBeenCalled()
	})

	it('does not offer an unsafe login handoff if conflict session cleanup fails', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.verifyOtp.mockResolvedValueOnce({
			data: {
				...session(),
				user: { ...registeredUser(), created_at: '2025-01-01T00:00:00.000Z' },
			},
		})
		sdk.signOut.mockResolvedValueOnce({ error: { code: 'unavailable' } })
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'register',
			username: 'Alice1',
			password: 'AuthTest9!',
		})
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.outcomeUnknown)
		await expect(sendLauncherPhoneCode('13800138000', { kind: 'login' })).rejects.toThrow(
			strings.auth.phone.outcomeUnknown,
		)
	})

	it('reports an already bound phone during signup without replacing it', async () => {
		const { sendLauncherPhoneCode, LauncherPhoneAlreadyRegisteredError } =
			await import('./cloudbase')
		sdk.signUp.mockResolvedValueOnce({ error: { code: 'phone_already_exists' } })
		await expect(
			sendLauncherPhoneCode('13800138000', {
				kind: 'register',
				username: 'Alice1',
				password: 'AuthTest9!',
			}),
		).rejects.toBeInstanceOf(LauncherPhoneAlreadyRegisteredError)
		expect(sdk.updateUser).not.toHaveBeenCalled()
	})

	it('completes an older OTP-only account on its own uid after a second SMS proof', async () => {
		const { sendLauncherPhoneCode, getLauncherIncompleteRegistration } = await import('./cloudbase')
		const fetcher = mockGatewayActivation()
		sdk.getUser.mockResolvedValue({
			data: {
				user: { id: 'account-a', phone: '+86 13800138000', user_metadata: { hasPassword: false } },
			},
		})
		await expect(getLauncherIncompleteRegistration()).resolves.toEqual({
			phone: '13800138000',
			userId: 'account-a',
		})
		sdk.verifyOtp.mockResolvedValueOnce({ data: session() })
		sdk.updateUser.mockResolvedValueOnce({ data: { user: { ...registeredUser() } } })
		sdk.refreshUser.mockResolvedValueOnce({ data: { user: registeredUser() } })
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'complete',
			userId: 'account-a',
			username: 'Alice1',
			password: 'AuthTest9!',
		})
		expect(sdk.reauthenticate).toHaveBeenCalledOnce()
		await expect(challenge.verify('123456')).resolves.toMatchObject({ userId: 'account-a' })
		expect(sdk.verifyOtp).toHaveBeenCalledWith({ nonce: '123456', password: 'AuthTest9!' })
		expect(sdk.updateUser).toHaveBeenCalledWith({ username: 'Alice1' })
		expect(fetcher).toHaveBeenCalledOnce()
	})

	it('does not overwrite a different signed-in user while completing registration', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.getUser.mockResolvedValueOnce({
			data: { user: { id: 'account-a', phone: '+86 13800138000' } },
		})
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'complete',
			userId: 'account-a',
			username: 'Alice1',
			password: 'AuthTest9!',
		})
		sdk.getSession.mockResolvedValueOnce({ data: session('account-b') })
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.sessionChanged)
		expect(sdk.verifyOtp).not.toHaveBeenCalled()
		expect(sdk.updateUser).not.toHaveBeenCalled()
	})

	it('returns bounded errors without propagating upstream secrets', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		sdk.signInWithOtp.mockResolvedValueOnce({
			error: { message: 'access-token-secret 13800138000' },
		})
		await expect(sendLauncherPhoneCode('13800138000', { kind: 'login' })).rejects.toThrow(
			strings.auth.phone.sendError,
		)
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		sdk.verifyOtp.mockResolvedValueOnce({ data: { session: { access_token: 'partial-secret' } } })
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.error.loginSession)
	})

	it('does not bind when the challenge is cancelled during an asynchronous account check', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'bind',
			userId: 'account-a',
		})
		let finishCheck!: (value: unknown) => void
		sdk.getSession.mockReturnValueOnce(
			new Promise((resolve) => {
				finishCheck = resolve
			}),
		)
		const verification = challenge.verify('123456')
		await vi.waitFor(() => expect(finishCheck).toBeTypeOf('function'))
		challenge.cancel()
		finishCheck({ data: session() })
		await expect(verification).rejects.toThrow(strings.auth.phone.needCode)
		expect(sdk.verifyOtp).not.toHaveBeenCalled()
	})

	it('holds the SDK mutation lock after UI timeout and clears a late login session', async () => {
		vi.useFakeTimers()
		const { sendLauncherPhoneCode, signInLauncher } = await import('./cloudbase')
		const challenge = await sendLauncherPhoneCode('13800138000', { kind: 'login' })
		let finishVerification!: (value: unknown) => void
		sdk.verifyOtp.mockReturnValueOnce(
			new Promise((resolve) => {
				finishVerification = resolve
			}),
		)
		const verification = expect(challenge.verify('123456')).rejects.toThrow(
			strings.auth.error.timeout,
		)
		await vi.advanceTimersByTimeAsync(12_000)
		await verification
		await expect(signInLauncher('Alice1', 'AuthTest9!')).rejects.toThrow(strings.auth.phone.pending)
		finishVerification({ data: session() })
		await vi.advanceTimersByTimeAsync(0)
		expect(sdk.signOut).toHaveBeenCalledOnce()
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.needCode)
		sdk.signInWithPassword.mockResolvedValueOnce({ data: session() })
		await expect(signInLauncher('Alice1', 'AuthTest9!')).resolves.toMatchObject({
			userId: 'account-a',
		})
	})

	it('does not announce binding success when the refreshed phone was not updated', async () => {
		const { sendLauncherPhoneCode } = await import('./cloudbase')
		const challenge = await sendLauncherPhoneCode('13800138000', {
			kind: 'bind',
			userId: 'account-a',
		})
		sdk.refreshUser.mockResolvedValueOnce({ data: { user: { id: 'account-a', phone: '' } } })
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.phone.refreshError)
	})

	it.each(['getUser', 'refreshUser'] as const)(
		'keeps other auth operations locked until a timed-out %s settles',
		async (method) => {
			vi.useFakeTimers()
			const { sendLauncherPhoneCode, signOutLauncher, signInLauncher } = await import('./cloudbase')
			let finishProfile!: (value: unknown) => void
			sdk[method].mockReturnValueOnce(
				new Promise((resolve) => {
					finishProfile = resolve
				}),
			)
			const sending = sendLauncherPhoneCode('13800138000', {
				kind: 'bind',
				userId: 'account-a',
			})
			const result = method === 'getUser' ? sending : (await sending).verify('123456')
			const rejection = expect(result).rejects.toThrow(
				method === 'getUser' ? strings.auth.error.timeout : strings.auth.phone.bindingUnknown,
			)
			await vi.advanceTimersByTimeAsync(12_000)
			await rejection
			await expect(signOutLauncher()).rejects.toThrow(strings.auth.phone.pending)
			await expect(signInLauncher('Alice1', 'AuthTest9!')).rejects.toThrow(
				strings.auth.phone.pending,
			)
			finishProfile({ data: { user: session().session.user } })
			await vi.advanceTimersByTimeAsync(0)
			await expect(signOutLauncher()).resolves.toBeUndefined()
			expect(sdk.signOut).toHaveBeenCalledOnce()
		},
	)

	it('rejects a captcha that arrives after the enclosing request has timed out', async () => {
		vi.useFakeTimers()
		const { sendLauncherPhoneCode, signOutLauncher } = await import('./cloudbase')
		const { getLauncherCaptchaSnapshot } = await import('./captchaChallenge')
		let finishSend!: (value: unknown) => void
		sdk.signInWithOtp.mockReturnValueOnce(
			new Promise((resolve) => {
				finishSend = resolve
			}),
		)
		const sending = expect(sendLauncherPhoneCode('13800138000', { kind: 'login' })).rejects.toThrow(
			strings.auth.error.timeout,
		)
		await vi.advanceTimersByTimeAsync(12_000)
		await sending
		const options = sdk.auth.mock.calls[0][0] as {
			captchaOptions: { openURIWithCallback: (url: string) => Promise<string> }
		}
		await expect(
			options.captchaOptions.openURIWithCallback('data:image/png;base64,AAAA?state=s&token=t'),
		).rejects.toThrow(strings.auth.error.timeout)
		expect(getLauncherCaptchaSnapshot()).toBeNull()
		finishSend({ data: { verifyOtp: sdk.verifyOtp } })
		await vi.advanceTimersByTimeAsync(0)
		await expect(signOutLauncher()).resolves.toBeUndefined()
	})
})
