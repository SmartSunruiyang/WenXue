import type {
	AdapterManifest,
	ControlTransactionRef,
	QuestionPlatformAdapter,
	QuestionType,
} from '../contracts'
import {
	createDomQuestionAdapter,
	isVisibleElement,
	type DomAdapterEnvironment,
	type DomVariantDefinition,
} from './sharedDom'

export const ZHS_HIKE_HOSTS = ['zhihuishu.com', 'hike-teaching-center.polymas.com'] as const

export function createZhihuishuAdapters(
	environment: Partial<DomAdapterEnvironment> = {},
): QuestionPlatformAdapter[] {
	return definitions().map((definition) => createDomQuestionAdapter(definition, environment))
}

function definitions(): DomVariantDefinition[] {
	return [
		{
			manifest: zhsManifest({
				variant: 'zhs.gxk_work_exam',
				hosts: ['zhihuishu.com'],
				routes: ['zhs.gxk.homework', 'zhs.gxk.exam'],
				dom: ['zhs.gxk.examPaper_subject', 'zhs.gxk.subject_type'],
				symbols: ['gxkWorkAndExam'],
				types: choiceAndCompletion(),
				domProjectionIds: ['zhs.gxk.question.name'],
				runtimeOperationIds: ['zhihuishu.gxk_project_exam_response'],
			}),
			routeMatchers: [
				(url) =>
					url.pathname.endsWith('/stuExamWeb.html') &&
					/#\/webExamList\/(?:dohomework|doexamination)(?:\/|\?|$)/.test(url.hash),
			],
			questionRootSelectors: ['.examPaper_subject'],
			stemSelectors: ['.subject_describe > div', '.smallStem_describe > div:nth-child(2)'],
			optionSelectors: ['.subject_node .nodeLab'],
			blankSelectors: ['textarea, input[type="text"]'],
			detectType: (root) => detectType(root, ['.subject_type']),
			optionKey: zhsOptionKey,
			interruptSelectors: zhsInterrupts(),
		},
		{
			manifest: zhsManifest({
				variant: 'zhs.xnk_work',
				hosts: ['zhihuishu.com'],
				routes: ['zhs.xnk.homework', 'zhs.xnk.exam'],
				dom: ['zhs.xnk.questionBox', 'zhs.xnk.questionContent'],
				symbols: ['xnkWork'],
				types: choiceAndCompletion(),
				nextSelector: 'span.Topicswitchingbtn:nth-child(2)',
				allowedNextVariants: ['zhs.xnk_work'],
			}),
			routeMatchers: [
				(url) =>
					url.pathname.includes('/atHomeworkExam/stu/homeworkQ/exerciseList') ||
					url.pathname.includes('/atHomeworkExam/stu/examQ/examexercise'),
			],
			questionRootSelectors: ['.questionBox'],
			stemSelectors: ['.questionContent'],
			optionSelectors: ['.optionUl label'],
			blankSelectors: ['textarea, input[type="text"]'],
			detectType: (root) => detectType(root, ['.questionTit']),
			optionKey: zhsOptionKey,
			interruptSelectors: zhsInterrupts(),
		},
		{
			manifest: zhsManifest({
				variant: 'zhs.smart_work',
				hosts: ['smartcourseexam.zhihuishu.com', 'studentexamcomh5.zhihuishu.com'],
				routes: ['zhs.smart.work', 'zhs.smart.h5_review'],
				dom: ['zhs.smart.questionContent', 'zhs.smart.letterSortNum'],
				symbols: ['smartWork'],
				types: choiceAndCompletion(),
				nextSelector: '.next-topic.next-t',
				allowedNextVariants: ['zhs.smart_work'],
			}),
			routeMatchers: [
				(url) =>
					url.pathname.includes('/ReviewExam') || url.pathname.includes('/studentReviewTestOrExam'),
			],
			questionRootSelectors: ['.questionContent'],
			stemSelectors: ['.questionName .centent-pre'],
			optionSelectors: [
				'.radio-view li.clearfix',
				'.checkbox-views label.el-checkbox',
				'.fillAnswer',
			],
			blankSelectors: ['.fillAnswer input, .fillAnswer textarea'],
			detectType: (root) => detectType(root, ['.letterSortNum']),
			optionKey: zhsOptionKey,
			interruptSelectors: zhsInterrupts(),
		},
		{
			manifest: zhsManifest({
				variant: 'zhs.smart_exam',
				hosts: ['examloop.zhihuishu.com'],
				routes: ['zhs.smart.examloop'],
				dom: ['zhs.smart_exam.question_area', 'zhs.smart_exam.type'],
				symbols: ['smartExam'],
				types: {
					single: 'inspect_answer_fill',
					multiple: 'inspect_answer_fill',
					judgement: 'inspect_answer_fill',
					completion: 'inspect_answer',
				},
				nextSelectorId: 'resolver:zhs.smart_exam.next_exact_text',
				allowedNextVariants: ['zhs.smart_exam'],
			}),
			routeMatchers: [(url) => url.pathname.includes('/exam')],
			questionRootSelectors: ['.question-area-content'],
			stemSelectors: ['div.flex-1 .mb-\\[32px\\] .text-mainText.font-medium'],
			optionSelectors: ['label.user-select.group'],
			detectType: (root) => detectType(root, ['div.flex.items-center.mb-\\[16px\\]']),
			optionKey: zhsOptionKey,
			findNextControl: (doc) => exactTextButton(doc, '下一题'),
			interruptSelectors: zhsInterrupts(),
		},
		{
			manifest: zhsManifest({
				variant: 'zhs.fusioncourse_work',
				hosts: [
					'fusioncourseh5.zhihuishu.com',
					'studywisdomh5.zhihuishu.com',
					'wisdom-mooc.zhihuishu.com',
				],
				routes: ['zhs.fusion.exam'],
				dom: ['zhs.fusion.exam_item', 'zhs.fusion.quest_type'],
				symbols: ['fusioncourseWork'],
				types: choiceWithCompletionReview(),
			}),
			routeMatchers: [(url) => url.pathname.includes('/exam')],
			questionRootSelectors: ['.exam-item'],
			stemSelectors: ['.quest-title .option-name'],
			optionSelectors: ['label'],
			detectType: (root) => detectType(root, ['.quest-type']),
			optionKey: zhsOptionKey,
			interruptSelectors: zhsInterrupts(),
		},
		{
			manifest: zhsManifest({
				variant: 'zhs.hike_work',
				hosts: [...ZHS_HIKE_HOSTS],
				routes: ['zhs.hike.work'],
				dom: ['zhs.hike.q_main', 'zhs.hike.question_score'],
				symbols: ['hikeWork'],
				types: choiceWithCompletionReview(),
				nextSelector: '.check_btn:not(.is-disabled)',
				allowedNextVariants: ['zhs.hike_work'],
			}),
			routeMatchers: [(url) => url.pathname.includes('/stu-hike/stuHomeworkDo')],
			questionRootSelectors: ['.q_main'],
			stemSelectors: ['.question-topic'],
			optionSelectors: ['label'],
			detectType: (root) => detectType(root, ['.question_score']),
			optionKey: zhsOptionKey,
			interruptSelectors: zhsInterrupts(),
		},
		{
			manifest: zhsManifest({
				variant: 'zhs.hike_homework',
				hosts: [...ZHS_HIKE_HOSTS],
				routes: ['zhs.hike.homework'],
				dom: ['zhs.hike_homework.question_item', 'zhs.hike_homework.title_box'],
				symbols: ['hikeHomework'],
				types: choiceAndCompletion(),
			}),
			routeMatchers: [(url) => url.pathname.includes('/stu/answer-homework')],
			questionRootSelectors: ['.question-item'],
			stemSelectors: ['.qeustion-content > span', '.combination-content > span'],
			optionSelectors: ['.option-item'],
			blankSelectors: ['.vditor-content .vditor-reset, .vditor-reset'],
			detectType: (root) => detectType(root, ['.title-box', '.combination-title']),
			optionKey: zhsOptionKey,
			afterWrite: async (_root, answer, ctx, transaction) => {
				if (answer.type !== 'completion' || !answer.blanks) return
				await executeVditor(ctx, transaction, answer.questionFingerprint, answer.blanks)
			},
			afterRestore: async (_root, value, ctx, transaction) => {
				if (value.kind !== 'text') return
				await executeVditor(
					ctx,
					transaction,
					value.questionFingerprint,
					value.values.map((entry) => ({ key: entry.blankKey, value: entry.value })),
				)
			},
			interruptSelectors: zhsInterrupts(),
		},
	]
}

