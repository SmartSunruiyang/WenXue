// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterContext, FixedMainWorldRuntime } from '../contracts'
import { PRODUCTION_VARIANT_IDS } from '../manifest'
import { createQuestionSolverAdapterRegistry } from '../platforms'
import { PRODUCTION_PLATFORM_FIXTURES } from './fixtures'

describe('production platform fixture matrix', () => {
	beforeEach(() => {
		document.body.innerHTML = ''
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(visibleRect())
	})

	afterEach(() => {
		document.body.innerHTML = ''
		vi.restoreAllMocks()
	})

	it('has exactly one source-attributed fixture for each production variant', () => {
		const variants = PRODUCTION_PLATFORM_FIXTURES.map((fixture) => fixture.variant)
		expect(variants).toEqual(PRODUCTION_VARIANT_IDS)
		expect(new Set(variants).size).toBe(PRODUCTION_VARIANT_IDS.length)

		for (const fixture of PRODUCTION_PLATFORM_FIXTURES) {
			document.body.innerHTML = fixture.html
			const adapter = createQuestionSolverAdapterRegistry({
				getUrl: () => fixture.url,
			}).getByVariant(fixture.variant)

			expect(adapter).toBeDefined()
			expect(fixture.sourceHeader.familyTest).toMatch(
				/^apps\/extension\/src\/agent\/questionSolver\/platforms\/.+\.test\.ts#/,
			)
			expect(fixture.sourceHeader.ocsjsPath).toMatch(/^ocsjs\/.+\.ts$/)
			expect(fixture.sourceHeader.ocsjsSymbols.length).toBeGreaterThan(0)
			expect(fixture.sourceHeader.selectors.length).toBeGreaterThan(0)
			for (const selector of fixture.sourceHeader.selectors) {
				expect(
					document.querySelector(selector),
					fixture.variant + ' source selector did not match: ' + selector,
				).not.toBeNull()
			}
			expect(adapter?.manifest.sourceAttribution).toEqual([
				{
					license: 'MIT',
					path: fixture.sourceHeader.ocsjsPath,
					symbols: [...fixture.sourceHeader.ocsjsSymbols],
				},
			])
		}
	})

	it.each(PRODUCTION_PLATFORM_FIXTURES)(
		'$variant uniquely probes its real registry adapter and extracts a visible question',
		async (fixture) => {
			document.body.innerHTML = fixture.html
			const registry = createQuestionSolverAdapterRegistry({
				getUrl: () => fixture.url,
			})
			const ctx = context('matrix-' + fixture.variant)
			const matches = await Promise.all(registry.adapters.map((adapter) => adapter.probe(ctx)))

			expect(matches.filter((match) => match.matched).map((match) => match.ref.variant)).toEqual([
				fixture.variant,
			])

			const adapter = registry.getByVariant(fixture.variant)
			expect(adapter).toBeDefined()
			expect(adapter?.manifest.maturity).toBe('fixture_verified')

			const questions = await adapter!.extract(ctx)
			expect(questions.length).toBeGreaterThan(0)
			expect(
				questions.some(
					(question) =>
						question.visibility === 'fully_visible' || question.visibility === 'partially_visible',
				),
			).toBe(true)
		},
	)

	it('reports fixture verification for all 23 variants and no live verification', () => {
		const registry = createQuestionSolverAdapterRegistry()
		const maturityTable = PRODUCTION_VARIANT_IDS.map((variant) => {
			const adapter = registry.getByVariant(variant)
			expect(adapter).toBeDefined()
			return { variant, maturity: adapter!.manifest.maturity }
		})

		expect(maturityTable).toEqual(
			PRODUCTION_VARIANT_IDS.map((variant) => ({
				variant,
				maturity: 'fixture_verified',
			})),
		)
		expect(maturityTable.filter((entry) => entry.maturity === 'live_verified')).toEqual([])
	})
})

function context(runId: string): AdapterContext {
	let anchor = 0
	return {
		identity: { taskId: 'platform-matrix', taskEpoch: 1, runId },
		frame: {
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'fixture-document',
			documentToken: 'fixture-token',
			urlFingerprint: 'fixture-url',
		},
		action: 'inspect',
		scope: 'current_page',
		signal: new AbortController().signal,
		mainWorld: {
			execute: vi
				.fn()
				.mockResolvedValue({ activeRequests: 0, lastNetworkAt: 0, lastMutationAt: 0 }),
		} as unknown as FixedMainWorldRuntime,
		anchors: { registerImage: () => 'fixture-anchor-' + ++anchor },
	}
}

function visibleRect(): DOMRect {
	return {
		x: 16,
		y: 16,
		top: 16,
		left: 16,
		width: 640,
		height: 240,
		right: 656,
		bottom: 256,
		toJSON: () => ({}),
	}
}
