// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { GENERIC_VARIANT_ID, PRODUCTION_VARIANT_IDS } from '../manifest'
import { createQuestionSolverAdapterRegistry } from './index'

describe('question solver production registry', () => {
	it('contains exactly 23 production variants plus the conservative generic fallback', () => {
		const registry = createQuestionSolverAdapterRegistry({
			getUrl: () => 'https://example.test/',
		})
		const variants = registry.adapters.map((adapter) => adapter.manifest.ref.variant)
		expect(variants.slice(0, -1)).toEqual(PRODUCTION_VARIANT_IDS)
		expect(variants.at(-1)).toBe(GENERIC_VARIANT_ID)
		expect(new Set(variants).size).toBe(24)
	})

	it('keeps every production adapter fixture-verified and answer projections empty', () => {
		const registry = createQuestionSolverAdapterRegistry({
			getUrl: () => 'https://example.test/',
		})
		for (const adapter of registry.adapters.slice(0, -1)) {
			expect(adapter.manifest.maturity).toBe('fixture_verified')
			expect(adapter.manifest.embedded.domProjectionIds).not.toEqual(
				expect.arrayContaining([expect.stringMatching(/answer|correct|right/i)]),
			)
		}
	})
})
