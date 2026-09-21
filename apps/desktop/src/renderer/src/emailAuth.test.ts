import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from './strings'

const mocks = vi.hoisted(() => ({
	init: vi.fn(),
	getVerification: vi.fn(),
	verify: vi.fn(),
	signUp: vi.fn(),
	signIn: vi.fn(),
	signInWithPassword: vi.fn(),
	getSession: vi.fn(),
	signOut: vi.fn(),
	resetPassword: vi.fn(),
	updateUserBasicInfo: vi.fn(),
	uploadFile: vi.fn(),
	getTempFileURL: vi.fn(),
	fetch: vi.fn(),
}))
vi.mock('@cloudbase/js-sdk', () => ({ default: { init: mocks.init } }))
let service: typeof import('./cloudbase')
const EMAIL = 'alice@example.com'
const PASSWORD = 'AuthTest9!'
const INPUT = { nickname: '昵称', password: PASSWORD }
const FILE_ID = 'cloud://environment.bucket/avatars/user-1/avatar.png'
function data(userId = 'user-1', email = EMAIL, picture?: string) {
	return {
		session: {
			access_token: 'access-secret',
			refresh_token: 'refresh-secret',
			expires_in: 3600,
			user: { id: userId, email, user_metadata: { name: '昵称', picture } },
		},
	}
}
async function registration() {
	const challenge = await service.sendLauncherEmailCode(EMAIL)
	const result = await challenge.verify('123456')
	if (result.kind !== 'registration') throw new Error('expected registration')
	return { challenge, registration: result.registration }
}
function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((success, failure) => {
		resolve = success
		reject = failure
	})
	return { promise, resolve, reject }
}

