import { describe, expect, it, vi } from 'vitest'

import { openExtensionOptionsPage } from './extensionPages'

describe('openExtensionOptionsPage', () => {
	it('opens the packaged options page in an active tab', async () => {
		const api = {
			runtime: {
				getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
			},
			tabs: {
				create: vi.fn(async () => ({ id: 1 }) as chrome.tabs.Tab),
			},
		}

		await openExtensionOptionsPage(api)

		expect(api.runtime.getURL).toHaveBeenCalledWith('options.html')
		expect(api.tabs.create).toHaveBeenCalledWith({
			active: true,
			url: 'chrome-extension://test-id/options.html',
		})
	})
})
