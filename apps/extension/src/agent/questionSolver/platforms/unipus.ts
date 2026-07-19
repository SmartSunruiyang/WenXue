import type {
	AdapterManifest,
	ControlTransactionRef,
	ControlValue,
	Question,
	QuestionPlatformAdapter,
	QuestionType,
	StructuredAnswer,
} from '../contracts'
import {
	createDomQuestionAdapter,
	isVisibleElement,
	type DomAdapterEnvironment,
	type DomVariantDefinition,
} from './sharedDom'

export const UNIPUS_HOSTS = ['unipus.cn'] as const

export const UNIPUS_VARIANTS = [
	'unipus.reading_fill',
	'unipus.reading_choice',
	'unipus.normal_choice',
	'unipus.completion_translation',
	'unipus.banked_cloze_input',
	'unipus.banked_cloze_dropdown',
	'unipus.free_fill',
	'unipus.line_matching',
] as const

export function createUnipusAdapters(
	environment: Partial<DomAdapterEnvironment> = {},
): QuestionPlatformAdapter[] {
	return definitions().map((definition) => createDomQuestionAdapter(definition, environment))
}

function definitions(): DomVariantDefinition[] {
	const textHooks = controlledInputHooks()
	return [
		{
			manifest: unipusManifest(
				'unipus.reading_fill',
				['unipus.reading_fill.material_reply'],
				['doUnderstandingText'],
				{ completion: 'inspect_answer_fill' },
				true,
			),
			routeMatchers: [unipusRoute],
			probeDom: (doc) =>
				Boolean(
					doc.querySelector('.layout-material-container') &&
					doc.querySelector('.question-common-abs-reply textarea') &&
					!doc.querySelector('.layout-reply-container .full'),
				),
			questionRootSelectors: ['.question-common-abs-reply'],
			stemSelectors: ['.question-inputbox-header'],
			materialSelectors: ['.layout-material-container'],
			materialScope: 'document',
			blankSelectors: ['.question-inputbox-body textarea,textarea'],
			detectType: () => 'completion',
			findNextControl: findUnipusNext,
			...textHooks,
		},
		{
			manifest: unipusManifest(
				'unipus.reading_choice',
				['unipus.reading_choice.material_reply_option'],
				['doReading'],
				choiceTypes(),
				true,
			),
			routeMatchers: [unipusRoute],
			probeDom: (doc) =>
				Boolean(
					doc.querySelector('.layout-material-container') &&
					doc.querySelector('.layout-reply-container .option-wrap') &&
					doc.querySelector('.question-common-abs-choice'),
				),
			questionRootSelectors: ['.question-common-abs-choice'],
			stemSelectors: ['.ques-title'],
			materialSelectors: ['.layout-material-container'],
			materialScope: 'document',
			optionSelectors: ['.option-wrap .option'],
			optionContentSelectors: ['.content'],
			detectType: detectChoiceType,
			optionKey: unipusOptionKey,
			findNextControl: findUnipusNext,
		},
		{
			manifest: unipusManifest(
				'unipus.normal_choice',
				['unipus.normal_choice.reply_option'],
				['doChoice'],
				choiceTypes(),
				true,
			),
			routeMatchers: [unipusRoute],
			probeDom: (doc) =>
				Boolean(
					!doc.querySelector('.layout-material-container') &&
					doc.querySelector('.layout-reply-container .option-wrap') &&
					doc.querySelector('.question-common-abs-choice'),
				),
			questionRootSelectors: ['.question-common-abs-choice'],
			stemSelectors: ['.ques-title'],
			optionSelectors: ['.option-wrap .option'],
			optionContentSelectors: ['.content'],
			detectType: detectChoiceType,
			optionKey: unipusOptionKey,
			findNextControl: findUnipusNext,
		},
		{
			manifest: unipusManifest(
				'unipus.completion_translation',
				['unipus.completion_translation.full_textarea'],
				['job', 'doCompletion'],
				{ completion: 'inspect_answer_fill', translation: 'inspect_answer_fill' },
				true,
			),
			routeMatchers: [unipusRoute],
			probeDom: (doc) =>
				Boolean(
					doc.querySelector('.layout-reply-container .full') &&
					doc.querySelector('.question-common-abs-reply textarea'),
				),
			questionRootSelectors: ['.question-common-abs-reply'],
			stemSelectors: ['.question-inputbox-header'],
			materialSelectors: ['.layout-material-container'],
			materialScope: 'document',
			blankSelectors: ['.question-inputbox-body textarea,textarea'],
			detectType: (root) => (/翻译/.test(root.textContent ?? '') ? 'translation' : 'completion'),
			findNextControl: findUnipusNext,
			...textHooks,
		},
		{
			manifest: unipusManifest(
				'unipus.banked_cloze_input',
				['unipus.banked_cloze.input'],
				['job', 'singleQuestionHandle'],
				{ completion: 'inspect_answer_fill' },
				true,
			),
			routeMatchers: [unipusRoute],
			probeDom: (doc) =>
				Boolean(
					doc.querySelector('.question-material-banked-cloze-reply .input-wrapper input') &&
					doc.querySelector('.option-wrapper .option,.option-placeholder'),
				),
			questionRootSelectors: ['.question-material-banked-cloze-reply'],
			stemSelectors: ['.question-wrap,.question-title'],
			materialSelectors: [
				'.question-material-banked-cloze-scoop,.option-wrapper .option,.option-placeholder',
			],
			materialScope: 'document',
			blankSelectors: ['.question-wrap .input-wrapper input,.input-wrapper input'],
			detectType: () => 'completion',
			findNextControl: findUnipusNext,
			...textHooks,
		},
		{
			manifest: unipusManifest(
				'unipus.banked_cloze_dropdown',
				['unipus.banked_cloze.dropdown'],
				['job', 'singleQuestionHandle'],
				{ dropdown: 'inspect_answer_fill' },
				true,
			),
			routeMatchers: [unipusRoute],
			probeDom: (doc) =>
				Boolean(
					doc.querySelector('.input-wrapper .ant-dropdown-trigger') &&
					doc.querySelector('.scoop-select-wrapper'),
				),
			questionRootSelectors: ['.question-wrap:has(.scoop-select-wrapper)'],
			stemSelectors: ['.question-title,.abs-direction'],
			materialSelectors: ['.scoop-select-wrapper i,.option-wrapper'],
			optionSelectors: ['.scoop-select-wrapper [data-option-key]'],
			optionKey: unipusOptionKey,
			blankSelectors: ['.scoop-select-wrapper'],
			detectType: () => 'dropdown',
			readControlValue: readDropdownControl,
			writeAnswer: writeDropdownAnswer,
			restoreControlValue: restoreDropdownControl,
			findNextControl: findUnipusNext,
		},
		{
			manifest: unipusManifest(
				'unipus.free_fill',
				['unipus.free_fill.scoop_input'],
				['job', 'singleQuestionHandle'],
				{ completion: 'inspect_answer_fill' },
				true,
			),
			routeMatchers: [unipusRoute],
			probeDom: (doc) => Boolean(doc.querySelector('.fe-scoop .scoop-input-wrapper input')),
			questionRootSelectors: ['.layout-reply-container:has(.fe-scoop .scoop-input-wrapper)'],
			stemSelectors: ['.question-title,.abs-direction,.question-inputbox-header'],
			materialSelectors: ['.layout-material-container'],
			materialScope: 'document',
			blankSelectors: ['.fe-scoop .scoop-input-wrapper input'],
			detectType: () => 'completion',
			findNextControl: findUnipusNext,
			...textHooks,
		},
		{
			manifest: unipusManifest(
				'unipus.line_matching',
				['unipus.line_matching.sequence'],
				['job', 'singleQuestionHandle'],
				{ line: 'inspect_answer_fill' },
				false,
			),
			routeMatchers: [unipusRoute],
			probeDom: (doc) => Boolean(doc.querySelector('.sequence-reply-view-item-text')),
			questionRootSelectors: ['.question-wrap:has(.sequence-reply-view-item-text)'],
			stemSelectors: ['.sequence-view,.abs-direction'],
			subQuestions: {
				line: {
					containerSelectors: ['.sequence-reply-view-item-text'],
					optionSelectors: ['.sequence-reply-view-item-text'],
					optionScope: 'root',
					sortOptionsByKey: true,
					platformQuestionIdAttributes: [],
					type: 'single',
					optionKey: unipusLineItemKey,
				},
			},
			lineItemSelectors: ['.sequence-reply-view-item-text'],
			detectType: () => 'line',
		},
	]
}

