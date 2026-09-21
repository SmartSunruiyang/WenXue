import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from './strings'

const mocks = vi.hoisted(() => ({
	init: vi.fn(),
	signInWithPassword: vi.fn(),
	signOut: vi.fn(),
	getSession: vi.fn(),
	refreshSession: vi.fn(),
	getTempFileURL: vi.fn(),
	uploadFile: vi.fn(),
	updateUserBasicInfo: vi.fn(),
	collection: vi.fn(),
	where: vi.fn(),
	watch: vi.fn(),
}))
vi.mock('@cloudbase/js-sdk', () => ({ default: { init: mocks.init } }))
let service: typeof import('./cloudbase')
const EMAIL = 'alice@example.com'
const PASSWORD = 'AuthTest9!'
function sessionData(overrides: Record<string, unknown> = {}) {
	return {
		session: {
			access_token: 'access-secret',
			refresh_token: 'refresh-secret',
			expires_in: 3600,
			user: { id: 'user-1', email: EMAIL, user_metadata: { name: '阿丽' } },
			...overrides,
		},
	}
}

beforeEach(async () => {
	vi.resetModules()
	vi.resetAllMocks()
	mocks.init.mockReturnValue({
		auth: () => mocks,
		database: () => ({ collection: mocks.collection }),
		getTempFileURL: mocks.getTempFileURL,
		uploadFile: mocks.uploadFile,
	})
	mocks.collection.mockReturnValue({ where: mocks.where })
	mocks.where.mockReturnValue({ watch: mocks.watch })
	mocks.watch.mockReturnValue({ close: vi.fn() })
	mocks.signOut.mockResolvedValue({ error: null })
	mocks.getSession.mockResolvedValue({ data: null, error: null })
	mocks.signInWithPassword.mockResolvedValue({ data: sessionData(), error: null })
	service = await import('./cloudbase')
})
afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('account profile updates', () => {
	const fileID = 'cloud://environment.bucket/avatars/user-1/new.png'
	const avatarUrl = 'https://storage.example/new.png?signature=temporary'
	const input = { userId: 'user-1', nickname: '新昵称' }
	let current: ReturnType<typeof sessionData>

	beforeEach(() => {
		current = sessionData()
		mocks.getSession.mockImplementation(async () => ({ data: current }))
		mocks.uploadFile.mockResolvedValue({ fileID })
		mocks.getTempFileURL.mockResolvedValue({ fileList: [{ fileID, tempFileURL: avatarUrl }] })
		mocks.updateUserBasicInfo.mockImplementation(
			async (profile: { name: string; picture?: string }) => {
				current = sessionData({
					user: {
						id: 'user-1',
						email: EMAIL,
						user_metadata: { name: profile.name, picture: profile.picture ?? avatarUrl },
					},
				})
			},
		)
	})

	it('updates the nickname without replacing the existing avatar or exposing credentials', async () => {
		const result = await service.updateLauncherProfile({ ...input, nickname: ' 新昵称 ' })
		expect(mocks.updateUserBasicInfo).toHaveBeenCalledWith({ name: '新昵称' })
		expect(mocks.uploadFile).not.toHaveBeenCalled()
		expect(result).toMatchObject({ userId: 'user-1', nickname: '新昵称', avatarUrl })
		expect(JSON.stringify(result)).not.toContain('secret')
	})

	it('persists the permanent file ID and returns the uploaded image for the home avatar', async () => {
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		await expect(service.updateLauncherProfile({ ...input, avatar })).resolves.toMatchObject({
			nickname: '新昵称',
			avatarUrl,
		})
		expect(mocks.uploadFile).toHaveBeenCalledWith({
			cloudPath: expect.stringMatching(/^avatars\/user-1\/[^/]+\.png$/),
			filePath: avatar,
		})
		expect(mocks.updateUserBasicInfo).toHaveBeenCalledWith({ name: '新昵称', picture: fileID })
		expect(JSON.stringify(mocks.updateUserBasicInfo.mock.calls)).not.toContain('temporary')
	})

	it('retains the upload for a profile-save retry and never signs in or creates an account', async () => {
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		mocks.updateUserBasicInfo.mockRejectedValueOnce(new Error('internal access-secret'))
		await expect(service.updateLauncherProfile({ ...input, avatar })).rejects.toThrow(
			strings.account.errors.save,
		)
		await expect(service.updateLauncherProfile({ ...input, avatar })).resolves.toMatchObject({
			avatarUrl,
		})
		expect(mocks.uploadFile).toHaveBeenCalledOnce()
		expect(mocks.updateUserBasicInfo).toHaveBeenCalledTimes(2)
		expect(mocks.signInWithPassword).not.toHaveBeenCalled()
		expect(mocks.signOut).not.toHaveBeenCalled()
	})

	it('allows retry after an upload failure without mutating the profile', async () => {
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		mocks.uploadFile.mockRejectedValueOnce(new Error('storage unavailable'))
		await expect(service.updateLauncherProfile({ ...input, avatar })).rejects.toThrow(
			strings.account.errors.save,
		)
		expect(mocks.updateUserBasicInfo).not.toHaveBeenCalled()
		await expect(service.updateLauncherProfile({ ...input, avatar })).resolves.toMatchObject({
			avatarUrl,
		})
		expect(mocks.uploadFile).toHaveBeenCalledTimes(2)
	})

	it('validates nickname and avatar before contacting CloudBase', async () => {
		for (const nickname of ['', ' \t ', '长'.repeat(33), '问\u0000学']) {
			await expect(service.updateLauncherProfile({ ...input, nickname })).rejects.toThrow()
		}
		for (const avatar of [
			new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }),
			new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
		]) {
			await expect(service.updateLauncherProfile({ ...input, avatar })).rejects.toThrow()
		}
		expect(mocks.getSession).not.toHaveBeenCalled()
		expect(mocks.updateUserBasicInfo).not.toHaveBeenCalled()
	})

	it('keeps an unresolved saved avatar retryable instead of reporting an empty avatar as success', async () => {
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		mocks.getTempFileURL.mockResolvedValueOnce({ fileList: [] })
		await expect(service.updateLauncherProfile({ ...input, avatar })).rejects.toThrow(
			strings.account.errors.save,
		)
		await expect(service.updateLauncherProfile({ ...input, avatar })).resolves.toMatchObject({
			avatarUrl,
		})
		expect(mocks.uploadFile).toHaveBeenCalledOnce()
	})

	it('uses profile-edit wording when the upload response has no valid file ID', async () => {
		mocks.uploadFile.mockResolvedValueOnce({ fileID: '' })
		const request = service.updateLauncherProfile({
			...input,
			avatar: new File(['image'], 'avatar.png', { type: 'image/png' }),
		})
		await expect(request).rejects.toThrow(strings.account.errors.save)
		await expect(request).rejects.not.toThrow(/账号已创建|注册|移除头像后继续/)
	})

	it('refuses a different UID before upload and after an account changes during upload', async () => {
		const avatar = new File(['image'], 'avatar.png', { type: 'image/png' })
		await expect(
			service.updateLauncherProfile({ ...input, userId: 'different-user', avatar }),
		).rejects.toThrow(strings.auth.emailErrors.sessionChanged)
		expect(mocks.uploadFile).not.toHaveBeenCalled()
		mocks.uploadFile.mockImplementationOnce(async () => {
			current = sessionData({ user: { id: 'different-user', email: EMAIL } })
			return { fileID }
		})
		await expect(service.updateLauncherProfile({ ...input, avatar })).rejects.toThrow(
			strings.auth.emailErrors.sessionChanged,
		)
		expect(mocks.updateUserBasicInfo).not.toHaveBeenCalled()
	})

	it('does not publish another UID or stale data returned after saving', async () => {
		mocks.updateUserBasicInfo.mockImplementationOnce(async () => {
			current = sessionData({ user: { id: 'different-user', email: EMAIL } })
		})
		await expect(service.updateLauncherProfile(input)).rejects.toThrow(
			strings.auth.emailErrors.sessionChanged,
		)
		current = sessionData()
		mocks.updateUserBasicInfo.mockResolvedValueOnce(undefined)
		await expect(service.updateLauncherProfile(input)).rejects.toThrow(strings.account.errors.save)
	})

	it('rejects an account switch while resolving the newly saved avatar URL', async () => {
		mocks.getTempFileURL.mockImplementationOnce(async () => {
			current = sessionData({ user: { id: 'different-user', email: EMAIL } })
			return { fileList: [{ fileID, tempFileURL: avatarUrl }] }
		})
		await expect(
			service.updateLauncherProfile({
				...input,
				avatar: new File(['image'], 'avatar.png', { type: 'image/png' }),
			}),
		).rejects.toThrow(strings.auth.emailErrors.sessionChanged)
	})

	it('blocks concurrent sign-out and does not save after an upload finishes beyond the deadline', async () => {
		vi.useFakeTimers()
		let finishUpload!: (value: { fileID: string }) => void
		mocks.uploadFile.mockImplementationOnce(
			() => new Promise<{ fileID: string }>((resolve) => (finishUpload = resolve)),
		)
		const request = service.updateLauncherProfile({
			...input,
			avatar: new File(['image'], 'avatar.png', { type: 'image/png' }),
		})
		const rejected = expect(request).rejects.toThrow(strings.auth.error.timeout)
		await vi.advanceTimersByTimeAsync(0)
		await expect(service.signOutLauncher()).rejects.toThrow(strings.auth.emailErrors.pending)
		await vi.advanceTimersByTimeAsync(30_000)
		await rejected
		finishUpload({ fileID })
		await vi.advanceTimersByTimeAsync(0)
		expect(mocks.updateUserBasicInfo).not.toHaveBeenCalled()
	})
})

