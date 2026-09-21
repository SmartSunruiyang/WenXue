// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	LauncherEmailRateLimitError,
	type LauncherAuthSession,
	type LauncherEmailRegistration,
} from './cloudbase'
import { EmailAuthScreen } from './EmailAuthScreen'
import { strings } from './strings'

const auth = vi.hoisted(() => ({
	sendEmail: vi.fn(),
	sendReset: vi.fn(),
	login: vi.fn(),
	resendAt: vi.fn<(email: string) => number>(),
}))

vi.mock('./cloudbase', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./cloudbase')>()
	return {
		...actual,
		sendLauncherEmailCode: auth.sendEmail,
		sendLauncherPasswordResetCode: auth.sendReset,
		signInLauncher: auth.login,
		getLauncherEmailResendAt: auth.resendAt,
	}
})

const session: LauncherAuthSession = {
	userId: 'email-user',
	email: 'student@example.com',
	nickname: '小问',
	accessToken: 'test-token',
	refreshToken: 'test-refresh',
	expiresAt: Date.now() + 60_000,
	gatewayBaseUrl: 'https://gateway.example.com',
}
const password = 'ValidPass1!'
let container: HTMLDivElement
let root: Root
let onAuthenticated: ReturnType<typeof vi.fn>
let reducedMotion: MediaQueryList

function button(label: string) {
	const target = Array.from(container.querySelectorAll('button')).find(
		(item) => item.textContent === label || item.getAttribute('aria-label') === label,
	)
	if (!target) throw new Error(`Missing button: ${label}`)
	return target
}
async function click(label: string) {
	await act(async () => button(label).click())
}
async function input(suffix: string, value: string) {
	const target = container.querySelector<HTMLInputElement>(`input[id$="-${suffix}"]`)
	if (!target) throw new Error(`Missing input: ${suffix}`)
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value)
		target.dispatchEvent(new Event('input', { bubbles: true }))
	})
}
async function submit() {
	await act(async () => {
		container
			.querySelector('form')!
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
	})
}
async function selectAvatar() {
	const avatar = new File(['avatar'], 'avatar.png', { type: 'image/png' })
	const target = container.querySelector<HTMLInputElement>('input[type="file"]')!
	await act(async () => {
		Object.defineProperty(target, 'files', { configurable: true, value: [avatar] })
		target.dispatchEvent(new Event('change', { bubbles: true }))
	})
	return avatar
}
async function renderScreen(onOpenExternal?: (url: string) => void) {
	await act(async () =>
		root.render(
			createElement(EmailAuthScreen, {
				error: null,
				frameless: false,
				onAuthenticated,
				onClearError: vi.fn(),
				onOpenExternal,
			}),
		),
	)
}
function registrationFixture() {
	const registration = {
		state: 'pending' as LauncherEmailRegistration['state'],
		email: session.email!,
		expiresAt: Date.now() + 600_000,
		cancel: vi.fn(),
		complete: vi.fn().mockResolvedValue(session),
	}
	const challenge = {
		email: session.email!,
		expiresAt: Date.now() + 600_000,
		resendAt: Date.now() + 60_000,
		cancel: vi.fn(),
		verify: vi.fn().mockResolvedValue({ kind: 'registration', registration }),
	}
	auth.sendEmail.mockResolvedValue(challenge)
	return { challenge, registration }
}
async function verifyEmail() {
	await input('email', session.email!)
	await submit()
	await input('code', '123456')
	await submit()
}
async function enterProfile() {
	await input('password', password)
	await input('confirmation', password)
	await submit()
}

