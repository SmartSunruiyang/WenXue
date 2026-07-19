import type {
	AdapterManifest,
	ControlValue,
	Question,
	QuestionPlatformAdapter,
	QuestionType,
	StructuredAnswer,
} from '../contracts'
import {
	createDomQuestionAdapter,
	type DomAdapterEnvironment,
	type DomSubQuestionDefinition,
	type DomVariantDefinition,
} from './sharedDom'

export const CX_DOMAINS = [
	'chaoxing.com',
	'edu.cn',
	'org.cn',
	'xueyinonline.com',
	'hnsyu.net',
	'qutjxjy.cn',
	'ynny.cn',
	'hnvist.cn',
	'fjlecb.cn',
	'gdhkmooc.com',
	'cugbonline.cn',
	'zjelib.cn',
	'cqrspx.cn',
	'neauce.com',
	'zhihui-yun.com',
	'cqie.cn',
	'ccqmxx.com',
	'jxgmxy.com',
	'jnzyjsxy.cn',
	'sslibrary.com',
] as const

const MODERN_ROUTES = [
	'/mooc2/work/dowork',
	'/mooc2/exam/preview',
	'/exam-ans/exam/test/reVersionTestStartNew',
	'/mooc-ans/exam/test/reVersionTestStartNew',
]

export function createChaoxingAdapters(
	environment: Partial<DomAdapterEnvironment> = {},
): QuestionPlatformAdapter[] {
	return [
		createDomQuestionAdapter(modernDefinition(), environment),
		createDomQuestionAdapter(chapterDefinition(), environment),
	]
}

export function mapChaoxingTypeCode(code: number): QuestionType {
	if (code === 0) return 'single'
	if (code === 1) return 'multiple'
	if (code === 3) return 'judgement'
	if ([2, 4, 5, 6, 7, 8, 9, 10].includes(code)) return 'completion'
	if (code === 11) return 'line'
	if (code === 14) return 'fill'
	if (code === 15) return 'reader'
	return 'unknown'
}

function modernDefinition(): DomVariantDefinition {
	return {
		manifest: modernManifest(),
		routeMatchers: [
			(url) => MODERN_ROUTES.some((route) => `${url.pathname}${url.hash}`.includes(route)),
		],
		questionRootSelectors: ['.questionLi'],
		stemSelectors: [
			':scope > h3, :scope > div:not(.stem_answer):not(.answerBg):not(.line_answer_ct):not(.filling_answer):not(.reading_answer):not(.reader-material):not(.reading_material):not([data-reading-material]), :scope > p',
		],
		materialSelectors: ['.reader-material, .reading_material, [data-reading-material]'],
		optionSelectors: ['.answerBg .answer_p', '.textDIV', '.eidtDiv'],
		subQuestions: {
			line: {
				containerSelectors: ['.line_answer_ct .selectBox'],
				optionSelectors: [':scope li[data]'],
				type: 'single',
				optionKey: chaoxingOptionKey,
			},
			fill: chaoxingChoiceSubQuestions('.filling_answer'),
			reader: chaoxingChoiceSubQuestions('.reading_answer'),
		},
		blankSelectors: ['textarea, iframe'],
		lineItemSelectors: ['.line_answer_ct .selectBox'],
		platformQuestionIdAttributes: ['data-questionid', 'data-question-id', 'data-id', 'id'],
		detectType: detectChaoxingType,
		optionKey: chaoxingOptionKey,
		selectNavigationProfile: (doc, url) => {
			if (url.pathname.includes('/mooc2/exam/preview')) return 'chaoxing.modern.preview'
			return doc.querySelector('[onclick="getTheNextQuestion(1)"]')
				? 'chaoxing.modern.serial'
				: 'chaoxing.modern.preview'
		},
		readControlValue: readChaoxingControl,
		writeAnswer: writeChaoxingAnswer,
		restoreControlValue: restoreChaoxingControl,
		interruptSelectors: {
			face: ['#fcqrimg[src]', '.chapterVideoFaceMaskDiv:not([style*="display: none"])'],
		},
	}
}

function chapterDefinition(): DomVariantDefinition {
	return {
		manifest: chapterManifest(),
		routeMatchers: [(url) => `${url.pathname}${url.hash}`.includes('/knowledge/cards')],
		questionRootSelectors: ['.TiMu'],
		stemSelectors: ['.Zy_TItle .clearfix', '.firstUlList', '.secondUlList'],
		optionSelectors: ['ul li .after', 'ul li label:not(.before)', 'ul li textarea', 'ul textarea'],
		subQuestions: {
			line: {
				containerSelectors: ['.thirdUlList .dept_select'],
				optionSelectors: [':scope option'],
				type: 'single',
				optionKey: chaoxingOptionKey,
			},
		},
		blankSelectors: ['textarea, iframe'],
		lineItemSelectors: ['.thirdUlList .dept_select'],
		platformQuestionIdAttributes: ['data-questionid', 'data-question-id', 'data-id', 'id'],
		detectType: detectChaoxingType,
		optionKey: chaoxingOptionKey,
		readControlValue: readChaoxingControl,
		writeAnswer: writeChaoxingAnswer,
		restoreControlValue: restoreChaoxingControl,
		interruptSelectors: {
			face: ['#fcqrimg[src]', '.chapterVideoFaceMaskDiv:not([style*="display: none"])'],
		},
	}
}