describe('email credentials and public sessions', () => {
	it('uses the configured publishable key and email identity for password login', async () => {
		expect(service.cloudbaseConfig.hasAccessKey).toBe(true)
		await expect(
			service.signInLauncher(' Alice@Example.com ', '1OldPassword!'),
		).resolves.toMatchObject({ userId: 'user-1', email: EMAIL, nickname: '阿丽' })
		expect(mocks.signInWithPassword).toHaveBeenCalledWith({
			email: EMAIL,
			password: '1OldPassword!',
		})
	})
	it.each([
		'',
		'alice',
		'a@',
		'@example.com',
		'a..b@example.com',
		'.a@example.com',
		'a@-example.com',
		'a@exam ple.com',
		'a@example.com\n@evil.com',
	])('rejects invalid email %j before making requests', async (email) => {
		await expect(service.signInLauncher(email, PASSWORD)).rejects.toThrow(
			strings.auth.emailErrors.invalidEmail,
		)
		expect(mocks.signInWithPassword).not.toHaveBeenCalled()
	})
	it('requires a password but does not apply new-password rules to an existing login', async () => {
		await expect(service.signInLauncher(EMAIL, '')).rejects.toThrow(
			strings.auth.validation.passwordRequired,
		)
		expect(mocks.signInWithPassword).not.toHaveBeenCalled()
	})
	it('accepts optional display names while enforcing nonempty name and new-password rules', () => {
		expect(service.validateLauncherRegistration(' 问学用户 ', PASSWORD)).toBeNull()
		expect(service.validateLauncherRegistration('😀'.repeat(32), PASSWORD)).toBeNull()
		expect(service.validateLauncherRegistration('', PASSWORD)).toBeNull()
		expect(service.validateLauncherRegistration(' \t\n　', PASSWORD)).toBeNull()
		expect(service.validateLauncherRegistration('😀'.repeat(33), PASSWORD)).toBe(
			strings.auth.emailErrors.nicknameLength,
		)
		expect(service.validateLauncherRegistration('问\u0000学', PASSWORD)).toBe(
			strings.auth.emailErrors.nicknameLength,
		)
		expect(service.validateLauncherPassword(PASSWORD)).toBeNull()
		for (const [password, key] of [
			['', 'passwordRequired'],
			['Aa1!', 'passwordLength'],
			['A'.repeat(33), 'passwordLength'],
			['1AuthTest!', 'passwordFirstCharacter'],
			['AuthTest9 ', 'passwordCharacterSet'],
			['AuthTest9\n', 'passwordCharacterSet'],
			['Auth😀Test9!', 'passwordCharacterSet'],
			['Authentication', 'passwordComplexity'],
		] as const) {
			expect(service.validateLauncherRegistration('昵称', password)).toBe(
				strings.auth.validation[key],
			)
			expect(service.validateLauncherRegistration('', password)).toBe(strings.auth.validation[key])
			expect(service.validateLauncherPassword(password)).toBe(strings.auth.validation[key])
		}
	})
	it('reports password rules independently and keeps Unicode comparison positions aligned', () => {
		expect(service.getLauncherPasswordRequirements('AuthTe1')).toEqual({
			length: false,
			firstCharacter: true,
			characterSet: true,
			complexity: true,
		})
		expect(service.getLauncherPasswordRequirements('')).toEqual({
			length: false,
			firstCharacter: false,
			characterSet: false,
			complexity: false,
		})
		expect(service.getLauncherPasswordComparison('A😀b1!', 'A😀x')).toEqual({
			states: ['match', 'match', 'mismatch', 'pending', 'pending'],
			confirmedLength: 3,
			extraLength: 0,
			firstMismatchIndex: 2,
		})
		expect(service.getLauncherPasswordComparison('Ab1!', 'Ab1!2').extraLength).toBe(1)
	})
	it('normalizes expiry and strips credentials from the public user', () => {
		const session = service.readLauncherAuthSession(sessionData(), {
			now: () => 1000,
			gatewayBaseUrl: 'https://gateway.example/v1/',
		})!
		expect(session).toMatchObject({
			userId: 'user-1',
			email: EMAIL,
			nickname: '阿丽',
			expiresAt: 3601000,
			gatewayBaseUrl: 'https://gateway.example',
		})
		const user = service.toPublicUser(session)
		expect(user).toEqual({
			userId: 'user-1',
			email: EMAIL,
			nickname: '阿丽',
			avatarUrl: undefined,
			expiresAt: 3601000,
		})
		expect(JSON.stringify(user)).not.toContain('secret')
	})
	it('rejects malformed or anonymous sessions and never exposes data URLs as avatars', () => {
		expect(service.readLauncherAuthSession({ session: { access_token: 'secret' } })).toBeNull()
		expect(
			service.readLauncherAuthSession(
				sessionData({ user: { id: 'anonymous', is_anonymous: true } }),
			),
		).toBeNull()
		expect(
			service.readLauncherAuthSession(
				sessionData({
					user: { id: 'user-1', user_metadata: { picture: 'data:image/svg+xml,unsafe' } },
				}),
			)?.avatarUrl,
		).toBeUndefined()
	})
	it('resolves a permanent avatar fileID for display without modifying the saved profile', async () => {
		const fileID = 'cloud://environment.bucket/avatars/user-1/avatar.png'
		mocks.getSession.mockResolvedValue({
			data: sessionData({
				user: { id: 'user-1', email: EMAIL, user_metadata: { picture: fileID } },
			}),
		})
		mocks.getTempFileURL.mockResolvedValue({
			fileList: [{ fileID, tempFileURL: 'https://storage.example/avatar.png?signature=temporary' }],
		})
		await expect(service.getLauncherSession()).resolves.toMatchObject({
			avatarUrl: 'https://storage.example/avatar.png?signature=temporary',
		})
		expect(mocks.getTempFileURL).toHaveBeenCalledWith({ fileList: [{ fileID, maxAge: 3600 }] })
	})
})