beforeEach(async () => {
	vi.resetModules()
	vi.resetAllMocks()
	mocks.init.mockReturnValue({
		auth: () => mocks,
		uploadFile: mocks.uploadFile,
		getTempFileURL: mocks.getTempFileURL,
	})
	mocks.getVerification.mockResolvedValue({
		verification_id: 'verification-id',
		expires_in: 600,
		is_user: false,
	})
	mocks.verify.mockResolvedValue({ verification_token: 'verification-secret', expires_in: 600 })
	// SDK direct signUp/signIn return an old LoginState, not a modern { data, error } result.
	mocks.signUp.mockResolvedValue({ user: { uid: 'user-1' } })
	mocks.signIn.mockResolvedValue({ user: { uid: 'user-1' } })
	mocks.getSession.mockResolvedValue({ data: data(), error: null })
	mocks.signOut.mockResolvedValue({ error: null })
	mocks.resetPassword.mockResolvedValue(undefined)
	mocks.updateUserBasicInfo.mockResolvedValue(undefined)
	mocks.uploadFile.mockResolvedValue({ fileID: FILE_ID })
	mocks.getTempFileURL.mockResolvedValue({
		fileList: [{ fileID: FILE_ID, tempFileURL: 'https://storage.example/avatar.png?temporary' }],
	})
	mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }))
	vi.stubGlobal('fetch', mocks.fetch)
	service = await import('./cloudbase')
})
afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('email delivery cooldowns and provider limits', () => {
	it('shares a normalized email cooldown across purposes without blocking another address', async () => {
		vi.useFakeTimers()
		expect(service.getLauncherEmailResendAt('not-an-email')).toBe(0)
		expect(service.getLauncherEmailResendAt(EMAIL)).toBe(0)
		const challenge = await service.sendLauncherEmailCode(' Alice@Example.COM ')
		const retryAt = Date.now() + 60_000
		expect(challenge.resendAt).toBe(retryAt)
		expect(service.getLauncherEmailResendAt(' ALICE@example.com ')).toBe(retryAt)
		await expect(service.sendLauncherPasswordResetCode(EMAIL)).rejects.toMatchObject({
			name: 'LauncherEmailRateLimitError',
			retryAt,
			source: 'local',
		})
		await expect(service.sendLauncherEmailCode('bob@example.com')).resolves.toMatchObject({
			email: 'bob@example.com',
		})
		expect(mocks.getVerification).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(service.getLauncherEmailResendAt(EMAIL)).toBe(0)
	})
	it('preserves a delivered email cooldown after its challenge is cancelled', async () => {
		vi.useFakeTimers()
		const challenge = await service.sendLauncherEmailCode(EMAIL)
		challenge.cancel()
		await expect(service.sendLauncherEmailCode(EMAIL)).rejects.toBeInstanceOf(
			service.LauncherEmailRateLimitError,
		)
		expect(service.getLauncherEmailResendAt(EMAIL)).toBe(challenge.resendAt)
		expect(mocks.getVerification).toHaveBeenCalledOnce()
	})
	it.each([
		{ error: 'rate_limit_exceeded', error_code: 4029, retry_after: 120 },
		{ code: 'resource_exhausted', retryAfter: 120 },
		{ category: 'RATE_LIMITED', retryAfter: 120 },
		{ errorCode: 8, retryAfter: 120 },
		{ code: 4029, retryAfter: 120 },
	])('retains provider limit metadata and retry seconds: %j', async (providerError) => {
		vi.useFakeTimers()
		mocks.getVerification.mockRejectedValueOnce(providerError)
		const retryAt = Date.now() + 120_000
		const error = await service.sendLauncherEmailCode(EMAIL).catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(service.LauncherEmailRateLimitError)
		expect(error).toMatchObject({
			message: strings.auth.emailErrors.rateLimit,
			retryAt,
			source: 'provider',
		})
		expect(service.getLauncherEmailResendAt(EMAIL)).toBe(retryAt)
		await expect(service.sendLauncherPasswordResetCode(EMAIL)).rejects.toMatchObject({
			retryAt,
			source: 'provider',
		})
		expect(mocks.getVerification).toHaveBeenCalledOnce()
	})
	it.each([undefined, 0, -1, Infinity, NaN, '120', Number.MAX_VALUE])(
		'uses client backoff rather than an untrusted retryAfter value %s',
		async (retryAfter) => {
			vi.useFakeTimers()
			mocks.getVerification.mockRejectedValueOnce({
				code: 'resource_exhausted',
				retryAfter,
				message: 'raw provider details containing verification-secret',
			})
			const retryAt = Date.now() + 60_000
			await expect(service.sendLauncherEmailCode(EMAIL)).rejects.toMatchObject({
				message: strings.auth.emailErrors.rateLimit,
				retryAt,
				source: 'provider',
			})
			expect(service.getLauncherEmailResendAt(EMAIL)).toBe(retryAt)
		},
	)
	it('does not mistake an unrelated limit error or its raw message for a resend limit', async () => {
		mocks.getVerification.mockRejectedValueOnce({
			code: 'profile_limit_invalid',
			message: 'rate_limit_exceeded verification-secret retry_after 3600',
		})
		await expect(service.sendLauncherEmailCode(EMAIL)).rejects.toThrow(
			strings.auth.emailErrors.send,
		)
		expect(service.getLauncherEmailResendAt(EMAIL)).toBe(0)
	})
	it.each(['verify', 'signUp'] as const)(
		'does not start a sending cooldown for a %s provider limit',
		async (operation) => {
			vi.useFakeTimers()
			const challenge = await service.sendLauncherEmailCode(EMAIL)
			mocks[operation].mockRejectedValueOnce({ code: 'resource_exhausted', retryAfter: 3600 })
			if (operation === 'verify') {
				await vi.advanceTimersByTimeAsync(60_000)
				await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.emailErrors.rateLimit)
			} else {
				const result = await challenge.verify('123456')
				if (result.kind !== 'registration') throw new Error('expected registration')
				await vi.advanceTimersByTimeAsync(60_000)
				await expect(result.registration.complete(INPUT)).rejects.toThrow(
					strings.auth.emailErrors.rateLimit,
				)
			}
			expect(service.getLauncherEmailResendAt(EMAIL)).toBe(0)
		},
	)
	it('keeps a timed-out delivery single-flight and records cooldown when success arrives late', async () => {
		vi.useFakeTimers()
		const delivery = deferred<{ verification_id: string; is_user: boolean }>()
		mocks.getVerification.mockReturnValueOnce(delivery.promise)
		const rejected = expect(service.sendLauncherEmailCode(EMAIL)).rejects.toThrow(
			strings.auth.error.timeout,
		)
		await vi.advanceTimersByTimeAsync(12_000)
		await rejected
		await expect(service.sendLauncherPasswordResetCode('bob@example.com')).rejects.toThrow(
			strings.auth.emailErrors.pending,
		)
		await vi.advanceTimersByTimeAsync(60_000)
		await expect(service.sendLauncherEmailCode(EMAIL)).rejects.toThrow(
			strings.auth.emailErrors.pending,
		)
		delivery.resolve({ verification_id: 'late-verification', is_user: false })
		await vi.advanceTimersByTimeAsync(0)
		const retryAt = Date.now() + 60_000
		expect(service.getLauncherEmailResendAt(EMAIL)).toBe(retryAt)
		await expect(service.sendLauncherEmailCode(EMAIL)).rejects.toMatchObject({
			retryAt,
			source: 'local',
		})
		expect(mocks.getVerification).toHaveBeenCalledOnce()
		expect(mocks.verify).not.toHaveBeenCalled()
	})
})

