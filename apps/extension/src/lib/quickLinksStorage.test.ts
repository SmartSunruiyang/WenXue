import { describe, expect, it } from 'vitest'

import type { ConfigStorageArea } from '@/lib/configStorage'
import { DEFAULT_QUICK_LINKS } from '@/lib/quickLinks'
import {
	loadOnboardingDone,
	loadQuickLinks,
	saveOnboardingDone,
	saveQuickLinks,
} from '@/lib/quickLinksStorage'

function fakeStorage(initial: Record<string, unknown> = {}): ConfigStorageArea {
	const data = { ...initial }
	return {
		async get(keys) {
			const list = Array.isArray(keys) ? keys : [keys]
			const out: Record<string, unknown> = {}
			for (const k of list) if (k in data) out[k] = data[k]
			return out
		},
		async set(values) {
			Object.assign(data, values)
		},
		async remove(key) {
			delete data[key]
		},
	}
}

describe('quickLinksStorage', () => {
	it('returns defaults when empty', async () => {
		expect(await loadQuickLinks(fakeStorage())).toEqual(DEFAULT_QUICK_LINKS)
	})
	it('round-trips a saved list', async () => {
		const s = fakeStorage()
		const list = [{ id: 'x', title: 'X', url: 'https://x.test/' }]
		await saveQuickLinks(s, list)
		expect(await loadQuickLinks(s)).toEqual(list)
	})
	it('onboarding flag defaults false and persists', async () => {
		const s = fakeStorage()
		expect(await loadOnboardingDone(s)).toBe(false)
		await saveOnboardingDone(s, true)
		expect(await loadOnboardingDone(s)).toBe(true)
	})
})
