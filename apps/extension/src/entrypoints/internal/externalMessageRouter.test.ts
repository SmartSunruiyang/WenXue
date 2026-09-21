import { afterEach, describe, expect, it, vi } from 'vitest'

import { WENXUE_GATEWAY_BASE_URL } from '@/agent/constants'
import { WENXUE_USER_SESSION_KEY, type UserSessionStorageArea } from '@/lib/userSession'

import { createExternalMessageRouter } from './externalMessageRouter'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('createExternalMessageRouter', () => {
	it('closes only the localhost sender tab after a handoff', async () => {
		const dependencies = createDependencies()
		const sendResponse = vi.fn()
		const routeExternalMessage = createExternalMessageRouter(dependencies)

		expect(
			routeExternalMessage(
				{ type: 'WENXUE_USER_SESSION_HANDOFF_CLOSE' },
				localhostSender(17),
				sendResponse,
			),
		).toBe(true)

		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }))
		expect(dependencies.tabs.remove).toHaveBeenCalledOnce()
		expect(dependencies.tabs.remove).toHaveBeenCalledWith(17)
	})

	it('ignores a caller-provided tab ID and closes the sender tab', async () => {
		const dependencies = createDependencies()
		const sendResponse = vi.fn()
		const routeExternalMessage = createExternalMessageRouter(dependencies)

		routeExternalMessage(
			{ type: 'WENXUE_USER_SESSION_HANDOFF_CLOSE', tabId: 999 },
			localhostSender(23),
			sendResponse,
		)

		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }))
		expect(dependencies.tabs.remove).toHaveBeenCalledWith(23)
		expect(dependencies.tabs.remove).not.toHaveBeenCalledWith(999)
	})

	it('rejects a non-localhost handoff close request', () => {
		const dependencies = createDependencies()
		const sendResponse = vi.fn()
		const routeExternalMessage = createExternalMessageRouter(dependencies)

		expect(
			routeExternalMessage(
				{ type: 'WENXUE_USER_SESSION_HANDOFF_CLOSE' },
				{
					origin: 'https://attacker.example',
					tab: { id: 31 } as chrome.tabs.Tab,
				},
				sendResponse,
			),
		).toBeUndefined()
		expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized sender' })
		expect(dependencies.tabs.remove).not.toHaveBeenCalled()
	})

	it('responds safely when a handoff sender has no tab ID', () => {
		const dependencies = createDependencies()
		const sendResponse = vi.fn()
		const routeExternalMessage = createExternalMessageRouter(dependencies)

		expect(
			routeExternalMessage(
				{ type: 'WENXUE_USER_SESSION_HANDOFF_CLOSE' },
				{ origin: 'http://127.0.0.1:4312' },
				sendResponse,
			),
		).toBeUndefined()
		expect(sendResponse).toHaveBeenCalledWith({
			ok: false,
			error: 'Sender tab is unavailable',
		})
		expect(dependencies.tabs.remove).not.toHaveBeenCalled()
	})

	it('responds safely to unknown external messages', () => {
		const dependencies = createDependencies()
		const sendResponse = vi.fn()
		const routeExternalMessage = createExternalMessageRouter(dependencies)

		expect(
			routeExternalMessage({ type: 'UNKNOWN' }, localhostSender(41), sendResponse),
		).toBeUndefined()
		expect(sendResponse).toHaveBeenCalledWith({
			ok: false,
			error: 'Unsupported external message',
		})
		expect(dependencies.tabs.remove).not.toHaveBeenCalled()
	})

	it('preserves localhost session validation, storage, and response behavior', async () => {
		const dependencies = createDependencies()
		const sendResponse = vi.fn()
		const routeExternalMessage = createExternalMessageRouter(dependencies)
		const session = {
			userId: 'user-123',
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: 1_800_000_000_000,
			gatewayBaseUrl: WENXUE_GATEWAY_BASE_URL,
			browserId: 'browser-1',
		}

		expect(
			routeExternalMessage(
				{ type: 'WENXUE_USER_SESSION', session },
				localhostSender(47),
				sendResponse,
			),
		).toBe(true)

		await vi.waitFor(() =>
			expect(sendResponse).toHaveBeenCalledWith({ ok: true, userId: 'user-123' }),
		)
		expect(dependencies.storage.set).toHaveBeenCalledWith({
			[WENXUE_USER_SESSION_KEY]: session,
		})
		expect(dependencies.tabs.remove).not.toHaveBeenCalled()
	})

	it('preserves the localhost hub open-and-close flow', async () => {
		const dependencies = createDependencies()
		const sendResponse = vi.fn()
		const routeExternalMessage = createExternalMessageRouter(dependencies)

		expect(
			routeExternalMessage({ type: 'OPEN_HUB', wsPort: 9222 }, localhostSender(53), sendResponse),
		).toBe(true)

		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }))
		expect(dependencies.openOrFocusHubTab).toHaveBeenCalledWith(9222)
		expect(dependencies.tabs.remove).toHaveBeenCalledWith(53)
	})
})

function localhostSender(tabId: number): chrome.runtime.MessageSender {
	return {
		origin: 'http://localhost:4312',
		tab: { id: tabId } as chrome.tabs.Tab,
	}
}

function createDependencies() {
	const storage: UserSessionStorageArea = {
		get: vi.fn(async () => ({})),
		set: vi.fn(async () => {}),
		remove: vi.fn(async () => {}),
	}

	return {
		storage,
		tabs: {
			remove: vi.fn(async () => {}),
		},
		openOrFocusHubTab: vi.fn(async () => {}),
	}
}