describe('verification before explicit account creation', () => {
	it('verifies an email without creating an account or a session', async () => {
		const { registration: form } = await registration()
		expect(form.state).toBe('pending')
		expect(mocks.getVerification).toHaveBeenCalledWith(
			{ email: EMAIL, target: 'ANY' },
			{ withCaptcha: true },
		)
		expect(mocks.verify).toHaveBeenCalledWith({
			verification_id: 'verification-id',
			verification_code: '123456',
		})
		expect(form.email).toBe(EMAIL)
		expect(mocks.signUp).not.toHaveBeenCalled()
		expect(mocks.signIn).not.toHaveBeenCalled()
		expect(mocks.getSession).not.toHaveBeenCalled()
		expect(mocks.uploadFile).not.toHaveBeenCalled()
		expect(mocks.fetch).not.toHaveBeenCalled()
	})
	it('creates only on completion with email, verification token, password and display name', async () => {
		const { challenge, registration: form } = await registration()
		await expect(form.complete({ nickname: ' 昵称 ', password: PASSWORD })).resolves.toMatchObject({
			email: EMAIL,
			userId: 'user-1',
			nickname: '昵称',
		})
		expect(form.state).toBe('complete')
		expect(mocks.signUp).toHaveBeenCalledTimes(1)
		expect(mocks.signUp).toHaveBeenCalledWith({
			email: EMAIL,
			verification_token: 'verification-secret',
			password: PASSWORD,
			name: '昵称',
		})
		expect(mocks.signInWithPassword).not.toHaveBeenCalled()
		expect(mocks.fetch).toHaveBeenCalledTimes(1)
		expect(mocks.fetch).toHaveBeenCalledWith(
			expect.stringMatching(/\/v1\/auth\/activate$/),
			expect.objectContaining({
				headers: { 'content-type': 'application/json', authorization: 'Bearer access-secret' },
				body: '{}',
			}),
		)
		challenge.cancel()
		form.cancel()
		expect(mocks.signOut).not.toHaveBeenCalled()
	})
	it('requires valid nickname, password and avatar before any account creation', async () => {
		const { registration: form } = await registration()
		await expect(form.complete({ nickname: '', password: PASSWORD })).rejects.toThrow(
			strings.auth.emailErrors.nicknameRequired,
		)
		await expect(form.complete({ nickname: '昵称', password: 'short' })).rejects.toThrow(
			strings.auth.validation.passwordLength,
		)
		await expect(
			form.complete({
				...INPUT,
				avatar: new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }),
			}),
		).rejects.toThrow(strings.auth.emailErrors.avatarType)
		await expect(
			form.complete({
				...INPUT,
				avatar: new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
			}),
		).rejects.toThrow(strings.auth.emailErrors.avatarSize)
		expect(mocks.signUp).not.toHaveBeenCalled()
	})
	it('destroys verified authority when the form is abandoned', async () => {
		const { challenge, registration: form } = await registration()
		challenge.cancel()
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.cancelled)
		expect(mocks.signUp).not.toHaveBeenCalled()
		expect(mocks.signOut).not.toHaveBeenCalled()
	})
	it('expires the server-provided verification token independently of the email code', async () => {
		vi.useFakeTimers()
		mocks.verify.mockResolvedValue({ verification_token: 'short-lived', expires_in: 5 })
		const { registration: form } = await registration()
		await vi.advanceTimersByTimeAsync(5000)
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.expired)
		expect(mocks.signUp).not.toHaveBeenCalled()
	})
	it('allows correction of a bad code and blocks replay after successful verification', async () => {
		const challenge = await service.sendLauncherEmailCode(EMAIL)
		await expect(challenge.verify('12')).rejects.toThrow(strings.auth.emailErrors.invalidCode)
		expect(mocks.verify).not.toHaveBeenCalled()
		mocks.verify.mockRejectedValueOnce({
			error: 'invalid_argument',
			error_description: 'raw verification-secret',
		})
		await expect(challenge.verify('111111')).rejects.toThrow(strings.auth.emailErrors.verify)
		await expect(challenge.verify('123456')).resolves.toMatchObject({ kind: 'registration' })
		await expect(challenge.verify('123456')).rejects.toThrow(strings.auth.emailErrors.expired)
	})
	it('throttles resends and invalidates the earlier form on a fresh verification', async () => {
		vi.useFakeTimers()
		const { registration: form } = await registration()
		await expect(service.sendLauncherEmailCode(EMAIL)).rejects.toThrow(
			strings.auth.emailErrors.rateLimit,
		)
		await vi.advanceTimersByTimeAsync(60_000)
		await service.sendLauncherEmailCode(EMAIL)
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.cancelled)
		expect(mocks.signUp).not.toHaveBeenCalled()
	})
	it.each([undefined, false, null])(
		'accepts a new-email challenge with is_user=%s without creating an account during verification',
		async (isUser) => {
			mocks.getVerification.mockResolvedValue({
				verification_id: 'verification-id',
				expires_in: 600,
				...(isUser === undefined ? {} : { is_user: isUser }),
			})
			const challenge = await service.sendLauncherEmailCode(EMAIL)
			await expect(challenge.verify('123456')).resolves.toMatchObject({ kind: 'registration' })
			expect(mocks.verify).toHaveBeenCalledOnce()
			expect(mocks.signUp).not.toHaveBeenCalled()
			expect(mocks.signIn).not.toHaveBeenCalled()
			expect(mocks.getSession).not.toHaveBeenCalled()
		},
	)
	it.each(['true', 1])('rejects a malformed nonempty is_user value %s', async (isUser) => {
		vi.useFakeTimers()
		mocks.getVerification.mockResolvedValue({ verification_id: 'verification-id', is_user: isUser })
		await expect(service.sendLauncherEmailCode(EMAIL)).rejects.toThrow(
			strings.auth.emailErrors.send,
		)
		expect(service.getLauncherEmailResendAt(EMAIL)).toBe(Date.now() + 60_000)
		expect(mocks.verify).not.toHaveBeenCalled()
	})
	it('does not retry an indeterminate sign-up with a consumed token', async () => {
		const { registration: form } = await registration()
		mocks.signUp.mockRejectedValueOnce(new Error('transport failed after server-created user'))
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.register)
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.cancelled)
		expect(mocks.signUp).toHaveBeenCalledOnce()
		expect(mocks.signOut).toHaveBeenCalledOnce()
	})
	it('requires another verification when a concurrent registration wins the email address', async () => {
		const { registration: form } = await registration()
		mocks.signUp.mockRejectedValueOnce({ error: 'already_exists' })
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.accountExists)
		expect(mocks.signIn).not.toHaveBeenCalled()
	})
	it('requires fresh verification without claiming account creation when signUp is rejected', async () => {
		const { registration: form } = await registration()
		mocks.signUp.mockRejectedValueOnce({
			error: 'invalid_argument',
			error_description: 'verification token rejected',
		})
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.register)
		expect(form.state).toBe('needs-verification')
		expect(mocks.getSession).not.toHaveBeenCalled()
		expect(mocks.fetch).not.toHaveBeenCalled()
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.cancelled)
		expect(mocks.signUp).toHaveBeenCalledOnce()
	})
	it.each([401, 403])(
		'requires a new login after gateway rejection %s without attempting an avatar upload',
		async (status) => {
			const { registration: form } = await registration()
			mocks.fetch.mockResolvedValueOnce(
				Response.json({ message: 'access-secret verification-secret' }, { status }),
			)
			await expect(
				form.complete({
					...INPUT,
					avatar: new File(['image'], 'avatar.png', { type: 'image/png' }),
				}),
			).rejects.toMatchObject({
				message: strings.auth.emailErrors.activationReauthenticate,
				retryable: false,
				status,
			})
			expect(form.state).toBe('needs-login')
			expect(mocks.signOut).toHaveBeenCalledOnce()
			expect(mocks.uploadFile).not.toHaveBeenCalled()
			await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.cancelled)
			expect(mocks.signUp).toHaveBeenCalledOnce()
		},
	)
	it.each([500, 503])(
		'retries gateway %s for the same created UID without registering again',
		async (status) => {
			const { registration: form } = await registration()
			mocks.fetch.mockResolvedValueOnce(
				Response.json({ message: 'access-secret verification-secret' }, { status }),
			)
			await expect(form.complete(INPUT)).rejects.toMatchObject({
				message: strings.auth.emailErrors.activationRetry,
				retryable: true,
				status,
			})
			expect(form.state).toBe('confirming-account')
			expect(mocks.signOut).not.toHaveBeenCalled()
			expect(mocks.uploadFile).not.toHaveBeenCalled()
			await expect(form.complete(INPUT)).resolves.toMatchObject({ userId: 'user-1' })
			expect(form.state).toBe('complete')
			expect(mocks.signUp).toHaveBeenCalledOnce()
			expect(mocks.fetch).toHaveBeenCalledTimes(2)
		},
	)
	it('retains a created account after a confirmation network failure and rechecks its UID on retry', async () => {
		const { registration: form } = await registration()
		mocks.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.activationRetry)
		expect(form.state).toBe('confirming-account')
		expect(mocks.signOut).not.toHaveBeenCalled()
		mocks.getSession.mockResolvedValueOnce({ data: data('another-uid') })
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.sessionChanged)
		expect(form.state).toBe('needs-login')
		expect(mocks.fetch).toHaveBeenCalledOnce()
		expect(mocks.signUp).toHaveBeenCalledOnce()
	})
	it('retains only the confirmation retry when a late response arrives after timeout', async () => {
		vi.useFakeTimers()
		const { registration: form } = await registration()
		const request = deferred<Response>()
		mocks.fetch.mockReturnValueOnce(request.promise)
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		const rejected = expect(form.complete({ ...INPUT, avatar })).rejects.toThrow(
			strings.auth.error.timeout,
		)
		await vi.advanceTimersByTimeAsync(12_000)
		await rejected
		expect(form.state).toBe('confirming-account')
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.pending)
		request.resolve(new Response(null, { status: 204 }))
		await vi.advanceTimersByTimeAsync(0)
		expect(form.state).toBe('confirming-account')
		expect(mocks.signOut).not.toHaveBeenCalled()
		expect(mocks.uploadFile).not.toHaveBeenCalled()
		await expect(form.complete(INPUT)).resolves.toMatchObject({ userId: 'user-1' })
		expect(mocks.signUp).toHaveBeenCalledOnce()
		expect(mocks.fetch).toHaveBeenCalledTimes(2)
	})
	it('clears the session when confirmation is explicitly abandoned', async () => {
		const { registration: form } = await registration()
		const request = deferred<Response>()
		mocks.fetch.mockImplementationOnce(() => {
			form.cancel()
			return request.promise
		})
		const rejected = expect(form.complete(INPUT)).rejects.toThrow(
			strings.auth.emailErrors.cancelled,
		)
		request.resolve(new Response(null, { status: 204 }))
		await rejected
		expect(mocks.signOut).toHaveBeenCalledOnce()
		expect(mocks.uploadFile).not.toHaveBeenCalled()
	})
})

