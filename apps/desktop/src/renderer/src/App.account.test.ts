// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { LauncherAuthSession, LauncherPublicUser } from './cloudbase'
import { toPublicUser } from './cloudbase'
import type {
	DesktopAnnouncementServiceOptions,
	DesktopAnnouncementSnapshot,
} from './DesktopAnnouncementService'
import { strings } from './strings'
import type { LauncherSettings, TokenUsageSummary } from './wenxue'

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	refreshSession: vi.fn(),
	updateProfile: vi.fn(),
	signOut: vi.fn(),
	safeSignOut: vi.fn(),
	announcementStart: vi.fn(),
	announcementStop: vi.fn(),
	announcementOptions: vi.fn(),
	releaseStart: vi.fn(),
	releaseStop: vi.fn(),
	releaseResume: vi.fn(),
	fetch: vi.fn(),
}))

vi.mock('./cloudbase', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./cloudbase')>()
	return {
		...actual,
		getLauncherSession: mocks.getSession,
		refreshLauncherSession: mocks.refreshSession,
		updateLauncherProfile: mocks.updateProfile,
		signOutLauncher: mocks.signOut,
	}
})

vi.mock('./safeSignOut', () => ({ executeSafeSignOut: mocks.safeSignOut }))

vi.mock('./DesktopAnnouncementService', () => ({
	DesktopAnnouncementService: class {
		constructor(options: DesktopAnnouncementServiceOptions) {
			mocks.announcementOptions(options)
		}
		start = mocks.announcementStart
		stop = mocks.announcementStop
		resume = async () => undefined
		current = () => null
		subscribe(listener: (snapshot: DesktopAnnouncementSnapshot) => void) {
			listener({ current: null, queueLength: 0 })
			return () => undefined
		}
	},
}))

vi.mock('./DesktopReleaseSignalService', () => ({
	DesktopReleaseSignalService: class {
		start = mocks.releaseStart
		stop = mocks.releaseStop
		resume = mocks.releaseResume
	},
}))

vi.mock('./EmailAuthScreen', () => ({
	EmailAuthScreen: ({
		onAuthenticated,
	}: {
		onAuthenticated: (session: LauncherAuthSession) => Promise<void>
	}) =>
		createElement(
			'button',
			{ type: 'button', onClick: () => void onAuthenticated(session) },
			'完成邮箱认证',
		),
}))

const session: LauncherAuthSession = {
	userId: 'account-1234567890',
	email: 'alice@example.com',
	nickname: '阿丽',
	avatarUrl: 'https://storage.example/registered-avatar.png',
	accessToken: 'test-access-token',
	refreshToken: 'test-refresh-token',
	expiresAt: 3600000,
	gatewayBaseUrl: 'https://gateway.example',
}

const settings: LauncherSettings = {
	launch: {
		windowWidth: 1280,
		windowHeight: 820,
		startUrl: 'chrome://newtab',
		concurrencyLimit: 3,
		staggerMs: 400,
		profileType: 'persistent',
		proxyMode: 'none',
		language: 'zh-CN',
		zoom: 100,
	},
	behavior: { closeAction: 'ask', exitWithBrowsers: 'ask', openAtLogin: false, downloadDir: '' },
	logs: {
		retentionDays: 3,
		maxEntries: 5000,
		minLevel: 'info',
		captureLlmRequests: true,
		captureLlmResponses: false,
		defaultExportFormat: 'json',
	},
	localUser: { displayName: '本地用户', colorKey: 'blue' },
}

const tokens: TokenUsageSummary = {
	totalInputTokens: 0,
	totalOutputTokens: 0,
	totalTokens: 0,
	estimatedCostCny: 0,
	byBrowser: [],
	byModel: [],
	daily: [],
	recent: [],
}

let root: Root
let container: HTMLDivElement

function bridgeFixture(): Window['wenxue'] {
	const success = async () => ({ ok: true })
	const unsubscribe = () => () => undefined
	return {
		browser: {
			launch: success,
			launchProfile: success,
			stopProfile: success,
			listProfiles: async () => [],
			addProfile: success,
			renameProfile: success,
			duplicateProfile: success,
			removeProfile: success,
			openProfileFolder: success,
			getStatus: async () => 'idle',
			getStatuses: async () => ({}),
			onStatusChange: unsubscribe,
			onProfileStatusChange: unsubscribe,
		},
		logs: { query: async () => [], clear: success },
		settings: { get: async () => settings, update: async () => ({ ok: true, settings }) },
		tokens: { getSummary: async () => tokens },
		auth: {
			setSession: vi.fn().mockResolvedValue({ ok: true }),
			getSession: success,
			prepareSignOut: vi.fn(success),
			cancelSignOut: vi.fn(success),
			clearSession: vi.fn(success),
		},
		updates: {
			getState: async () => ({ phase: 'idle' }),
			check: async () => ({ ok: true, state: { phase: 'idle' } }),
			download: async () => ({ ok: true, state: { phase: 'idle' } }),
			openInstaller: async () => ({ ok: true, state: { phase: 'idle' } }),
			restartInstall: async () => ({ ok: true, state: { phase: 'idle' } }),
			onStateChange: unsubscribe,
		},
		app: {
			getVersions: async () => ({
				app: '0.0.1-beta',
				browser: '137',
				extension: '0.0.1beta',
			}),
			getShellInfo: async () => ({
				platform: 'darwin',
				frameless: false,
				hasSystemTrafficLights: true,
				isMaximized: false,
			}),
			openLogs: success,
			openExternal: success,
			quit: success,
			minimizeWindow: success,
			toggleMaximizeWindow: success,
			requestClose: success,
			getClosePrompt: async () => null,
			respondToClosePrompt: success,
			onClosePromptChange: unsubscribe,
		},
	}
}

