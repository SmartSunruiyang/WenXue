import type {
	AdapterManifest,
	AdapterRef,
	NavigationProfile,
	QuestionPlatformAdapter,
} from './contracts'

export const PRODUCTION_VARIANT_IDS = [
	'chaoxing.modern_work_exam',
	'chaoxing.chapter_test',
	'zhs.gxk_work_exam',
	'zhs.xnk_work',
	'zhs.smart_work',
	'zhs.smart_exam',
	'zhs.fusioncourse_work',
	'zhs.hike_work',
	'zhs.hike_homework',
	'zjy.legacy_work_exam',
	'icve.standard_work_exam',
	'icve.ai_work',
	'icourse.chapter_test',
	'icourse.work',
	'icourse.exam',
	'unipus.reading_fill',
	'unipus.reading_choice',
	'unipus.normal_choice',
	'unipus.completion_translation',
	'unipus.banked_cloze_input',
	'unipus.banked_cloze_dropdown',
	'unipus.free_fill',
	'unipus.line_matching',
] as const

export type ProductionVariantId = (typeof PRODUCTION_VARIANT_IDS)[number]

export const GENERIC_VARIANT_ID = 'generic.standard_html' as const

export const PLATFORM_BY_VARIANT_PREFIX = {
	chaoxing: 'chaoxing',
	zhs: 'zhs',
	zjy: 'zjy',
	icve: 'icve',
	icourse: 'icourse',
	unipus: 'unipus',
	generic: 'generic',
} as const

export interface ManifestValidationIssue {
	code: string
	message: string
}

export class InvalidAdapterManifestError extends Error {
	readonly issues: ManifestValidationIssue[]

	constructor(ref: AdapterRef, issues: ManifestValidationIssue[]) {
		super(
			`Invalid question-solver adapter manifest ${formatRef(ref)}: ${issues.map((i) => i.code).join(', ')}`,
		)
		this.name = 'InvalidAdapterManifestError'
		this.issues = issues
	}
}

export function validateAdapterManifest(
	manifest: AdapterManifest,
	allManifests: readonly AdapterManifest[] = [manifest],
): ManifestValidationIssue[] {
	const issues: ManifestValidationIssue[] = []
	const variant = manifest.ref.variant
	const expectedPlatform = platformFromVariant(variant)

	if (!expectedPlatform || expectedPlatform !== manifest.ref.platform) {
		issues.push({
			code: 'platform_variant_mismatch',
			message: `Variant ${variant} does not belong to platform ${manifest.ref.platform}.`,
		})
	}
	if (!Number.isInteger(manifest.ref.version) || manifest.ref.version < 1) {
		issues.push({
			code: 'invalid_adapter_version',
			message: 'Adapter version must be a positive integer.',
		})
	}
	if (manifest.sourceAttribution.length === 0) {
		issues.push({
			code: 'missing_source_attribution',
			message: 'At least one MIT source attribution is required.',
		})
	}
	if (manifest.probe.hosts.length === 0 || manifest.probe.routePatternIds.length === 0) {
		issues.push({
			code: 'incomplete_probe',
			message: 'Probe hosts and routes must both be non-empty.',
		})
	}
	if (manifest.probe.requiredDomSignatures.length === 0) {
		issues.push({
			code: 'missing_dom_signature',
			message: 'Probe requires at least one DOM signature.',
		})
	}
	if (manifest.probe.minimumScore < 0.8 || manifest.probe.minimumScore > 1) {
		issues.push({
			code: 'invalid_probe_score',
			message: 'Known adapter score must be between 0.80 and 1.',
		})
	}
	if (manifest.maxModelConcurrency < 1 || !Number.isInteger(manifest.maxModelConcurrency)) {
		issues.push({
			code: 'invalid_model_concurrency',
			message: 'Model concurrency must be a positive integer.',
		})
	}
	if (!manifest.fill.exactState || manifest.fill.snapshot !== 'required') {
		issues.push({
			code: 'unsafe_fill_contract',
			message: 'All writers require exact state and a snapshot.',
		})
	}
	if (manifest.navigationProfiles.length === 0) {
		issues.push({
			code: 'missing_navigation_profile',
			message: 'At least one navigation profile is required.',
		})
	}

	const profileIds = new Set<string>()
	for (const profile of manifest.navigationProfiles) {
		validateNavigationProfile(manifest, profile, allManifests, issues)
		if (profileIds.has(profile.id)) {
			issues.push({
				code: 'duplicate_navigation_profile',
				message: `Duplicate profile ${profile.id}.`,
			})
		}
		profileIds.add(profile.id)
	}

	if (variant === 'chaoxing.modern_work_exam') {
		const expected = new Set(['chaoxing.modern.preview', 'chaoxing.modern.serial'])
		if (profileIds.size !== expected.size || [...expected].some((id) => !profileIds.has(id))) {
			issues.push({
				code: 'invalid_chaoxing_navigation_profiles',
				message: 'Chaoxing modern requires preview and serial profiles only.',
			})
		}
	} else if (profileIds.size !== 1 || !profileIds.has('default')) {
		issues.push({
			code: 'invalid_default_navigation_profile',
			message: `${variant} must expose exactly one default navigation profile.`,
		})
	}

	for (const projectionId of manifest.embedded.domProjectionIds) {
		if (isProductionVariant(variant) && /answer|correct|right/i.test(projectionId)) {
			issues.push({
				code: 'unverified_embedded_answer_projection',
				message: `Production projection ${projectionId} looks like an unverified correct-answer field.`,
			})
		}
	}

	return issues
}