describe('timeouts, session recovery and safe errors', () => {
	it('fails closed on session lookup errors and malformed sessions without exposing SDK details', async () => {
		mocks.getSession.mockResolvedValueOnce({ error: { message: 'access-secret refresh-secret' } })
		await expect(service.getLauncherSession()).rejects.toThrow(strings.auth.error.loginSession)
		mocks.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'partial' } } })
		await expect(service.getLauncherSession()).rejects.toThrow(strings.auth.error.loginSession)
	})
	it('refreshes through the SDK while retaining email profile fields', async () => {
		mocks.refreshSession.mockResolvedValue({ data: sessionData({ access_token: 'fresh-access' }) })
		await expect(service.refreshLauncherSession('old-refresh')).resolves.toMatchObject({
			accessToken: 'fresh-access',
			email: EMAIL,
		})
		expect(mocks.refreshSession).toHaveBeenCalledWith('old-refresh')
	})
	it('retains actionable network errors but never renders arbitrary login diagnostics', async () => {
		mocks.signInWithPassword.mockRejectedValueOnce(new Error('Failed to fetch'))
		await expect(service.signInLauncher(EMAIL, PASSWORD)).rejects.toThrow(
			strings.auth.error.network,
		)
		mocks.signInWithPassword.mockRejectedValueOnce(new Error('password=AuthTest9! access-secret'))
		await expect(service.signInLauncher(EMAIL, PASSWORD)).rejects.toThrow(strings.auth.error.login)
	})
	it('clears a successful password login if the SDK returns a different email', async () => {
		mocks.signInWithPassword.mockResolvedValueOnce({
			data: sessionData({ user: { id: 'other-id', email: 'other@example.com' } }),
		})
		await expect(service.signInLauncher(EMAIL, PASSWORD)).rejects.toThrow(
			strings.auth.error.loginSession,
		)
		expect(mocks.signOut).toHaveBeenCalledOnce()
	})
	it('blocks further mutations when cleanup of an unexpected login fails', async () => {
		mocks.signInWithPassword.mockResolvedValueOnce({ data: { session: null } })
		mocks.signOut.mockRejectedValueOnce(new Error('cleanup failed'))
		await expect(service.signInLauncher(EMAIL, PASSWORD)).rejects.toThrow(
			strings.auth.error.loginSession,
		)
		await expect(service.signInLauncher(EMAIL, PASSWORD)).rejects.toThrow(
			strings.auth.emailErrors.sessionChanged,
		)
		expect(mocks.signInWithPassword).toHaveBeenCalledOnce()
	})
	it('keeps login single-flight after timeout and signs out a late failed completion', async () => {
		vi.useFakeTimers()
		let reject!: (error: unknown) => void
		mocks.signInWithPassword.mockReturnValueOnce(
			new Promise((_, fail) => {
				reject = fail
			}),
		)
		const pending = expect(service.signInLauncher(EMAIL, PASSWORD)).rejects.toThrow(
			strings.auth.error.timeout,
		)
		await vi.advanceTimersByTimeAsync(12000)
		await pending
		await expect(service.signInLauncher(EMAIL, PASSWORD)).rejects.toThrow(
			strings.auth.emailErrors.pending,
		)
		reject(new Error('late SDK failure after credentials were written'))
		await vi.advanceTimersByTimeAsync(0)
		expect(mocks.signOut).toHaveBeenCalledOnce()
		await expect(service.signInLauncher(EMAIL, PASSWORD)).resolves.toMatchObject({ email: EMAIL })
		expect(vi.getTimerCount()).toBe(0)
	})
	it('marks stalled sign-out outcomes as unknown', async () => {
		vi.useFakeTimers()
		mocks.signOut.mockReturnValueOnce(new Promise(() => undefined))
		const pending = expect(service.signOutLauncher()).rejects.toMatchObject({
			message: strings.auth.error.timeout,
			cloudSignOutOutcome: 'unknown',
		})
		await vi.advanceTimersByTimeAsync(12000)
		await pending
	})
	it('bounds session lookup duration', async () => {
		vi.useFakeTimers()
		mocks.getSession.mockReturnValueOnce(new Promise(() => undefined))
		const pending = expect(service.getLauncherSession()).rejects.toThrow(strings.auth.error.timeout)
		await vi.advanceTimersByTimeAsync(12000)
		await pending
	})
	it('watches scoped account signals and the public release/global signals', () => {
		const callbacks = { onChange: vi.fn(), onError: vi.fn() }
		service.watchDesktopSignal('desktop_release_signal', 'electron:stable', callbacks)
		expect(mocks.where).toHaveBeenLastCalledWith({ _id: 'electron:stable' })
		service.watchDesktopSignal('desktop_announcement_signal', 'global', callbacks)
		expect(mocks.where).toHaveBeenLastCalledWith({ _id: 'global' })
		service.watchDesktopSignal('desktop_announcement_signal', 'user:hashed-id', callbacks)
		expect(mocks.where).toHaveBeenLastCalledWith({ _id: 'user:hashed-id', uid: '{openid}' })
		expect(mocks.watch).toHaveBeenLastCalledWith(callbacks)
	})
})