function modernManifest(): AdapterManifest {
	return {
		ref: { platform: 'chaoxing', variant: 'chaoxing.modern_work_exam', version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [
			{
				license: 'MIT',
				path: 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/cx.ts',
				symbols: ['workOrExam', 'workOrExamQuestionTitleTransform', 'readerAndFillHandle'],
			},
		],
		probe: {
			hosts: [...CX_DOMAINS],
			routePatternIds: ['cx.modern.work', 'cx.modern.preview', 'cx.modern.serial_exam'],
			requiredDomSignatures: ['cx.questionLi', 'cx.answer_type'],
			minimumScore: 0.8,
		},
		typeSupport: {
			single: 'inspect_answer_fill',
			multiple: 'inspect_answer_fill',
			judgement: 'inspect_answer_fill',
			completion: 'inspect_answer_fill',
			line: 'inspect_answer_fill',
			fill: 'inspect_answer_fill',
			reader: 'inspect_answer_fill',
		},
		maxModelConcurrency: 4,
		questionDelayMs: 0,
		readiness: { timeoutMs: 10_000, pollMs: 250, quietWindowMs: 250, requireNetworkQuiet: false },
		navigationProfiles: [
			{
				id: 'chaoxing.modern.preview',
				readOnly: 'none',
				afterFill: 'none',
				advanceEffect: 'none',
				allowedNextVariants: [],
			},
			{
				id: 'chaoxing.modern.serial',
				readOnly: 'none',
				afterFill: 'next',
				advanceEffect: 'draft_irreversible',
				nextSelectorId: 'selector:[onclick="getTheNextQuestion(1)"]',
				allowedNextVariants: ['chaoxing.modern_work_exam'],
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

function chapterManifest(): AdapterManifest {
	return {
		ref: { platform: 'chaoxing', variant: 'chaoxing.chapter_test', version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [
			{
				license: 'MIT',
				path: 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/cx.ts',
				symbols: ['JobRunner.chapter', 'chapterTestTaskQuestionTitleTransform'],
			},
		],
		probe: {
			hosts: [...CX_DOMAINS],
			routePatternIds: ['cx.chapter.cards'],
			requiredDomSignatures: ['cx.chapter.TiMu', 'cx.chapter.answer_type'],
			minimumScore: 0.8,
		},
		typeSupport: {
			single: 'inspect_answer_fill',
			multiple: 'inspect_answer_fill',
			judgement: 'inspect_answer_fill',
			completion: 'inspect_answer_fill',
			line: 'inspect_answer_fill',
		},
		maxModelConcurrency: 4,
		questionDelayMs: 0,
		readiness: { timeoutMs: 10_000, pollMs: 250, quietWindowMs: 250, requireNetworkQuiet: false },
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

function detectChaoxingType(root: HTMLElement): QuestionType {
	const input = root.querySelector<HTMLInputElement>('input[name^="type"], input[id^="answertype"]')
	return mapChaoxingTypeCode(Number.parseInt(input?.value ?? '', 10))
}

function chaoxingOptionKey(option: HTMLElement, index: number): string {
	return (
		option.getAttribute('data') ??
		option.getAttribute('data-option-key') ??
		option.getAttribute('value') ??
		String.fromCharCode(65 + index)
	)
}

function chaoxingChoiceSubQuestions(
	containerSelector: '.filling_answer' | '.reading_answer',
): DomSubQuestionDefinition {
	return {
		containerSelectors: [containerSelector],
		stemSelectors: [':scope > p, :scope > h3, :scope > .stem, :scope > [data-subquestion-stem]'],
		optionSelectors: [':scope span.saveSingleSelect[data]'],
		type: 'single',
		optionKey: chaoxingOptionKey,
	}
}

function readChaoxingControl(root: HTMLElement, question: Question): ControlValue {
	if (question.type === 'single' || question.type === 'multiple' || question.type === 'judgement') {
		const options = choiceOptions(root)
		return {
			kind: 'choice',
			questionFingerprint: question.locator.fingerprint,
			selectedOptionKeys: options
				.map((option, index) => ({
					key: chaoxingOptionKey(option, index),
					selected: isChaoxingOptionSelected(option),
				}))
				.filter((option) => option.selected)
				.map((option) => option.key),
		}
	}
	if (question.type === 'line') {
		return {
			kind: 'line',
			questionFingerprint: question.locator.fingerprint,
			pairs: lineBoxes(root).map((box, index) => ({
				leftKey: question.subQuestions?.[index]?.locator.fingerprint ?? String(index + 1),
				rightKey:
					box.querySelector<HTMLOptionElement>('option:checked, option[selected]')?.value ??
					box
						.querySelector<HTMLElement>('li[aria-selected="true"], li.selected')
						?.getAttribute('data') ??
					'',
			})),
		}
	}
	if (question.type === 'fill' || question.type === 'reader') {
		const selector = question.type === 'fill' ? '.filling_answer' : '.reading_answer'
		return {
			kind: 'choice',
			questionFingerprint: question.locator.fingerprint,
			selectedOptionKeys: Array.from(root.querySelectorAll<HTMLElement>(selector)).flatMap(
				(container, index) =>
					Array.from(container.querySelectorAll<HTMLElement>('span.saveSingleSelect[data]'))
						.filter(isChaoxingOptionSelected)
						.map((option) => `${index}:${option.getAttribute('data') ?? ''}`),
			),
		}
	}
	return {
		kind: 'text',
		questionFingerprint: question.locator.fingerprint,
		values: blankControls(root).map((control, index) => ({
			blankKey: blankKey(control, index),
			value: readBlank(control),
		})),
	}
}

function writeChaoxingAnswer(root: HTMLElement, answer: StructuredAnswer): boolean {
	if (answer.type === 'single' || answer.type === 'multiple' || answer.type === 'judgement') {
		if (!answer.selectedOptions) return false
		const desired = new Set(answer.selectedOptions)
		const options = choiceOptions(root)
		const available = new Set(options.map((option, index) => chaoxingOptionKey(option, index)))
		if (options.length === 0 || [...desired].some((key) => !available.has(key))) return false
		for (const [index, option] of options.entries()) {
			const shouldSelect = desired.has(chaoxingOptionKey(option, index))
			if (isChaoxingOptionSelected(option) !== shouldSelect) option.click()
		}
		return options.length > 0
	}
	if (answer.type === 'completion') {
		if (!answer.blanks) return false
		const desired = new Map(answer.blanks.map((entry) => [entry.key, entry.value]))
		const controls = blankControls(root)
		const available = new Set(controls.map((control, index) => blankKey(control, index)))
		if (controls.length === 0 || [...desired.keys()].some((key) => !available.has(key)))
			return false
		for (const [index, control] of controls.entries()) {
			const value = desired.get(blankKey(control, index))
			if (value === undefined) continue
			writeBlank(control, value)
		}
		root.querySelector<HTMLElement>('[onclick*="saveQuestion"]')?.click()
		return controls.length > 0
	}
	if (answer.type === 'line') {
		if (!answer.linePairs) return false
		const boxes = lineBoxes(root)
		if (boxes.length === 0 || boxes.length !== answer.linePairs.length) return false
		const operations: Array<
			| { kind: 'select'; control: HTMLSelectElement; value: string }
			| { kind: 'click'; control: HTMLElement }
		> = []
		for (const [pairIndex, pair] of answer.linePairs.entries()) {
			const numericIndex = /^\d+$/.test(pair.leftKey)
				? Number.parseInt(pair.leftKey, 10) - 1
				: pairIndex
			const index = numericIndex >= 0 && numericIndex < boxes.length ? numericIndex : pairIndex
			const box = boxes[index]
			const select =
				box?.querySelector<HTMLSelectElement>('select') ??
				(box instanceof HTMLSelectElement ? box : null)
			if (select) {
				if (!Array.from(select.options).some((option) => option.value === pair.rightKey))
					return false
				operations.push({ kind: 'select', control: select, value: pair.rightKey })
				continue
			}
			const target = box?.querySelector<HTMLElement>(
				`li[data="${escapeAttribute(pair.rightKey)}"] a`,
			)
			if (!target) return false
			operations.push({ kind: 'click', control: target })
		}
		for (const operation of operations) {
			if (operation.kind === 'click') {
				operation.control.click()
				continue
			}
			operation.control.value = operation.value
			operation.control.dispatchEvent(new Event('change', { bubbles: true }))
		}
		return true
	}
	if (answer.type === 'fill' || answer.type === 'reader') {
		const selector = answer.type === 'fill' ? '.filling_answer' : '.reading_answer'
		const containers = Array.from(root.querySelectorAll<HTMLElement>(selector))
		const subAnswers = answer.subAnswers ?? []
		if (containers.length === 0 || containers.length !== subAnswers.length) return false
		const targets: HTMLElement[] = []
		for (const [index, subAnswer] of subAnswers.entries()) {
			const key = subAnswer.selectedOptions?.[0]
			if (!key || subAnswer.selectedOptions?.length !== 1) return false
			const target = containers[index]?.querySelector<HTMLElement>(
				`span.saveSingleSelect[data="${escapeAttribute(key)}"]`,
			)
			if (!target) return false
			targets.push(target)
		}
		for (const target of targets) target.click()
		return true
	}
	return false
}

function restoreChaoxingControl(root: HTMLElement, value: ControlValue): boolean {
	if (value.kind === 'choice') {
		if (value.selectedOptionKeys.some((key) => /^\d+:/.test(key))) {
			const desired = new Set(value.selectedOptionKeys)
			const containers = Array.from(
				root.querySelectorAll<HTMLElement>('.filling_answer, .reading_answer'),
			)
			for (const [index, container] of containers.entries()) {
				for (const option of Array.from(
					container.querySelectorAll<HTMLElement>('span.saveSingleSelect[data]'),
				)) {
					const key = `${index}:${option.getAttribute('data') ?? ''}`
					if (isChaoxingOptionSelected(option) !== desired.has(key)) option.click()
				}
			}
			return containers.length > 0
		}
		const desired = new Set(value.selectedOptionKeys)
		const options = choiceOptions(root)
		for (const [index, option] of options.entries()) {
			if (isChaoxingOptionSelected(option) !== desired.has(chaoxingOptionKey(option, index)))
				option.click()
		}
		return options.length > 0
	}
	if (value.kind === 'text') {
		const desired = new Map(value.values.map((entry) => [entry.blankKey, entry.value]))
		const controls = blankControls(root)
		for (const [index, control] of controls.entries()) {
			const text = desired.get(blankKey(control, index))
			if (text !== undefined) writeBlank(control, text)
		}
		return controls.length > 0
	}
	if (value.kind === 'line') {
		return writeChaoxingAnswer(root, {
			questionFingerprint: value.questionFingerprint,
			type: 'line',
			linePairs: value.pairs,
			evidence: {
				source: 'visible_solution',
				questionFingerprint: value.questionFingerprint,
				mappingConfidence: 1,
				warnings: [],
			},
		})
	}
	return false
}

function choiceOptions(root: HTMLElement): HTMLElement[] {
	for (const selector of [
		'.answerBg .answer_p',
		'.textDIV',
		'.eidtDiv',
		'ul li .after',
		'ul li label:not(.before)',
	]) {
		const options = Array.from(root.querySelectorAll<HTMLElement>(selector))
		if (options.length > 0) return options
	}
	return []
}

function lineBoxes(root: HTMLElement): HTMLElement[] {
	return Array.from(
		root.querySelectorAll<HTMLElement>('.line_answer_ct .selectBox, .thirdUlList .dept_select'),
	)
}

function blankControls(
	root: HTMLElement,
): Array<HTMLTextAreaElement | HTMLInputElement | HTMLIFrameElement> {
	return Array.from(root.querySelectorAll('textarea, input[type="text"], iframe'))
}

function isChaoxingOptionSelected(option: HTMLElement): boolean {
	const input = option.matches('input')
		? (option as HTMLInputElement)
		: option.querySelector<HTMLInputElement>('input')
	return Boolean(
		input?.checked ||
		option.querySelector('[class*="check_answer"]') ||
		option.getAttribute('aria-checked') === 'true' ||
		/(?:^|\s)(?:selected|checked|active|on)(?:\s|$)/i.test(option.className),
	)
}

function blankKey(control: Element, index: number): string {
	return (
		control.getAttribute('data-blank-key') ||
		control.getAttribute('name') ||
		control.id ||
		String(index + 1)
	)
}

function readBlank(control: HTMLTextAreaElement | HTMLInputElement | HTMLIFrameElement): string {
	if (control instanceof HTMLIFrameElement) return control.contentDocument?.body.textContent ?? ''
	return control.value
}

function writeBlank(
	control: HTMLTextAreaElement | HTMLInputElement | HTMLIFrameElement,
	value: string,
): void {
	if (control instanceof HTMLIFrameElement) {
		if (control.contentDocument?.body) {
			control.contentDocument.body.textContent = value
			control.contentDocument.body.dispatchEvent(
				new InputEvent('input', { bubbles: true, data: value }),
			)
		}
		return
	}
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')
	descriptor?.set?.call(control, value)
	control.dispatchEvent(new Event('input', { bubbles: true }))
	control.dispatchEvent(new Event('change', { bubbles: true }))
}

function escapeAttribute(value: string): string {
	return value.replace(/["\\]/g, '\\$&')
}