describe('existing accounts and password reset', () => {
	it('signs into an existing account through its verified email without calling signUp', async () => {
		mocks.getVerification.mockResolvedValue({
			verification_id: 'existing',
			expires_in: 600,
			is_user: true,
		})
		mocks.getSession.mockResolvedValue({ data: data('existing-uid') })
		const challenge = await service.sendLauncherEmailCode(EMAIL)
		await expect(challenge.verify('123456')).resolves.toMatchObject({
			kind: 'authenticated',
			session: { userId: 'existing-uid', email: EMAIL },
		})
		expect(mocks.signIn).toHaveBeenCalledTimes(1)
		expect(mocks.signIn).toHaveBeenCalledWith({
			username: EMAIL,
			verification_token: 'verification-secret',
		})
		expect(mocks.signUp).not.toHaveBeenCalled()
		challenge.cancel()
		expect(mocks.signOut).not.toHaveBeenCalled()
	})
	it('rejects a mismatched account returned by the SDK and clears its session', async () => {
		mocks.getVerification.mockResolvedValue({ verification_id: 'existing', is_user: true })
		mocks.getSession.mockResolvedValue({ data: data('other-id', 'someone@example.com') })
		const challenge = await service.sendLauncherEmailCode(EMAIL)
		await expect(challenge.verify('123456')).rejects.toThrow(
			strings.auth.emailErrors.sessionChanged,
		)
		expect(mocks.signOut).toHaveBeenCalledOnce()
	})
	it('resets an existing email password only after verification and does not auto-login', async () => {
		const challenge = await service.sendLauncherPasswordResetCode(EMAIL)
		expect(mocks.getVerification).toHaveBeenCalledWith(
			{ email: EMAIL, target: 'USER' },
			{ withCaptcha: true },
		)
		const reset = await challenge.verify('123456')
		expect(mocks.resetPassword).not.toHaveBeenCalled()
		await reset.complete(PASSWORD)
		expect(mocks.resetPassword).toHaveBeenCalledTimes(1)
		expect(mocks.resetPassword).toHaveBeenCalledWith({
			email: EMAIL,
			verification_token: 'verification-secret',
			new_password: PASSWORD,
		})
		expect(mocks.signIn).not.toHaveBeenCalled()
		expect(mocks.signInWithPassword).not.toHaveBeenCalled()
		expect(mocks.signUp).not.toHaveBeenCalled()
		reset.cancel()
		expect(mocks.signOut).not.toHaveBeenCalled()
	})
	it('does not reuse a reset token when the reset response is indeterminate', async () => {
		const challenge = await service.sendLauncherPasswordResetCode(EMAIL)
		const reset = await challenge.verify('123456')
		mocks.resetPassword.mockRejectedValueOnce(new Error('verification-secret'))
		await expect(reset.complete(PASSWORD)).rejects.toThrow(strings.auth.emailErrors.reset)
		await expect(reset.complete(PASSWORD)).rejects.toThrow(strings.auth.emailErrors.expired)
		expect(mocks.resetPassword).toHaveBeenCalledOnce()
	})
})

