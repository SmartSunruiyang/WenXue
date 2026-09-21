export type SiteRoute =
	| { page: 'home' }
	| { page: 'docs'; section: string; anchor?: string }
	| { page: 'privacy'; section: 'privacy-policy' | 'terms-of-use'; anchor?: string }

export function parseSiteRoute(hash: string): SiteRoute {
	const [page, section, anchor] = hash.replace(/^#\/?/, '').split('/')
	if (page === 'docs') {
		return { page, section: section || 'overview', anchor }
	}
	if (page === 'privacy') {
		return { page, section: section === 'terms-of-use' ? section : 'privacy-policy', anchor }
	}
	return { page: 'home' }
}