function button(label: string, scope: ParentNode = document) {
	const target = Array.from(scope.querySelectorAll('button')).find(
		(item) => item.textContent === label || item.getAttribute('aria-label') === label,
	)
	if (!target) throw new Error(`Missing button: ${label}`)
	return target
}

function homeAvatar() {
	const image = container.querySelector<HTMLImageElement>('.avatar-button img')
	if (!image) throw new Error('Home avatar is missing')
	return image
}

async function click(label: string, scope?: ParentNode) {
	await act(async () => {
		const target = button(label, scope)
		target.focus()
		target.click()
	})
}

async function render() {
	await act(async () => root.render(createElement(App)))
}

async function openAccount() {
	await click(strings.account.menuLabel)
	await click(strings.settings.sections.account, document.querySelector('[role="menu"]')!)
	expect(container.querySelector('.account-settings')).not.toBeNull()
}

async function editProfile() {
	const avatar = new File(['image'], 'updated.png', { type: 'image/png' })
	await act(async () => {
		const nickname = container.querySelector<HTMLInputElement>('input[autocomplete="nickname"]')!
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
			nickname,
			'新昵称',
		)
		nickname.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await act(async () => {
		const file = container.querySelector<HTMLInputElement>('input[type="file"]')!
		Object.defineProperty(file, 'files', { configurable: true, value: [avatar] })
		file.dispatchEvent(new Event('change', { bubbles: true }))
	})
	return avatar
}

beforeEach(() => {
	vi.resetAllMocks()
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	vi.stubGlobal('__WENXUE_UPDATE_CHANNEL__', 'stable')
	vi.stubGlobal('fetch', mocks.fetch)
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		},
	)
	vi.stubGlobal(
		'URL',
		class extends URL {
			static createObjectURL = vi.fn().mockReturnValue('blob:account-draft')
			static revokeObjectURL = vi.fn()
		},
	)
	mocks.getSession.mockResolvedValue(session)
	mocks.announcementStart.mockResolvedValue(undefined)
	mocks.safeSignOut.mockResolvedValue(undefined)
	window.wenxue = bridgeFixture()
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	expect(mocks.fetch).not.toHaveBeenCalled()
	vi.unstubAllGlobals()
})