describe('avatar retry and concurrent auth safety', () => {
	it('uploads under the new UID only after registration and persists the fileID', async () => {
		const { registration: form } = await registration()
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		mocks.getSession
			.mockResolvedValueOnce({ data: data() })
			.mockResolvedValue({ data: data('user-1', EMAIL, FILE_ID) })
		await expect(form.complete({ ...INPUT, avatar })).resolves.toMatchObject({
			avatarUrl: 'https://storage.example/avatar.png?temporary',
		})
		expect(mocks.uploadFile).toHaveBeenCalledWith({
			cloudPath: expect.stringMatching(/^avatars\/user-1\/[^/]+\.png$/),
			filePath: avatar,
		})
		expect(mocks.signUp.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.uploadFile.mock.invocationCallOrder[0]!,
		)
		expect(mocks.updateUserBasicInfo).toHaveBeenCalledTimes(1)
		expect(mocks.updateUserBasicInfo).toHaveBeenCalledWith({ picture: FILE_ID })
		expect(JSON.stringify(mocks.updateUserBasicInfo.mock.calls)).not.toContain('temporary')
	})
	it('retries an avatar failure against the same created account without repeating sign-up', async () => {
		const { registration: form } = await registration()
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		mocks.uploadFile.mockRejectedValueOnce(new Error('storage unavailable'))
		await expect(form.complete({ ...INPUT, avatar })).rejects.toThrow(
			strings.auth.emailErrors.avatarUpload,
		)
		expect(form.state).toBe('avatar-pending')
		expect(mocks.signOut).not.toHaveBeenCalled()
		await expect(form.complete({ ...INPUT, avatar })).resolves.toMatchObject({ userId: 'user-1' })
		expect(mocks.signUp).toHaveBeenCalledOnce()
		expect(mocks.uploadFile).toHaveBeenCalledTimes(2)
	})
	it('can finish without the optional avatar after upload failure', async () => {
		vi.useFakeTimers()
		const { registration: form } = await registration()
		mocks.uploadFile.mockRejectedValueOnce(new Error('storage unavailable'))
		await expect(
			form.complete({ ...INPUT, avatar: new File(['image'], 'avatar.png', { type: 'image/png' }) }),
		).rejects.toThrow(strings.auth.emailErrors.avatarUpload)
		expect(form.expiresAt).toBe(Infinity)
		await vi.advanceTimersByTimeAsync(600_000)
		await expect(form.complete(INPUT)).resolves.toMatchObject({ userId: 'user-1' })
		expect(mocks.signUp).toHaveBeenCalledOnce()
	})
	it('reuses the uploaded file when only the profile update failed', async () => {
		const { registration: form } = await registration()
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		mocks.updateUserBasicInfo.mockRejectedValueOnce(new Error('profile unavailable'))
		await expect(form.complete({ ...INPUT, avatar })).rejects.toThrow(
			strings.auth.emailErrors.avatarUpload,
		)
		await form.complete({ ...INPUT, avatar })
		expect(mocks.signUp).toHaveBeenCalledOnce()
		expect(mocks.uploadFile).toHaveBeenCalledOnce()
		expect(mocks.updateUserBasicInfo).toHaveBeenCalledTimes(2)
	})
	it('will not apply an avatar retry after the authenticated UID changes', async () => {
		const { registration: form } = await registration()
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		mocks.uploadFile.mockRejectedValueOnce(new Error('storage unavailable'))
		await expect(form.complete({ ...INPUT, avatar })).rejects.toThrow(
			strings.auth.emailErrors.avatarUpload,
		)
		mocks.getSession.mockResolvedValueOnce({ data: data('another-uid') })
		await expect(form.complete({ ...INPUT, avatar })).rejects.toThrow(
			strings.auth.emailErrors.sessionChanged,
		)
		expect(mocks.uploadFile).toHaveBeenCalledOnce()
		expect(mocks.signUp).toHaveBeenCalledOnce()
	})
	it('keeps completion single-flight and clears a session created after cancellation', async () => {
		const { registration: form } = await registration()
		const request = deferred<unknown>()
		mocks.signUp.mockReturnValueOnce(request.promise)
		const completion = form.complete(INPUT)
		const rejected = expect(completion).rejects.toThrow(strings.auth.emailErrors.cancelled)
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.pending)
		form.cancel()
		request.resolve({})
		await rejected
		expect(mocks.signOut).toHaveBeenCalledOnce()
		expect(mocks.uploadFile).not.toHaveBeenCalled()
	})
	it('keeps the mutation lock through a timeout and cleans up late account creation', async () => {
		vi.useFakeTimers()
		const { registration: form } = await registration()
		const request = deferred<unknown>()
		mocks.signUp.mockReturnValueOnce(request.promise)
		const rejected = expect(form.complete(INPUT)).rejects.toThrow(strings.auth.error.timeout)
		await vi.advanceTimersByTimeAsync(12000)
		await rejected
		await expect(form.complete(INPUT)).rejects.toThrow(strings.auth.emailErrors.pending)
		request.resolve({})
		await vi.advanceTimersByTimeAsync(0)
		expect(mocks.signOut).toHaveBeenCalledOnce()
		expect(mocks.signUp).toHaveBeenCalledOnce()
		expect(mocks.fetch).not.toHaveBeenCalled()
		expect(mocks.uploadFile).not.toHaveBeenCalled()
	})
})