interface ZhsManifestInput {
	variant: string
	hosts: string[]
	routes: string[]
	dom: string[]
	symbols: string[]
	types: AdapterManifest['typeSupport']
	nextSelector?: string
	nextSelectorId?: string
	allowedNextVariants?: string[]
	domProjectionIds?: string[]
	runtimeOperationIds?: AdapterManifest['embedded']['runtimeOperationIds']
}

function zhsManifest(input: ZhsManifestInput): AdapterManifest {
	const hasNext = Boolean(input.nextSelector || input.nextSelectorId)
	return {
		ref: { platform: 'zhs', variant: input.variant, version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [
			{
				license: 'MIT',
				path: 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/zhs.ts',
				symbols: input.symbols,
			},
		],
		probe: {
			hosts: input.hosts,
			routePatternIds: input.routes,
			requiredDomSignatures: input.dom,
			minimumScore: 0.8,
		},
		typeSupport: input.types,
		maxModelConcurrency: 4,
		questionDelayMs: 200,
		readiness: { timeoutMs: 10_000, pollMs: 250, quietWindowMs: 250, requireNetworkQuiet: false },
		navigationProfiles: [
			{
				id: 'default',
				readOnly: 'none',
				afterFill: hasNext ? 'next' : 'none',
				advanceEffect: hasNext ? 'draft_irreversible' : 'none',
				...(hasNext
					? {
							nextSelectorId: input.nextSelectorId ?? `selector:${input.nextSelector as string}`,
						}
					: {}),
				allowedNextVariants: input.allowedNextVariants ?? [],
			},
		],
		fill: {
			exactState: true,
			snapshot: 'required',
			saveEffect: 'draft_irreversible',
			visualControlVerification: true,
		},
		embedded: {
			domProjectionIds: input.domProjectionIds ?? [],
			runtimeOperationIds: input.runtimeOperationIds ?? [],
			...(input.variant === 'zhs.gxk_work_exam'
				? {
						passive: {
							endpointAllowlist: [
								{ method: 'POST' as const, routePatternId: 'zhs.gxk.do_exam' },
								{ method: 'POST' as const, routePatternId: 'zhs.gxk.do_homework' },
							],
							projectionOperationId: 'zhihuishu.gxk_project_exam_response' as const,
							maxCandidates: 0,
							maxSerializedBytes: 64 * 1024,
							ttlMs: 60_000,
						},
					}
				: {}),
		},
	}
}

function choiceAndCompletion(): AdapterManifest['typeSupport'] {
	return {
		single: 'inspect_answer_fill',
		multiple: 'inspect_answer_fill',
		judgement: 'inspect_answer_fill',
		completion: 'inspect_answer_fill',
	}
}

function choiceWithCompletionReview(): AdapterManifest['typeSupport'] {
	return {
		single: 'inspect_answer_fill',
		multiple: 'inspect_answer_fill',
		judgement: 'inspect_answer_fill',
		completion: 'inspect_answer',
	}
}

function detectType(root: HTMLElement, selectors: string[]): QuestionType {
	const typeText = selectors
		.flatMap((selector) => Array.from(root.querySelectorAll(selector)))
		.map((node) => node.textContent ?? '')
		.join(' ')
	if (/多选/.test(typeText)) return 'multiple'
	if (/单选/.test(typeText)) return 'single'
	if (/判断/.test(typeText)) return 'judgement'
	if (/填空|问答|简答/.test(typeText)) return 'completion'
	if (root.querySelector('input[type="checkbox"]')) return 'multiple'
	if (root.querySelector('input[type="radio"]')) return 'single'
	if (root.querySelector('textarea, input[type="text"], .vditor-reset')) return 'completion'
	return 'unknown'
}

function zhsOptionKey(option: HTMLElement, index: number): string {
	return (
		option.getAttribute('data-option-key') ||
		option.getAttribute('data') ||
		option.querySelector<HTMLInputElement>('input')?.value ||
		/^\s*([A-Za-z])\s*[.、:：)）]/.exec(option.textContent ?? '')?.[1]?.toUpperCase() ||
		String.fromCharCode(65 + index)
	)
}

function exactTextButton(doc: Document, text: string): HTMLElement | null {
	const matches = Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(
		(element) =>
			isVisibleElement(element) && element.textContent?.replace(/\s+/g, '').trim() === text,
	)
	return matches.length === 1 ? matches[0] : null
}

function zhsInterrupts() {
	return {
		captcha: ['.yidun_popup', '.yidun_modal', '[class*="captcha"]'],
		slider: ['.yidun_slider', '.yidun_control'],
		face: ['#fcqrimg[src]'],
	} satisfies DomVariantDefinition['interruptSelectors']
}

async function executeVditor(
	ctx: Parameters<NonNullable<DomVariantDefinition['afterWrite']>>[2],
	transaction: ControlTransactionRef,
	questionFingerprint: string,
	values: Array<{ key: string; value: string }>,
): Promise<void> {
	await ctx.mainWorld.execute(
		'common.vditor_set',
		{ questionFingerprint, values },
		{ ...transaction, questionFingerprint },
	)
}