describe('App account integration', () => {
	it('checks release policy when the launcher regains connectivity or focus without registering again', async () => {
		await render()
		const starts = mocks.releaseStart.mock.calls.length
		await act(async () => {
			window.dispatchEvent(new Event('online'))
			window.dispatchEvent(new Event('focus'))
			document.dispatchEvent(new Event('visibilitychange'))
		})
		expect(mocks.releaseResume).toHaveBeenCalledTimes(3)
		expect(mocks.releaseStart).toHaveBeenCalledTimes(starts)
	})

	it('keeps a fresh account usable and hides tutorial replay when recordings are missing', async () => {
		vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() })
		await render()
		expect(container.querySelector('.onboarding-tour')).toBeNull()
		expect(homeAvatar().src).toBe(session.avatarUrl)
		await openAccount()
		await click(strings.settings.sections.about)
		expect(container.textContent).not.toContain(strings.onboarding.reopen)
		expect(window.localStorage.setItem).not.toHaveBeenCalled()
	})

	it.each(['restored session', 'authentication callback'])(
		'%s supplies the same avatar to the home rail and account menu',
		async (entry) => {
			if (entry === 'authentication callback') mocks.getSession.mockResolvedValue(null)
			await render()
			if (entry === 'authentication callback') await click('完成邮箱认证')
			expect(window.wenxue.auth.setSession).toHaveBeenCalledWith(session)
			expect(homeAvatar().src).toBe(session.avatarUrl)
			await click(strings.account.menuLabel)
			const menu = document.querySelector('[role="menu"]')!
			expect(menu.querySelector('img')?.src).toBe(session.avatarUrl)
			expect(menu.querySelector('strong')?.textContent).toBe(session.nickname)
			expect(document.body.textContent).not.toContain(session.accessToken)
		},
	)

	it('saves my profile through the service and immediately updates both home and menu avatars', async () => {
		const updated = {
			...toPublicUser(session),
			nickname: '新昵称',
			avatarUrl: 'https://storage.example/updated.png',
		}
		mocks.updateProfile.mockResolvedValue(updated)
		await render()
		await openAccount()
		const avatar = await editProfile()
		expect(homeAvatar().src).toBe(session.avatarUrl)
		expect(mocks.updateProfile).not.toHaveBeenCalled()
		await click(strings.account.save)
		expect(mocks.updateProfile).toHaveBeenCalledWith({
			userId: session.userId,
			nickname: '新昵称',
			avatar,
		})
		expect(homeAvatar().src).toBe(updated.avatarUrl)
		expect(container.querySelector('.account-settings__avatar img')?.getAttribute('src')).toBe(
			updated.avatarUrl,
		)
		await click(strings.account.menuLabel)
		const menu = document.querySelector('[role="menu"]')!
		expect(menu.querySelector('strong')?.textContent).toBe('新昵称')
		expect(menu.querySelector('img')?.src).toBe(updated.avatarUrl)
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:account-draft')
	})

	it('disables logout in my settings and the account menu while saving', async () => {
		let finish!: (user: LauncherPublicUser) => void
		mocks.updateProfile.mockImplementation(
			() => new Promise<LauncherPublicUser>((resolve) => (finish = resolve)),
		)
		await render()
		await openAccount()
		await editProfile()
		await click(strings.account.save)
		expect(
			button(strings.account.logout, container.querySelector('.account-settings')!).disabled,
		).toBe(true)
		await click(strings.account.menuLabel)
		const logout = button(strings.dialog.logout.confirm, document.querySelector('[role="menu"]')!)
		expect(logout.disabled).toBe(true)
		await act(async () => logout.click())
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(mocks.safeSignOut).not.toHaveBeenCalled()
		await act(async () => finish({ ...toPublicUser(session), nickname: '新昵称' }))
	})

	it('cancels the custom logout confirmation without starting safe sign-out', async () => {
		await render()
		await click(strings.account.menuLabel)
		await click(strings.dialog.logout.confirm, document.querySelector('[role="menu"]')!)
		const dialog = document.querySelector('[role="dialog"]')!
		expect(dialog.textContent).toContain(strings.dialog.logout.description)
		expect(document.querySelector('[role="menu"]')).toBeNull()
		expect(mocks.safeSignOut).not.toHaveBeenCalled()
		await click(strings.dialog.actions.cancel, dialog)
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(mocks.safeSignOut).not.toHaveBeenCalled()
		expect(window.wenxue.auth.prepareSignOut).not.toHaveBeenCalled()
		expect(homeAvatar().src).toBe(session.avatarUrl)
	})

	it('still applies a successful profile save when logs are cleared on another route', async () => {
		let finish!: (user: LauncherPublicUser) => void
		mocks.updateProfile.mockImplementation(
			() => new Promise<LauncherPublicUser>((resolve) => (finish = resolve)),
		)
		vi.spyOn(window.wenxue.logs, 'query').mockResolvedValue([
			{
				id: 1,
				ts: 1000,
				level: 'info',
				source: 'system',
				context: 'background',
				browserId: 'browser-1',
				message: '浏览器已启动',
			},
		])
		const clearLogs = vi.spyOn(window.wenxue.logs, 'clear')
		await render()
		await openAccount()
		await editProfile()
		await click(strings.account.save)
		await click(strings.logs.title, container.querySelector('.sidebar-nav')!)
		await click(strings.logs.clear, container.querySelector('.page--logs')!)
		await click(strings.logs.clear, document.querySelector('[role="dialog"]')!)
		expect(clearLogs).toHaveBeenCalledOnce()
		const updated = {
			...toPublicUser(session),
			nickname: '新昵称',
			avatarUrl: 'https://storage.example/updated.png',
		}
		await act(async () => finish(updated))
		expect(homeAvatar().src).toBe(updated.avatarUrl)
		await click(strings.account.menuLabel)
		expect(document.querySelector('[role="menu"] strong')?.textContent).toBe(updated.nickname)
	})

	it('does not overwrite a saved profile with an older session refresh awaiting IPC', async () => {
		const updated = {
			...toPublicUser(session),
			nickname: '新昵称',
			avatarUrl: 'https://storage.example/updated.png',
		}
		mocks.updateProfile.mockResolvedValue(updated)
		mocks.refreshSession.mockResolvedValue(session)
		await render()
		await openAccount()
		let finishSync!: (result: { ok: boolean }) => void
		vi.mocked(window.wenxue.auth.setSession).mockImplementationOnce(
			() => new Promise((resolve) => (finishSync = resolve)),
		)
		const options = mocks.announcementOptions.mock.calls[0]![0] as DesktopAnnouncementServiceOptions
		let refreshRequest: ReturnType<NonNullable<DesktopAnnouncementServiceOptions['refreshSession']>>
		await act(async () => {
			refreshRequest = options.refreshSession!(session)
		})
		await editProfile()
		await click(strings.account.save)
		expect(homeAvatar().src).toBe(updated.avatarUrl)
		await act(async () => {
			finishSync({ ok: true })
			await refreshRequest
		})
		expect(homeAvatar().src).toBe(updated.avatarUrl)
		await click(strings.account.menuLabel)
		expect(document.querySelector('[role="menu"] strong')?.textContent).toBe(updated.nickname)
	})
})