export function assertValidAdapterManifests(adapters: readonly QuestionPlatformAdapter[]): void {
	const manifests = adapters.map((adapter) => adapter.manifest)
	const refs = new Set<string>()
	for (const manifest of manifests) {
		const key = formatRef(manifest.ref)
		if (refs.has(key)) {
			throw new InvalidAdapterManifestError(manifest.ref, [
				{ code: 'duplicate_adapter_ref', message: `Duplicate adapter ref ${key}.` },
			])
		}
		refs.add(key)
		const issues = validateAdapterManifest(manifest, manifests)
		if (issues.length > 0) throw new InvalidAdapterManifestError(manifest.ref, issues)
	}
}

export function assertProductionVariantCoverage(
	adapters: readonly QuestionPlatformAdapter[],
): void {
	const actual = new Set(adapters.map((adapter) => adapter.manifest.ref.variant))
	const missing = PRODUCTION_VARIANT_IDS.filter((variant) => !actual.has(variant))
	if (missing.length > 0)
		throw new Error(`Missing production question-solver adapters: ${missing.join(', ')}`)
	const extras = [...actual].filter(
		(variant) => variant !== GENERIC_VARIANT_ID && !isProductionVariant(variant),
	)
	if (extras.length > 0)
		throw new Error(`Unexpected production question-solver adapters: ${extras.join(', ')}`)
}

export function isProductionVariant(value: string): value is ProductionVariantId {
	return (PRODUCTION_VARIANT_IDS as readonly string[]).includes(value)
}

export function platformFromVariant(variant: string): string | null {
	const prefix = variant.split('.', 1)[0] as keyof typeof PLATFORM_BY_VARIANT_PREFIX
	return PLATFORM_BY_VARIANT_PREFIX[prefix] ?? null
}

function validateNavigationProfile(
	manifest: AdapterManifest,
	profile: NavigationProfile,
	allManifests: readonly AdapterManifest[],
	issues: ManifestValidationIssue[],
): void {
	if (profile.readOnly === 'next' && profile.advanceEffect !== 'none') {
		issues.push({
			code: 'unsafe_read_only_navigation',
			message: `Read-only profile ${profile.id} must have no save effect.`,
		})
	}
	if (profile.afterFill === 'none' && profile.nextSelectorId) {
		issues.push({
			code: 'orphan_next_selector',
			message: `Profile ${profile.id} has a next selector but afterFill is none.`,
		})
	}
	if (
		profile.nextSelectorId &&
		/submit|hand[_-]?in|finish[_-]?exam|final[_-]?confirm/i.test(profile.nextSelectorId)
	) {
		issues.push({
			code: 'final_submit_operation_forbidden',
			message: `Profile ${profile.id} references a final-submit-like selector.`,
		})
	}
	for (const nextVariant of profile.allowedNextVariants) {
		const target = allManifests.find((candidate) => candidate.ref.variant === nextVariant)
		if (!target) {
			issues.push({
				code: 'unknown_next_variant',
				message: `Profile ${profile.id} references unknown variant ${nextVariant}.`,
			})
		} else if (target.ref.platform !== manifest.ref.platform) {
			issues.push({
				code: 'cross_platform_navigation_forbidden',
				message: `Profile ${profile.id} crosses from ${manifest.ref.platform} to ${target.ref.platform}.`,
			})
		}
	}
}

function formatRef(ref: AdapterRef): string {
	return `${ref.platform}/${ref.variant}@${ref.version}`
}
