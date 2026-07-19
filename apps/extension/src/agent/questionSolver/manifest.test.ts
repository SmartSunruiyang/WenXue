import { describe, expect, it } from 'vitest'

import type { AdapterManifest, NavigationProfile, QuestionPlatformAdapter } from './contracts'
import {
	assertProductionVariantCoverage,
	InvalidAdapterManifestError,
	PRODUCTION_VARIANT_IDS,
	validateAdapterManifest,
} from './manifest'
import { QuestionAdapterRegistry } from './registry'

describe('question-solver adapter manifests', () => {
	it('freezes exactly 23 production variants', () => {
		expect(PRODUCTION_VARIANT_IDS).toHaveLength(23)
		expect(new Set(PRODUCTION_VARIANT_IDS).size).toBe(23)
	})

	it('requires route-specific Chaoxing modern profiles', () => {
		const invalid = manifest('chaoxing.modern_work_exam', 'chaoxing', [defaultProfile()])
		expect(validateAdapterManifest(invalid)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'invalid_chaoxing_navigation_profiles' }),
			]),
		)

		const valid = manifest('chaoxing.modern_work_exam', 'chaoxing', [
			{ ...defaultProfile(), id: 'chaoxing.modern.preview' },
			{
				...defaultProfile(),
				id: 'chaoxing.modern.serial',
				afterFill: 'next',
				nextSelectorId: 'cx.next_question',
				allowedNextVariants: ['chaoxing.modern_work_exam'],
			},
		])
		expect(validateAdapterManifest(valid)).toEqual([])
	})

	it('rejects final-submit selectors and unverified answer projections', () => {
		const candidate = manifest('zhs.xnk_work', 'zhs', [
			{
				...defaultProfile(),
				afterFill: 'next',
				nextSelectorId: 'final_submit_exam',
				allowedNextVariants: ['zhs.xnk_work'],
			},
		])
		candidate.embedded.domProjectionIds = ['question.correctAnswer']
		const issues = validateAdapterManifest(candidate)
		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				'final_submit_operation_forbidden',
				'unverified_embedded_answer_projection',
			]),
		)
	})

	it('rejects cross-platform navigation and duplicate refs', () => {
		const zhs = manifest('zhs.xnk_work', 'zhs', [
			{ ...defaultProfile(), allowedNextVariants: ['icve.ai_work'] },
		])
		const icve = manifest('icve.ai_work', 'icve', [defaultProfile()])
		expect(validateAdapterManifest(zhs, [zhs, icve])).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'cross_platform_navigation_forbidden' }),
			]),
		)
		expect(() => new QuestionAdapterRegistry([adapter(icve), adapter(icve)])).toThrow(
			InvalidAdapterManifestError,
		)
	})

	it('fails coverage when any production adapter is missing', () => {
		expect(() => assertProductionVariantCoverage([])).toThrow('Missing production')
	})
})

function defaultProfile(): NavigationProfile {
	return {
		id: 'default',
		readOnly: 'none',
		afterFill: 'none',
		advanceEffect: 'none',
		allowedNextVariants: [],
	}
}

function manifest(
	variant: string,
	platform: string,
	navigationProfiles: NavigationProfile[],
): AdapterManifest {
	return {
		ref: { platform, variant, version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [{ license: 'MIT', path: 'ocsjs/projects/example.ts', symbols: ['worker'] }],
		probe: {
			hosts: ['example.test'],
			routePatternIds: [`${variant}.route`],
			requiredDomSignatures: [`${variant}.root`],
			minimumScore: 0.8,
		},
		typeSupport: { single: 'inspect_answer_fill' },
		maxModelConcurrency: 4,
		questionDelayMs: 0,
		readiness: {
			timeoutMs: 10_000,
			pollMs: 250,
			quietWindowMs: 0,
			requireNetworkQuiet: false,
		},
		navigationProfiles,
		fill: {
			exactState: true,
			snapshot: 'required',
			saveEffect: 'none',
			visualControlVerification: false,
		},
		embedded: { domProjectionIds: [], runtimeOperationIds: [] },
	}
}

function adapter(adapterManifest: AdapterManifest): QuestionPlatformAdapter {
	return { manifest: adapterManifest } as QuestionPlatformAdapter
}
