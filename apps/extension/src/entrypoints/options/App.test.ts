import { describe, expect, it } from 'vitest'

import { SETTINGS_SECTIONS } from '@/components/SettingsForm'

import { SETTINGS_PAGE_VERSION, resolveActiveSettingsSection } from './App'

describe('options navigation', () => {
	it('selects the last section above the viewport focus line', () => {
		expect(
			resolveActiveSettingsSection({
				sectionTops: [
					['model', -80],
					['language', 240],
					['advanced', 620],
					['logs', 980],
					['about', 1380],
				],
				viewportHeight: 900,
				scrollY: 600,
				documentHeight: 2600,
			}),
		).toBe('model')
	})

	it('selects the final section when the page reaches the bottom', () => {
		expect(
			resolveActiveSettingsSection({
				sectionTops: [
					['model', -1300],
					['language', -900],
					['advanced', -520],
					['logs', -140],
					['about', 360],
				],
				viewportHeight: 900,
				scrollY: 1700,
				documentHeight: 2600,
			}),
		).toBe('about')
	})

	it('keeps about as the final settings destination', () => {
		expect(SETTINGS_SECTIONS.at(-1)?.id).toBe('about')
	})

	it('shows the requested public version', () => {
		expect(SETTINGS_PAGE_VERSION).toBe('v0.0.1')
	})
})
