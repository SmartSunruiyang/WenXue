import type { AdapterManifest, QuestionPlatformAdapter, QuestionType } from '../contracts'
import {
	createDomQuestionAdapter,
	type DomAdapterEnvironment,
	type DomVariantDefinition,
} from './sharedDom'

export function createGenericQuestionAdapter(
	environment: Partial<DomAdapterEnvironment> = {},
): QuestionPlatformAdapter {
	return createDomQuestionAdapter(genericDefinition(), environment)
}

function genericDefinition(): DomVariantDefinition {
	return {
		manifest: genericManifest(),
		routeMatchers: [() => true],
		probeDom: hasConservativeQuestionMapping,
		questionRootSelectors: ['[data-question]', '.quiz-question', '.question', 'fieldset'],
		stemSelectors: ['[data-question-stem],.question-stem,.stem,legend,h1,h2,h3,h4,h5,h6'],
		optionSelectors: [
			'[data-option-key],.option,label:has(input[type="radio"]),label:has(input[type="checkbox"])',
		],
		blankSelectors: ['textarea,input[type="text"],[contenteditable="true"]'],
		detectType: detectGenericType,
		optionKey: (option, index) =>
			option.getAttribute('data-option-key') ||
			option.querySelector<HTMLInputElement>('input')?.value ||
			String.fromCharCode(65 + index),
	}
}

function genericManifest(): AdapterManifest {
	return {
		ref: { platform: 'generic', variant: 'generic.standard_html', version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [
			{
				license: 'MIT',
				path: 'ocsjs/ocsjs-4.0/packages/core/src/core/worker/worker.ts',
				symbols: ['OCSWorker'],
			},
		],
		probe: {
			hosts: ['*'],
			routePatternIds: ['generic.any_visible_document'],
			requiredDomSignatures: ['generic.explicit_stem', 'generic.standard_controls'],
			minimumScore: 0.85,
		},
		typeSupport: {
			single: 'inspect_answer_fill',
			multiple: 'inspect_answer_fill',
			judgement: 'inspect_answer_fill',
			completion: 'inspect_answer_fill',
		},
		maxModelConcurrency: 2,
		questionDelayMs: 0,
		readiness: { timeoutMs: 5_000, pollMs: 200, quietWindowMs: 200, requireNetworkQuiet: false },
		navigationProfiles: [
			{
				id: 'default',
				readOnly: 'none',
				afterFill: 'none',
				advanceEffect: 'none',
				allowedNextVariants: [],
			},
		],
		fill: {
			exactState: true,
			snapshot: 'required',
			saveEffect: 'draft_irreversible',
			visualControlVerification: true,
		},
		embedded: { domProjectionIds: [], runtimeOperationIds: [] },
	}
}

function hasConservativeQuestionMapping(doc: Document): boolean {
	const roots = Array.from(
		doc.querySelectorAll<HTMLElement>('[data-question],.quiz-question,.question,fieldset'),
	)
	return roots.some((root) => {
		const stem = root.querySelector(
			'[data-question-stem],.question-stem,.stem,legend,h1,h2,h3,h4,h5,h6',
		)
		const choices = root.querySelectorAll(
			'[data-option-key],label:has(input[type="radio"]),label:has(input[type="checkbox"])',
		).length
		const blanks = root.querySelectorAll(
			'textarea,input[type="text"],[contenteditable="true"]',
		).length
		return (
			Boolean(stem?.textContent?.trim() || stem?.querySelector('img')) &&
			(choices >= 2 || blanks > 0)
		)
	})
}

function detectGenericType(root: HTMLElement): QuestionType {
	const explicit = root.getAttribute('data-question-type')?.toLowerCase()
	if (explicit === 'multiple') return 'multiple'
	if (explicit === 'judgement' || explicit === 'judgment') return 'judgement'
	if (explicit === 'single') return 'single'
	if (explicit === 'completion') return 'completion'
	if (root.querySelector('input[type="checkbox"]')) return 'multiple'
	if (root.querySelector('input[type="radio"]')) return 'single'
	if (root.querySelector('textarea,input[type="text"],[contenteditable="true"]'))
		return 'completion'
	return 'unknown'
}
