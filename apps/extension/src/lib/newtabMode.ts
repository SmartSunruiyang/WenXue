export type NewTabMode = 'intro' | 'calm'

const SESSION_KEY = 'introPlayedThisSession'

export function decideMode(opts: { introPlayed: boolean; reducedMotion: boolean }): NewTabMode {
	if (opts.reducedMotion) return 'calm'
	return opts.introPlayed ? 'calm' : 'intro'
}

export interface SessionFlagStore {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
}

export function hasIntroPlayed(session: SessionFlagStore = sessionStorage): boolean {
	return session.getItem(SESSION_KEY) === '1'
}

export function markIntroPlayed(session: SessionFlagStore = sessionStorage): void {
	session.setItem(SESSION_KEY, '1')
}

export function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