function unipusManifest(
	variant: (typeof UNIPUS_VARIANTS)[number],
	routes: string[],
	symbols: string[],
	typeSupport: AdapterManifest['typeSupport'],
	hasNext: boolean,
): AdapterManifest {
	return {
		ref: { platform: 'unipus', variant, version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [
			{
				license: 'MIT',
				path: 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/unipus/exploration.ts',
				symbols,
			},
		],
		probe: {
			hosts: [...UNIPUS_HOSTS],
			routePatternIds: routes,
			requiredDomSignatures: routes,
			minimumScore: 0.8,
		},
		typeSupport,
		maxModelConcurrency: 1,
		questionDelayMs: 100,
		readiness: { timeoutMs: 10_000, pollMs: 200, quietWindowMs: 250, requireNetworkQuiet: false },
		navigationProfiles: [
			{
				id: 'default',
				readOnly: 'none',
				afterFill: hasNext ? 'next' : 'none',
				advanceEffect: hasNext ? 'draft_irreversible' : 'none',
				...(hasNext ? { nextSelectorId: 'resolver:unipus.u_next_exact_text' } : {}),
				allowedNextVariants: hasNext ? [...UNIPUS_VARIANTS] : [],
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

function unipusRoute(url: URL): boolean {
	return url.pathname.endsWith('/_explorationpc_default/pc.html')
}

function choiceTypes(): AdapterManifest['typeSupport'] {
	return { single: 'inspect_answer_fill', multiple: 'inspect_answer_fill' }
}

function detectChoiceType(root: HTMLElement): QuestionType {
	if (
		root.querySelector('input[type="checkbox"]') ||
		/多选/.test(root.querySelector('.ques-title')?.textContent ?? '')
	)
		return 'multiple'
	return 'single'
}

function unipusOptionKey(option: HTMLElement, index: number): string {
	return (
		option.getAttribute('data-option-key') ||
		option.querySelector<HTMLInputElement>('input')?.value ||
		/^\s*([A-Za-z])\s*[.、:：)）]/.exec(option.textContent ?? '')?.[1]?.toUpperCase() ||
		String.fromCharCode(65 + index)
	)
}

function unipusLineItemKey(option: HTMLElement, index: number): string {
	return option.getAttribute('data-id') || String(index + 1)
}

function findUnipusNext(doc: Document): HTMLElement | null {
	const matches = Array.from(doc.querySelectorAll<HTMLElement>('button,[role="button"]')).filter(
		(button) => isVisibleElement(button) && normalize(button.textContent) === '下一题',
	)
	return matches.length === 1 ? matches[0] : null
}

function controlledInputHooks(): Pick<DomVariantDefinition, 'afterWrite' | 'afterRestore'> {
	return {
		afterWrite: async (_root, answer, ctx, transaction) => {
			if (!answer.blanks) return
			await executeControlledInput(ctx, transaction, answer.questionFingerprint, answer.blanks)
		},
		afterRestore: async (_root, value, ctx, transaction) => {
			if (value.kind !== 'text') return
			await executeControlledInput(
				ctx,
				transaction,
				value.questionFingerprint,
				value.values.map((entry) => ({ key: entry.blankKey, value: entry.value })),
			)
		},
	}
}

async function executeControlledInput(
	ctx: Parameters<NonNullable<DomVariantDefinition['afterWrite']>>[2],
	transaction: ControlTransactionRef,
	questionFingerprint: string,
	values: Array<{ key: string; value: string }>,
): Promise<void> {
	await ctx.mainWorld.execute(
		'unipus.controlled_input_set',
		{ questionFingerprint, values },
		{ ...transaction, questionFingerprint },
	)
}

function readDropdownControl(root: HTMLElement, question: Question): ControlValue {
	return {
		kind: 'dropdown',
		questionFingerprint: question.locator.fingerprint,
		values: dropdownContainers(root).map((container, index) => ({
			blankKey: blankKey(container, index),
			optionKey: selectedDropdownKey(container),
		})),
	}
}

function writeDropdownAnswer(root: HTMLElement, answer: StructuredAnswer): boolean {
	if (!answer.dropdowns) return false
	const desired = new Map(answer.dropdowns.map((entry) => [entry.key, entry.optionKey]))
	const containers = dropdownContainers(root)
	let allResolved = containers.length > 0
	for (const [index, container] of containers.entries()) {
		const optionKey = desired.get(blankKey(container, index))
		if (optionKey === undefined) {
			allResolved = false
			continue
		}
		if (selectedDropdownKey(container) === optionKey) continue
		const native = container.querySelector<HTMLSelectElement>('select')
		if (native) {
			native.value = optionKey
			native.dispatchEvent(new Event('input', { bubbles: true }))
			native.dispatchEvent(new Event('change', { bubbles: true }))
			continue
		}
		const trigger = container.querySelector<HTMLElement>('.ant-dropdown-trigger,[role="combobox"]')
		const visibleGlobalBefore = new Set(globalDropdownOptions(root.ownerDocument, optionKey))
		trigger?.click()
		const option = resolveDropdownOption(root, container, trigger, optionKey, visibleGlobalBefore)
		if (!option) {
			allResolved = false
			continue
		}
		option.click()
	}
	return allResolved
}

function resolveDropdownOption(
	root: HTMLElement,
	container: HTMLElement,
	trigger: HTMLElement | null,
	optionKey: string,
	visibleGlobalBefore: ReadonlySet<HTMLElement>,
): HTMLElement | null {
	const escaped = escapeAttribute(optionKey)
	const local = Array.from(
		container.querySelectorAll<HTMLElement>(
			`[data-option-key="${escaped}"],[data-value="${escaped}"]`,
		),
	).filter(isVisibleElement)
	if (local.length > 0) return local.length === 1 ? local[0] : null

	const popupIds = [trigger?.getAttribute('aria-controls'), trigger?.getAttribute('aria-owns')]
		.flatMap((value) => value?.split(/\s+/) ?? [])
		.filter(Boolean)
	const popupRoots = popupIds
		.map((id) => root.ownerDocument.getElementById(id))
		.filter((element): element is HTMLElement => element instanceof HTMLElement)
	const selector = `.ant-dropdown-menu-item[data-option-key="${escaped}"],.ant-dropdown-menu-item[data-value="${escaped}"]`
	const bound = popupRoots
		.flatMap((popup) => Array.from(popup.querySelectorAll<HTMLElement>(selector)))
		.filter(isVisibleElement)
	if (popupIds.length > 0) return bound.length === 1 ? bound[0] : null

	const newlyVisible = globalDropdownOptions(root.ownerDocument, optionKey).filter(
		(option) => !visibleGlobalBefore.has(option),
	)
	return newlyVisible.length === 1 ? newlyVisible[0] : null
}

function globalDropdownOptions(doc: Document, optionKey: string): HTMLElement[] {
	const escaped = escapeAttribute(optionKey)
	return Array.from(
		doc.querySelectorAll<HTMLElement>(
			`.ant-dropdown-menu-item[data-option-key="${escaped}"],.ant-dropdown-menu-item[data-value="${escaped}"]`,
		),
	).filter(isVisibleElement)
}

function restoreDropdownControl(root: HTMLElement, value: ControlValue): boolean {
	if (value.kind !== 'dropdown') return false
	return writeDropdownAnswer(root, {
		questionFingerprint: value.questionFingerprint,
		type: 'dropdown',
		dropdowns: value.values.map((entry) => ({
			key: entry.blankKey,
			optionKey: entry.optionKey,
		})),
		evidence: {
			source: 'visible_solution',
			questionFingerprint: value.questionFingerprint,
			mappingConfidence: 1,
			warnings: [],
		},
	})
}

function dropdownContainers(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>('.scoop-select-wrapper'))
}

function blankKey(container: HTMLElement, index: number): string {
	return (
		container.getAttribute('data-blank-key') || container.getAttribute('id') || String(index + 1)
	)
}

function selectedDropdownKey(container: HTMLElement): string {
	return (
		container.getAttribute('data-selected-key') ||
		container.querySelector<HTMLSelectElement>('select')?.value ||
		container
			.querySelector<HTMLElement>('.ant-dropdown-trigger,[role="combobox"]')
			?.getAttribute('data-value') ||
		container
			.querySelector<HTMLElement>('[aria-selected="true"],[class*="selected"]')
			?.getAttribute('data-option-key') ||
		''
	)
}

function normalize(value: string | null | undefined): string {
	return (value ?? '').replace(/\s+/g, '').trim()
}

function escapeAttribute(value: string): string {
	return value.replace(/["\\]/g, '\\$&')
}
