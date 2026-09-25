// @vitest-environment jsdom
import type { UpdateState } from '@wenxue/client-operations'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { LauncherAuthSession } from './cloudbase'
import type { DesktopAnnouncementSnapshot } from './DesktopAnnouncementService'
import { strings } from './strings'
import type { LauncherSettings, TokenUsageSummary, WindowClosePromptState } from './wenxue'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }))
vi.mock('./cloudbase', async (importOriginal) => ({
	...(await importOriginal<typeof import('./cloudbase')>()),
	getLauncherSession: mocks.getSession,
}))
vi.mock('./onboardingProgress', async (importOriginal) => ({
	...(await importOriginal<typeof import('./onboardingProgress')>()),
	hasOnboardingMedia: () => true,
}))
vi.mock('./DesktopAnnouncementService', () => ({
	DesktopAnnouncementService: class {
		start = async () => undefined
		stop = () => undefined
		current = () => null
		subscribe(listener: (snapshot: DesktopAnnouncementSnapshot) => void) {
			announcementListener = listener
			listener({ current: null, queueLength: 0 })
			return () => undefined
		}
	},
}))
vi.mock('./DesktopReleaseSignalService', () => ({
	DesktopReleaseSignalService: class {
		start = () => undefined
		stop = () => undefined
	},
}))

let announcementListener: (snapshot: DesktopAnnouncementSnapshot) => void
let updateListener: (state: UpdateState) => void
let closeListener: (state: WindowClosePromptState) => void
let sequence = 0
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
			onStateChange: (listener) => {
				updateListener = listener
				return () => undefined
			},
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
			respondToClosePrompt: vi.fn(success),
			onClosePromptChange: (listener) => {
				closeListener = listener
				return () => undefined
			},
		},
	}
}

function button(label: string, scope: ParentNode = document) {
	const result = Array.from(scope.querySelectorAll('button')).find(
		(item) => item.textContent === label || item.getAttribute('aria-label') === label,
	)
	if (!result) throw new Error(`Missing button: ${label}`)
	return result
}
async function click(label: string, scope?: ParentNode) {
	await act(async () => button(label, scope).click())
}
async function render() {
	await act(async () => root.render(createElement(App)))
}
beforeEach(() => {
	vi.resetAllMocks()
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	vi.stubGlobal('__WENXUE_UPDATE_CHANNEL__', 'stable')
	vi.stubGlobal('fetch', mocks.fetch)
	vi.stubGlobal(
		'matchMedia',
		vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }),
	)
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		},
	)
	vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
	vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
	const saved = new Map<string, string>()
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => saved.set(key, value),
	})
	session.userId = `onboarding-integration-${++sequence}`
	mocks.getSession.mockResolvedValue(session)
	window.wenxue = bridgeFixture()
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	expect(mocks.fetch).not.toHaveBeenCalled()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('App onboarding integration', () => {
	it('lets users close an unavailable-update warning while keeping its detail in About', async () => {
		await render()
		const warning = '此构建未固定更新签名公钥，更新检查不可用。'
		await act(async () => updateListener({ phase: 'error', message: warning, retryable: false }))
		expect(document.querySelector('.desktop-update-warning')?.textContent).toContain(warning)
		await click(strings.update.dismissWarning)
		expect(document.querySelector('.desktop-update-warning')).toBeNull()
		await act(async () => updateListener({ phase: 'error', message: warning, retryable: false }))
		expect(document.querySelector('.desktop-update-warning')).toBeNull()

		await click(strings.onboarding.skip)
		await click(strings.account.menuLabel)
		const menu = document.querySelector('[role="menu"]')!
		expect(menu.textContent).toContain('0.0.1beta')
		const aboutButton = Array.from(menu.querySelectorAll('button')).find((item) =>
			item.textContent?.startsWith(strings.settings.sections.about),
		)!
		await act(async () => aboutButton.click())
		expect(container.querySelector('.version-list')?.textContent).toContain('0.0.1beta')
		expect(container.querySelector('.settings-panel__note')?.textContent).toContain(warning)
	})

	it('opens the ready tutorial for a fresh account and returns to the account workspace on skip', async () => {
		await render()
		expect(container.querySelector('.onboarding-tour')).not.toBeNull()
		await click(strings.onboarding.skip)
		expect(container.querySelector('.onboarding-tour')).toBeNull()
		expect(container.querySelector<HTMLImageElement>('.avatar-button img')?.src).toBe(
			session.avatarUrl,
		)
		expect(window.localStorage.getItem(`wenxue:onboarding:v1:${session.userId}`)).toBe('skipped')
		await click(strings.account.menuLabel)
		await click(strings.settings.sections.account, document.querySelector('[role="menu"]')!)
		expect(container.querySelector('.account-settings')).not.toBeNull()
		await click(strings.settings.sections.about)
		await click(strings.onboarding.reopen)
		expect(container.querySelector('.onboarding-tour')).not.toBeNull()
	})

	it('pauses for announcements and updates, then unlocks tutorial controls once each is cleared', async () => {
		await render()
		const pause = vi.mocked(HTMLMediaElement.prototype.pause)
		pause.mockClear()
		await act(async () =>
			announcementListener({
				current: {
					id: 'notice',
					title: '消息',
					body: '正文',
					importance: 'normal',
					publishedAt: '2026-09-22T00:00:00.000Z',
					expiresAt: '2099-12-31T23:59:59.000Z',
				},
				queueLength: 1,
			}),
		)
		expect(pause).toHaveBeenCalled()
		expect(button(strings.onboarding.next).disabled).toBe(true)
		await act(async () => announcementListener({ current: null, queueLength: 0 }))
		expect(button(strings.onboarding.next).disabled).toBe(false)
		pause.mockClear()
		await act(async () =>
			updateListener({
				phase: 'available',
				release: {
					releaseId: 'electron-stable-0.1.1',
					version: '0.1.1',
					channel: 'stable',
					title: '新版本',
					notes: '更新说明',
					mode: 'optional',
					distribution: { mode: 'manual-unsigned' },
					size: 1024,
				},
			}),
		)
		expect(pause).toHaveBeenCalled()
		expect(button(strings.onboarding.next).disabled).toBe(true)
		await act(async () => updateListener({ phase: 'idle' }))
		expect(button(strings.onboarding.next).disabled).toBe(false)
	})

	it('keeps the close dialog available above the tutorial and resumes controls after cancellation', async () => {
		await render()
		const pause = vi.mocked(HTMLMediaElement.prototype.pause)
		pause.mockClear()
		await act(async () => closeListener({ requestId: 'close-onboarding', kind: 'confirm' }))
		const dialog = document.querySelector('[role="dialog"]')!
		expect(dialog.textContent).toContain(strings.windowClose.title)
		expect(dialog.contains(document.activeElement)).toBe(true)
		expect(pause).toHaveBeenCalled()
		expect(button(strings.onboarding.next).disabled).toBe(true)
		await click(strings.windowClose.cancel, dialog)
		expect(window.wenxue.app.respondToClosePrompt).toHaveBeenCalledWith(
			'close-onboarding',
			'cancel',
		)
		await act(async () => closeListener(null))
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(button(strings.onboarding.next).disabled).toBe(false)
	})
})
