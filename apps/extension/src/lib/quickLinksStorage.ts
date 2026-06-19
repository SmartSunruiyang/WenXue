import type { ConfigStorageArea } from '@/lib/configStorage'
import { DEFAULT_QUICK_LINKS, normalizeQuickLinks, type QuickLink } from '@/lib/quickLinks'

const QUICK_LINKS_KEY = 'newtabQuickLinks'
const QUICK_LINKS_VERSION_KEY = 'newtabQuickLinksVersion'
const ONBOARDING_DONE_KEY = 'newtabOnboardingDone'
const QUICK_LINKS_VERSION = 'v0.0.1'

export async function loadQuickLinks(
	storage: ConfigStorageArea = chrome.storage.local,
): Promise<QuickLink[]> {
	const r = await storage.get([QUICK_LINKS_KEY, QUICK_LINKS_VERSION_KEY])
	if (r[QUICK_LINKS_VERSION_KEY] !== QUICK_LINKS_VERSION) {
		const fresh = DEFAULT_QUICK_LINKS.map((l) => ({ ...l }))
		await storage.set({ [QUICK_LINKS_KEY]: fresh, [QUICK_LINKS_VERSION_KEY]: QUICK_LINKS_VERSION })
		return fresh
	}
	return normalizeQuickLinks(r[QUICK_LINKS_KEY])
}

export async function saveQuickLinks(
	storage: ConfigStorageArea,
	list: QuickLink[],
): Promise<void> {
	await storage.set({ [QUICK_LINKS_KEY]: list, [QUICK_LINKS_VERSION_KEY]: QUICK_LINKS_VERSION })
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
