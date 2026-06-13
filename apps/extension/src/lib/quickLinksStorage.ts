import type { ConfigStorageArea } from '@/lib/configStorage'
import { normalizeQuickLinks, type QuickLink } from '@/lib/quickLinks'

const QUICK_LINKS_KEY = 'newtabQuickLinks'
const ONBOARDING_DONE_KEY = 'newtabOnboardingDone'

export async function loadQuickLinks(
	storage: ConfigStorageArea = chrome.storage.local,
): Promise<QuickLink[]> {
	const r = await storage.get(QUICK_LINKS_KEY)
	return normalizeQuickLinks(r[QUICK_LINKS_KEY])
}

export async function saveQuickLinks(
	storage: ConfigStorageArea,
	list: QuickLink[],
): Promise<void> {
	await storage.set({ [QUICK_LINKS_KEY]: list })
}

export async function loadOnboardingDone(
	storage: ConfigStorageArea = chrome.storage.local,
): Promise<boolean> {
	const r = await storage.get(ONBOARDING_DONE_KEY)
	return r[ONBOARDING_DONE_KEY] === true
}

export async function saveOnboardingDone(
	storage: ConfigStorageArea,
	done: boolean,
): Promise<void> {
	await storage.set({ [ONBOARDING_DONE_KEY]: done })
}
