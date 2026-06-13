import { describe, expect, it } from 'vitest'

import { decideMode, hasIntroPlayed, markIntroPlayed, type SessionFlagStore } from '@/lib/newtabMode'

function fakeSession(): SessionFlagStore {
	const m = new Map<string, string>()
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

describe('decideMode', () => {
	it('calm when reduced motion regardless of intro', () => {
		expect(decideMode({ introPlayed: false, reducedMotion: true })).toBe('calm')
	})
	it('intro on first session tab', () => {
		expect(decideMode({ introPlayed: false, reducedMotion: false })).toBe('intro')
	})
	it('calm after intro already played this session', () => {
		expect(decideMode({ introPlayed: true, reducedMotion: false })).toBe('calm')
	})
})

describe('session flag', () => {
	it('reads and marks', () => {
		const s = fakeSession()
		expect(hasIntroPlayed(s)).toBe(false)
		markIntroPlayed(s)
		expect(hasIntroPlayed(s)).toBe(true)
	})
})
