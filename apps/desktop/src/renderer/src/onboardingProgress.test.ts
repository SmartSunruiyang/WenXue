import { describe, expect, it, vi } from 'vitest'
import {
	finishOnboarding,
	hasOnboardingMedia,
	ONBOARDING_VIDEO_SOURCES,
	shouldOfferOnboarding,
} from './onboardingProgress'

function storage() {
	const values = new Map<string, string>()
	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value)),
	}
}

describe('first-use onboarding progress', () => {
	it('requires every named recording before enabling the tutorial', () => {
		const complete = ONBOARDING_VIDEO_SOURCES.map((source) => `../public/${source}`)
		expect(hasOnboardingMedia([])).toBe(false)
		for (const missing of complete) {
			expect(hasOnboardingMedia(complete.filter((path) => path !== missing))).toBe(false)
		}
		expect(hasOnboardingMedia([...complete.slice(1), '../public/onboarding/other.mp4'])).toBe(false)
		expect(hasOnboardingMedia(complete)).toBe(true)
	})

	it('leaves progress untouched when recordings are missing and offers once they become available', () => {
		const saved = storage()
		expect(shouldOfferOnboarding('awaiting-media', 0, false, saved)).toBe(false)
		expect(shouldOfferOnboarding('existing-awaiting-media', 2, false, saved)).toBe(false)
		expect(saved.getItem).not.toHaveBeenCalled()
		expect(saved.setItem).not.toHaveBeenCalled()
		expect(shouldOfferOnboarding('awaiting-media', 0, true, saved)).toBe(true)
	})

	it('offers the tour to a new empty account and leaves interruptions unfinished', () => {
		const saved = storage()
		expect(shouldOfferOnboarding('new-account', 0, true, saved)).toBe(true)
		expect(shouldOfferOnboarding('new-account', 0, true, saved)).toBe(true)
		expect(saved.setItem).not.toHaveBeenCalled()
	})

	it.each(['completed', 'skipped'] as const)(
		'persists %s without affecting another account',
		(outcome) => {
			const saved = storage()
			const user = `account-${outcome}`
			expect(finishOnboarding(user, outcome, saved)).toBe(true)
			expect(saved.setItem).toHaveBeenCalledWith(`wenxue:onboarding:v1:${user}`, outcome)
			expect(shouldOfferOnboarding(user, 0, true, saved)).toBe(false)
			expect(shouldOfferOnboarding(`other-${outcome}`, 0, true, saved)).toBe(true)
		},
	)

	it('reads a saved choice after restarting without depending on profiles', () => {
		const saved = storage()
		saved.setItem('wenxue:onboarding:v1:restored-account', 'skipped')
		expect(shouldOfferOnboarding('restored-account', 0, true, saved)).toBe(false)
	})

	it('does not interrupt existing users even after they remove their last profile', () => {
		const saved = storage()
		expect(shouldOfferOnboarding('existing-account', 2, true, saved)).toBe(false)
		expect(saved.setItem).toHaveBeenCalledWith('wenxue:onboarding:v1:existing-account', 'existing')
		expect(shouldOfferOnboarding('existing-account', 0, true, saved)).toBe(false)
	})

	it('accepts an explicit dismissal for the session when browser storage is unavailable', () => {
		const unavailable = {
			getItem: () => {
				throw new Error('Storage unavailable')
			},
			setItem: () => {
				throw new Error('Quota exceeded')
			},
		}
		expect(shouldOfferOnboarding('blocked-storage', 0, true, unavailable)).toBe(true)
		expect(finishOnboarding('blocked-storage', 'skipped', unavailable)).toBe(false)
		expect(shouldOfferOnboarding('blocked-storage', 0, true, unavailable)).toBe(false)
	})

	it('ignores invalid persisted values', () => {
		const saved = storage()
		saved.setItem('wenxue:onboarding:v1:invalid-account', 'true')
		expect(shouldOfferOnboarding('invalid-account', 0, true, saved)).toBe(true)
	})
})