beforeEach(async () => {
	vi.clearAllMocks()
	auth.resendAt.mockReset().mockReturnValue(0)
	reducedMotion = Object.assign(new EventTarget(), {
		matches: true,
		media: '(prefers-reduced-motion: reduce)',
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
	}) as MediaQueryList
	vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(reducedMotion))
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	vi.stubGlobal(
		'URL',
		class extends URL {
			static createObjectURL = vi.fn().mockReturnValue('blob:avatar-preview')
			static revokeObjectURL = vi.fn()
		},
	)
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	onAuthenticated = vi.fn().mockResolvedValue(undefined)
	await renderScreen()
})
afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe('email authentication screens', () => {
	it('shows the welcome title, account icon and Chinese privacy link with the approved email entries', () => {
		expect(container.querySelector('h1')?.textContent).toBe('欢迎回来')
		expect(button('使用账号密码登录').querySelector('svg[aria-hidden="true"]')).toBeTruthy()
		expect(button(strings.auth.email.continueEmail)).toBeTruthy()
		expect(container.querySelector('input[type="email"]')).toBeTruthy()
		const privacy = container.querySelector<HTMLAnchorElement>('a')!
		expect(privacy.textContent).toBe('隐私协议')
		expect(privacy.href).toBe('https://wenxue-d8gz76tacc3659f05-1427406869.tcloudbaseapp.com/')
		expect(privacy.parentElement?.textContent).toMatch(/继续.*隐私协议/)
		expect(container.textContent).not.toMatch(/手机号|用户名|Google|注册账号/)
	})

	it('opens the privacy link through the supplied desktop intent', async () => {
		const onOpenExternal = vi.fn()
		await renderScreen(onOpenExternal)
		const event = new MouseEvent('click', { bubbles: true, cancelable: true })
		await act(async () => container.querySelector('a')!.dispatchEvent(event))
		expect(event.defaultPrevented).toBe(true)
		expect(onOpenExternal).toHaveBeenCalledWith(
			'https://wenxue-d8gz76tacc3659f05-1427406869.tcloudbaseapp.com/',
		)
	})

	it('shows the form immediately when reduced motion is requested', () => {
		expect(container.querySelector('.auth-intro')).toBeNull()
		expect(container.querySelector('form')).toBeTruthy()
	})

	it('plays the 2100ms opening once and keeps it finished during internal navigation', async () => {
		await act(async () => root.unmount())
		vi.useFakeTimers()
		Object.assign(reducedMotion, { matches: false })
		root = createRoot(container)
		await renderScreen()
		expect(container.querySelector('.auth-intro')).toBeTruthy()
		expect(container.querySelector('form')).toBeNull()
		await act(async () => vi.advanceTimersByTime(2099))
		expect(container.querySelector('.auth-intro')).toBeTruthy()
		await act(async () => vi.advanceTimersByTime(1))
		expect(container.querySelector('.auth-intro')).toBeNull()
		expect(container.querySelector('h1')?.textContent).toBe(strings.auth.email.title)
		await click(strings.auth.email.passwordEntry)
		await click(strings.auth.email.backEmail)
		expect(container.querySelector('.auth-intro')).toBeNull()
		expect(container.querySelector('form')).toBeTruthy()
	})

	it('ends an opening animation immediately when reduced motion is enabled', async () => {
		await act(async () => root.unmount())
		vi.useFakeTimers()
		Object.assign(reducedMotion, { matches: false })
		root = createRoot(container)
		await renderScreen()
		expect(container.querySelector('.auth-intro')).toBeTruthy()
		await act(async () => {
			Object.assign(reducedMotion, { matches: true })
			reducedMotion.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
		})
		expect(container.querySelector('.auth-intro')).toBeNull()
		expect(container.querySelector('form')).toBeTruthy()
		await act(async () => {
			Object.assign(reducedMotion, { matches: false })
			reducedMotion.dispatchEvent(Object.assign(new Event('change'), { matches: false }))
			vi.advanceTimersByTime(2100)
		})
		expect(container.querySelector('.auth-intro')).toBeNull()
	})

	it('validates matching passwords before opening the optional profile step and creates the account only there', async () => {
		const { registration } = registrationFixture()
		await verifyEmail()
		expect(container.querySelector('h1')?.textContent).toBe(
			strings.auth.email.registerPasswordTitle,
		)
		expect(document.activeElement).toBe(container.querySelector('h1'))
		expect(container.querySelector('input[autocomplete="nickname"]')).toBeNull()
		expect(container.querySelector('input[type="file"]')).toBeNull()
		expect(registration.complete).not.toHaveBeenCalled()
		expect(onAuthenticated).not.toHaveBeenCalled()
		expect(button(strings.auth.email.next).disabled).toBe(true)
		await input('password', password)
		await input('confirmation', 'Different1!')
		await submit()
		expect(registration.complete).not.toHaveBeenCalled()
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			strings.auth.validation.passwordMismatch,
		)
		await input('confirmation', password)
		await submit()
		expect(container.querySelector('h1')?.textContent).toBe(strings.auth.email.registerTitle)
		expect(document.activeElement).toBe(container.querySelector('h1'))
		expect(container.querySelector('input[autocomplete="new-password"]')).toBeNull()
		expect(container.querySelector('input[type="email"]')).toBeNull()
		expect(registration.complete).not.toHaveBeenCalled()
		expect(onAuthenticated).not.toHaveBeenCalled()
		expect(button(strings.auth.email.completeRegistration).disabled).toBe(false)
		await input('nickname', '重复昵称')
		await submit()
		expect(registration.complete).toHaveBeenCalledWith({
			nickname: '重复昵称',
			password,
			avatar: undefined,
		})
		expect(onAuthenticated).toHaveBeenCalledWith(session)
	})

	it('shows masked per-character matching while keeping password visibility controls independent', async () => {
		registrationFixture()
		await verifyEmail()
		await input('password', password)
		await act(async () =>
			container.querySelector<HTMLInputElement>('input[id$="-confirmation"]')!.focus(),
		)
		await input('confirmation', 'Vx')
		const comparison = () => container.querySelector('.auth-password__comparison')!
		const characterStates = () =>
			Array.from(comparison().querySelectorAll('.auth-password__character')).map((character) =>
				character.getAttribute('data-state'),
			)
		expect(characterStates()).toEqual([
			'match',
			'mismatch',
			...Array(password.length - 2).fill('pending'),
		])
		expect(comparison().getAttribute('aria-hidden')).toBe('true')
		expect(comparison().textContent).toMatch(/^[•●·]+$/)
		expect(container.textContent).not.toContain(password)
		expect(container.textContent).toContain(strings.auth.hint.confirmation.mismatch(2))
		await input('confirmation', password.slice(0, 2))
		expect(characterStates()).toEqual([
			'match',
			'match',
			...Array(password.length - 2).fill('pending'),
		])
		expect(container.textContent).toContain(
			strings.auth.hint.confirmation.progress(2, password.length),
		)
		await click(strings.auth.action.showPassword)
		expect(container.querySelector<HTMLInputElement>('input[id$="-password"]')?.type).toBe('text')
		expect(container.querySelector<HTMLInputElement>('input[id$="-confirmation"]')?.type).toBe(
			'password',
		)
		expect(comparison().textContent).toBe(password)
		await click(strings.auth.action.showConfirmPassword)
		await click(strings.auth.action.hidePassword)
		expect(container.querySelector<HTMLInputElement>('input[id$="-password"]')?.type).toBe(
			'password',
		)
		expect(container.querySelector<HTMLInputElement>('input[id$="-confirmation"]')?.type).toBe(
			'text',
		)
		expect(comparison().textContent).toMatch(/^[•●·]+$/)
		await input('confirmation', password)
		expect(characterStates()).toEqual(Array(password.length).fill('match'))
		expect(container.textContent).toContain(strings.auth.hint.confirmation.matched)
	})

	it('submits the final profile only once while account completion is pending', async () => {
		const { registration } = registrationFixture()
		let resolve!: (value: LauncherAuthSession) => void
		registration.complete.mockReturnValue(
			new Promise((done) => {
				resolve = done
			}),
		)
		await verifyEmail()
		await enterProfile()
		await submit()
		await submit()
		expect(registration.complete).toHaveBeenCalledOnce()
		expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true')
		expect(button(strings.auth.email.previousStep).disabled).toBe(true)
		expect(onAuthenticated).not.toHaveBeenCalled()
		await act(async () => resolve(session))
		expect(onAuthenticated).toHaveBeenCalledOnce()
	})

	it.each(['', '   '])(
		'allows the service to generate a nickname when the draft is %j',
		async (nickname) => {
			const { registration } = registrationFixture()
			await verifyEmail()
			await enterProfile()
			expect(
				container.querySelector<HTMLInputElement>('input[autocomplete="nickname"]')?.required,
			).toBe(false)
			await input('nickname', nickname)
			expect(button(strings.auth.email.completeRegistration).disabled).toBe(false)
			await submit()
			expect(registration.complete).toHaveBeenCalledOnce()
			const profile = registration.complete.mock.calls[0][0]
			expect(profile.nickname.trim()).toBe('')
			expect(profile.password).toBe(password)
			expect(profile.avatar).toBeUndefined()
			expect(onAuthenticated).toHaveBeenCalledWith(session)
		},
	)

	it('keeps the verified registration and profile draft when returning to the password step', async () => {
		const { challenge, registration } = registrationFixture()
		await verifyEmail()
		await enterProfile()
		await input('nickname', '未完成用户')
		const avatar = await selectAvatar()
		await click(strings.auth.email.previousStep)
		expect(container.querySelector('h1')?.textContent).toBe(
			strings.auth.email.registerPasswordTitle,
		)
		expect(container.querySelector<HTMLInputElement>('input[id$="-password"]')?.value).toBe(
			password,
		)
		expect(container.querySelector<HTMLInputElement>('input[id$="-confirmation"]')?.value).toBe(
			password,
		)
		expect(registration.cancel).not.toHaveBeenCalled()
		expect(challenge.cancel).not.toHaveBeenCalled()
		expect(registration.complete).not.toHaveBeenCalled()
		const editedPassword = 'ChangedPass2!'
		await input('password', editedPassword)
		await input('confirmation', editedPassword)
		await submit()
		expect(container.querySelector<HTMLInputElement>('input[autocomplete="nickname"]')?.value).toBe(
			'未完成用户',
		)
		expect(container.querySelector<HTMLImageElement>('img[alt]')?.src).toBe('blob:avatar-preview')
		expect(auth.sendEmail).toHaveBeenCalledOnce()
		await submit()
		expect(registration.complete).toHaveBeenCalledWith({
			nickname: '未完成用户',
			password: editedPassword,
			avatar,
		})
	})

	it.each(['password', 'profile'] as const)(
		'discards verification and every draft when exiting the %s registration step',
		async (step) => {
			const { challenge, registration } = registrationFixture()
			await verifyEmail()
			await input('password', password)
			await input('confirmation', password)
			if (step === 'profile') {
				await submit()
				await input('nickname', '未完成用户')
				await selectAvatar()
			}
			await click(strings.auth.email.backEmail)
			expect(registration.cancel).toHaveBeenCalledOnce()
			expect(challenge.cancel).toHaveBeenCalledOnce()
			expect(registration.complete).not.toHaveBeenCalled()
			if (step === 'profile') {
				expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-preview')
			}
			registrationFixture()
			await verifyEmail()
			expect(auth.sendEmail).toHaveBeenCalledTimes(2)
			expect(container.querySelector<HTMLInputElement>('input[id$="-password"]')?.value).toBe('')
			expect(container.querySelector<HTMLInputElement>('input[id$="-confirmation"]')?.value).toBe(
				'',
			)
			await enterProfile()
			expect(
				container.querySelector<HTMLInputElement>('input[autocomplete="nickname"]')?.value,
			).toBe('')
			expect(container.querySelector('img[alt]')).toBeNull()
		},
	)

	it('logs an existing email in after code verification and supports the same email with a password', async () => {
		const { challenge } = registrationFixture()
		challenge.verify.mockResolvedValue({ kind: 'authenticated', session } as never)
		await verifyEmail()
		expect(onAuthenticated).toHaveBeenCalledWith(session)
		await click(strings.auth.email.backEmail)
		await click(strings.auth.email.passwordEntry)
		auth.login.mockResolvedValue(session)
		await input('password', password)
		await submit()
		expect(auth.login).toHaveBeenCalledWith(session.email, password)
		expect(onAuthenticated).toHaveBeenCalledTimes(2)
	})

	it('verifies a full email before resetting a password and returns to password login without signing in', async () => {
		const reset = {
			email: session.email!,
			expiresAt: Date.now() + 600_000,
			cancel: vi.fn(),
			complete: vi.fn().mockResolvedValue(undefined),
		}
		const challenge = {
			email: session.email!,
			expiresAt: Date.now() + 600_000,
			resendAt: Date.now() + 60_000,
			cancel: vi.fn(),
			verify: vi.fn().mockResolvedValue(reset),
		}
		auth.sendReset.mockResolvedValue(challenge)
		await click(strings.auth.email.passwordEntry)
		await click(strings.auth.email.forgotPassword)
		await input('email', session.email!)
		await submit()
		expect(auth.sendReset).toHaveBeenCalledWith(session.email)
		expect(reset.complete).not.toHaveBeenCalled()
		await input('code', '654321')
		await submit()
		await input('password', password)
		await input('confirmation', password)
		await submit()
		expect(reset.complete).toHaveBeenCalledWith(password)
		expect(onAuthenticated).not.toHaveBeenCalled()
		expect(container.querySelector('h1')?.textContent).toBe(strings.auth.email.passwordTitle)
		expect(container.querySelector('[role="status"]')?.textContent).toBe(
			strings.auth.email.resetSuccess,
		)
		expect(
			container.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')?.value,
		).toBe('')
	})

	it.each(['password', 'profile'] as const)(
		'expires the %s registration step without creating an account and offers restarting verification',
		async (step) => {
			vi.useFakeTimers()
			const { registration } = registrationFixture()
			registration.expiresAt = Date.now() + 1000
			await verifyEmail()
			if (step === 'profile') await enterProfile()
			await act(async () => vi.advanceTimersByTime(1000))
			expect(
				button(
					step === 'password' ? strings.auth.email.next : strings.auth.email.completeRegistration,
				).disabled,
			).toBe(true)
			expect(container.querySelector('[role="alert"]')?.textContent).toBe(
				strings.auth.emailErrors.expired,
			)
			await submit()
			expect(registration.complete).not.toHaveBeenCalled()
			await click(strings.auth.email.verifyAgain)
			expect(registration.cancel).toHaveBeenCalledOnce()
			expect(container.querySelector('h1')?.textContent).toBe(strings.auth.email.title)
		},
	)

	it('allows retrying avatar completion after account creation without editing the saved credentials', async () => {
		const { registration } = registrationFixture()
		registration.complete.mockImplementationOnce(async () => {
			registration.state = 'avatar-pending'
			registration.expiresAt = Date.now() - 1000
			throw new Error(strings.auth.emailErrors.avatarUpload)
		})
		await verifyEmail()
		await enterProfile()
		await input('nickname', '小问')
		const avatar = await selectAvatar()
		await submit()
		expect(
			container.querySelector<HTMLInputElement>('input[autocomplete="nickname"]')?.disabled,
		).toBe(true)
		expect(container.querySelector('input[autocomplete="new-password"]')).toBeNull()
		expect(container.textContent).not.toContain(strings.auth.email.previousStep)
		expect(button(strings.auth.email.completeRegistration).disabled).toBe(false)
		expect(container.textContent).toContain(strings.auth.email.avatarPendingDescription)
		expect(registration.complete).toHaveBeenLastCalledWith({ nickname: '小问', password, avatar })
		await click(strings.auth.email.avatarRemove)
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-preview')
		await submit()
		expect(registration.complete).toHaveBeenCalledTimes(2)
		expect(registration.complete).toHaveBeenLastCalledWith({
			nickname: '小问',
			password,
			avatar: undefined,
		})
		expect(onAuthenticated).toHaveBeenCalledWith(session)
	})

	it('offers retrying login confirmation after account creation without mistaking it for an avatar failure', async () => {
		const { registration } = registrationFixture()
		registration.complete.mockImplementationOnce(async () => {
			registration.state = 'confirming-account'
			registration.expiresAt = Date.now() - 1000
			throw new Error(strings.auth.emailErrors.activationRetry)
		})
		await verifyEmail()
		await enterProfile()
		await input('nickname', '小问')
		await submit()
		expect(container.textContent).toContain(strings.auth.email.accountCreatedDescription)
		expect(container.textContent).not.toContain(strings.auth.email.avatarPendingDescription)
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			strings.auth.emailErrors.activationRetry,
		)
		expect(
			container.querySelector<HTMLInputElement>('input[autocomplete="nickname"]')?.disabled,
		).toBe(true)
		expect(container.querySelector('input[autocomplete="new-password"]')).toBeNull()
		expect(container.textContent).not.toContain(strings.auth.email.previousStep)
		expect(button(strings.auth.email.retryAccountConfirmation).disabled).toBe(false)
		await click(strings.auth.email.retryAccountConfirmation)
		expect(registration.complete).toHaveBeenCalledTimes(2)
		expect(auth.sendEmail).toHaveBeenCalledOnce()
		expect(onAuthenticated).toHaveBeenCalledWith(session)
	})

	it('returns to password login and discards an unusable registration when confirmation requires signing in again', async () => {
		const { registration, challenge } = registrationFixture()
		registration.complete.mockImplementationOnce(async () => {
			registration.state = 'needs-login'
			registration.expiresAt = Infinity
			throw new Error(strings.auth.emailErrors.activationReauthenticate)
		})
		await verifyEmail()
		await enterProfile()
		await input('nickname', '小问')
		await submit()
		expect(container.querySelector('h1')?.textContent).toBe(strings.auth.email.passwordTitle)
		expect(container.querySelector('[role="status"]')?.textContent).toBe(
			strings.auth.emailErrors.activationReauthenticate,
		)
		expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(
			session.email,
		)
		expect(
			container.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')?.value,
		).toBe('')
		expect(container.textContent).not.toContain(strings.auth.email.avatarPendingDescription)
		expect(container.querySelector('input[type="file"]')).toBeNull()
		expect(registration.cancel).toHaveBeenCalledOnce()
		expect(challenge.cancel).toHaveBeenCalledOnce()
		expect(registration.complete).toHaveBeenCalledOnce()
		expect(onAuthenticated).not.toHaveBeenCalled()
		auth.login.mockResolvedValue(session)
		await input('password', password)
		await submit()
		expect(registration.complete).toHaveBeenCalledOnce()
		expect(auth.login).toHaveBeenCalledWith(session.email, password)
		expect(onAuthenticated).toHaveBeenCalledWith(session)
	})

	it('restarts email verification when signup is rejected without claiming an account was created', async () => {
		const { registration, challenge } = registrationFixture()
		registration.complete.mockImplementationOnce(async () => {
			registration.state = 'needs-verification'
			throw new Error(strings.auth.emailErrors.register)
		})
		await verifyEmail()
		await enterProfile()
		await input('nickname', '尚未创建的昵称')
		await submit()
		expect(container.querySelector('h1')?.textContent).toBe(strings.auth.email.title)
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			strings.auth.emailErrors.register,
		)
		expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(
			session.email,
		)
		expect(container.textContent).not.toContain('账号已创建')
		expect(container.querySelector('input[autocomplete="nickname"]')).toBeNull()
		expect(container.querySelector('input[autocomplete="new-password"]')).toBeNull()
		expect(registration.cancel).toHaveBeenCalledOnce()
		expect(challenge.cancel).toHaveBeenCalledOnce()
		expect(onAuthenticated).not.toHaveBeenCalled()
		registrationFixture()
		await verifyEmail()
		expect(auth.sendEmail).toHaveBeenCalledTimes(2)
		expect(
			container.querySelector<HTMLInputElement>('input[autocomplete="new-password"]')?.value,
		).toBe('')
		await enterProfile()
		expect(container.querySelector<HTMLInputElement>('input[autocomplete="nickname"]')?.value).toBe(
			'',
		)
		expect(registration.complete).toHaveBeenCalledOnce()
	})

	it('restores per-email cooldown across navigation and remount while password login remains available', async () => {
		vi.useFakeTimers()
		const retryAt = Date.now() + 60_000
		auth.resendAt.mockImplementation((email) =>
			email.trim().toLowerCase() === session.email ? retryAt : 0,
		)
		await input('email', session.email!)
		expect(button(strings.auth.email.resendCountdown(60)).disabled).toBe(true)
		await submit()
		expect(auth.sendEmail).not.toHaveBeenCalled()
		await click(strings.auth.email.passwordEntry)
		await input('password', password)
		expect(button(strings.auth.email.login).disabled).toBe(false)
		await click(strings.auth.email.forgotPassword)
		expect(button(strings.auth.email.resendCountdown(60)).disabled).toBe(true)
		await submit()
		expect(auth.sendReset).not.toHaveBeenCalled()
		await click(strings.auth.email.backPassword)
		await click(strings.auth.email.backEmail)
		expect(button(strings.auth.email.resendCountdown(60)).disabled).toBe(true)
		await input('email', 'different@example.com')
		expect(button(strings.auth.email.continueEmail).disabled).toBe(false)
		await act(async () => root.unmount())
		root = createRoot(container)
		await act(async () =>
			root.render(
				createElement(EmailAuthScreen, {
					error: null,
					frameless: false,
					onAuthenticated,
					onClearError: vi.fn(),
				}),
			),
		)
		await input('email', session.email!)
		expect(button(strings.auth.email.resendCountdown(60)).disabled).toBe(true)
		await act(async () => vi.advanceTimersByTime(60_000))
		expect(button(strings.auth.email.continueEmail).disabled).toBe(false)
	})

	it('keeps verification enabled during a send cooldown and carries that cooldown back to the email entry', async () => {
		vi.useFakeTimers()
		const { challenge } = registrationFixture()
		auth.sendEmail.mockImplementationOnce(async () => {
			auth.resendAt.mockImplementation((email) =>
				email === session.email ? challenge.resendAt : 0,
			)
			return challenge
		})
		await input('email', session.email!)
		await submit()
		await input('code', '123456')
		expect(button(strings.auth.email.verify).disabled).toBe(false)
		expect(button(strings.auth.email.resendCountdown(60)).disabled).toBe(true)
		await click(strings.auth.email.backEmail)
		expect(button(strings.auth.email.resendCountdown(60)).disabled).toBe(true)
		expect(auth.sendEmail).toHaveBeenCalledOnce()
	})

	it('returns to the email entry after a failed resend invalidates the old challenge', async () => {
		vi.useFakeTimers()
		registrationFixture()
		await input('email', session.email!)
		await submit()
		await input('code', '123456')
		await act(async () => vi.advanceTimersByTime(60_000))
		const retryAt = Date.now() + 180_000
		auth.sendEmail.mockImplementationOnce(async () => {
			auth.resendAt.mockReturnValue(retryAt)
			throw new LauncherEmailRateLimitError(retryAt, 'provider')
		})
		await click(strings.auth.email.resend)
		expect(button(strings.auth.email.resendCountdown(180)).disabled).toBe(true)
		expect(container.querySelector('h1')?.textContent).toBe(strings.auth.email.title)
		expect(container.querySelector('input[autocomplete="one-time-code"]')).toBeNull()
		expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(
			session.email,
		)
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			strings.auth.emailErrors.providerRateLimit,
		)
		expect(auth.sendEmail).toHaveBeenCalledTimes(2)
	})

	it.each(['email', 'reset-email'] as const)(
		'disables the %s send action after a provider limit without promising recovery',
		async (entry) => {
			vi.useFakeTimers()
			const retryAt = Date.now() + 60_000
			const send = entry === 'email' ? auth.sendEmail : auth.sendReset
			send.mockImplementationOnce(async () => {
				auth.resendAt.mockImplementation((email) => (email === session.email ? retryAt : 0))
				throw new LauncherEmailRateLimitError(retryAt, 'provider')
			})
			if (entry === 'reset-email') {
				await click(strings.auth.email.passwordEntry)
				await click(strings.auth.email.forgotPassword)
			}
			await input('email', session.email!)
			await submit()
			expect(container.querySelector('[role="alert"]')?.textContent).toBe(
				strings.auth.emailErrors.providerRateLimit,
			)
			expect(button(strings.auth.email.resendCountdown(60)).disabled).toBe(true)
			expect(container.textContent).not.toContain('秒后可重新发送')
			await submit()
			expect(send).toHaveBeenCalledOnce()
			await input('email', 'other@example.com')
			expect(container.querySelector('[role="alert"]')).toBeNull()
			expect(
				button(
					entry === 'email' ? strings.auth.email.continueEmail : strings.auth.email.sendResetCode,
				).disabled,
			).toBe(false)
		},
	)

	it('cancels temporary credentials when unmounted, including a challenge arriving after unmount', async () => {
		const { registration, challenge } = registrationFixture()
		await verifyEmail()
		await act(async () => root.unmount())
		expect(challenge.cancel).toHaveBeenCalledOnce()
		expect(registration.cancel).toHaveBeenCalledOnce()
		root = createRoot(container)
		await act(async () =>
			root.render(
				createElement(EmailAuthScreen, {
					error: null,
					frameless: false,
					onAuthenticated,
					onClearError: vi.fn(),
				}),
			),
		)
		let resolve!: (value: typeof challenge) => void
		auth.sendEmail.mockReturnValue(
			new Promise((done) => {
				resolve = done
			}),
		)
		await input('email', session.email!)
		await submit()
		await act(async () => root.unmount())
		await act(async () => resolve(challenge))
		expect(challenge.cancel).toHaveBeenCalledTimes(2)
		expect(onAuthenticated).not.toHaveBeenCalled()
		root = createRoot(container)
	})
})
