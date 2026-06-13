export interface QuickLink {
	id: string
	title: string
	url: string
	icon?: string
}

export const DEFAULT_QUICK_LINKS: QuickLink[] = [
	{ id: 'doc', title: '问学文档', url: 'https://alibaba.github.io/page-agent' },
	{ id: 'github', title: 'GitHub', url: 'https://github.com/alibaba/page-agent' },
	{ id: 'bing', title: '必应', url: 'https://www.bing.com' },
]

export function normalizeUrl(input: string): string | null {
	const trimmed = input.trim()
	if (!trimmed) return null
	const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
	try {
		const u = new URL(withProto)
		if (!u.hostname) return null
		return u.toString()
	} catch {
		return null
	}
}

function clampTitle(title: string): string {
	return title.trim().slice(0, 40)
}

export function normalizeQuickLinks(raw: unknown): QuickLink[] {
	if (!Array.isArray(raw)) return DEFAULT_QUICK_LINKS.map((l) => ({ ...l }))
	const out: QuickLink[] = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const rec = item as Record<string, unknown>
		const title = clampTitle(typeof rec.title === 'string' ? rec.title : '')
		const url = normalizeUrl(typeof rec.url === 'string' ? rec.url : '')
		if (!title || !url) continue
		out.push({
			id: typeof rec.id === 'string' ? rec.id : crypto.randomUUID(),
			title,
			url,
			icon: typeof rec.icon === 'string' && rec.icon.trim() ? rec.icon.trim() : undefined,
		})
	}
	return out
}

export function addQuickLink(
	list: QuickLink[],
	input: { title: string; url: string; icon?: string },
): QuickLink[] {
	const title = clampTitle(input.title)
	const url = normalizeUrl(input.url)
	if (!title || !url) return list
	return [...list, { id: crypto.randomUUID(), title, url, icon: input.icon?.trim() || undefined }]
}

export function updateQuickLink(
	list: QuickLink[],
	id: string,
	patch: { title?: string; url?: string; icon?: string },
): QuickLink[] {
	return list.map((link) => {
		if (link.id !== id) return link
		const next = { ...link }
		if (patch.title !== undefined) next.title = clampTitle(patch.title) || link.title
		if (patch.url !== undefined) next.url = normalizeUrl(patch.url) ?? link.url
		if (patch.icon !== undefined) next.icon = patch.icon.trim() || undefined
		return next
	})
}

export function removeQuickLink(list: QuickLink[], id: string): QuickLink[] {
	return list.filter((link) => link.id !== id)
}

export function reorderQuickLinks(list: QuickLink[], fromId: string, toIndex: number): QuickLink[] {
	const from = list.findIndex((l) => l.id === fromId)
	if (from === -1) return list
	const next = [...list]
	const [moved] = next.splice(from, 1)
	const clamped = Math.max(0, Math.min(toIndex, next.length))
	next.splice(clamped, 0, moved)
	return next
}
