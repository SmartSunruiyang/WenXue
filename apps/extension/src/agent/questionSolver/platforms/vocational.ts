import type {
	AdapterManifest,
	ControlTransactionRef,
	MainWorldSetterOperationId,
	QuestionPlatformAdapter,
	QuestionType,
	StructuredAnswer,
} from '../contracts'
import {
	createDomQuestionAdapter,
	type DomAdapterEnvironment,
	type DomVariantDefinition,
} from './sharedDom'

export const ZJY_HOSTS = ['icve.com.cn', 'zjy2.icve.com.cn', 'zyk.icve.com.cn'] as const
export const ICVE_HOSTS = [
	'icve.com.cn',
	'ai.icve.com.cn',
	'course.icve.com.cn',
	'courshare.cn',
	'webtrn.cn',
] as const

export function createVocationalAdapters(
	environment: Partial<DomAdapterEnvironment> = {},
): QuestionPlatformAdapter[] {
	return [zjyDefinition(), icveStandardDefinition(), icveAiDefinition()].map((definition) =>
		createDomQuestionAdapter(definition, environment),
	)
}

function zjyDefinition(): DomVariantDefinition {
	return {
		manifest: manifest({
			platform: 'zjy',
			variant: 'zjy.legacy_work_exam',
			hosts: [...ZJY_HOSTS],
			routes: ['zjy.legacy.study', 'zjy.legacy.icve_study'],
			dom: ['zjy.subjectList', 'zjy.subjectDet'],
			path: 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/zjy.ts',
			symbols: ['waitForQuestions', 'workOrExam'],
		}),
		routeMatchers: [isLegacyZjyRoute],
		questionRootSelectors: ['.subjectDet'],
		stemSelectors: ['h2,h3,h4,h5,h6,.titleTest span:not(.xvhao)'],
		optionSelectors: ['.optionList div,.tkInput .el-input,.tkInput .el-textarea'],
		blankSelectors: ['.tkInput input[type="text"],.tkInput textarea'],
		detectType: detectControlType,
		optionKey: vocationalOptionKey,
	}
}

function icveStandardDefinition(): DomVariantDefinition {
	return {
		manifest: manifest({
			platform: 'icve',
			variant: 'icve.standard_work_exam',
			hosts: [...ICVE_HOSTS],
			routes: ['icve.standard.exam'],
			dom: ['icve.q_content', 'icve.question_options'],
			path: 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/icve.ts',
			symbols: ['work'],
			nextSelector: '.paging_next',
			allowedNextVariants: ['icve.standard_work_exam'],
		}),
		routeMatchers: [(url) => url.pathname.toLowerCase().includes('/exam')],
		questionRootSelectors: ['.q_content'],
		stemSelectors: ['.divQuestionTitle,[name="fillblankTitle"]'],
		optionSelectors: ['.questionOptions .q_option,.questionOptions.divTextarea,.answerOption'],
		blankSelectors: [
			'.questionOptions textarea,.fillblank_input input,iframe[id*="ueditor"],.answerOption input[type="text"]',
		],
		detectType: detectIcveType,
		optionKey: vocationalOptionKey,
		afterWrite: async (root, answer, ctx, transaction) => {
			if (
				answer.type !== 'completion' ||
				!answer.blanks ||
				!root.querySelector('iframe[id*="ueditor"]')
			)
				return
			await executeFixedSetter('icve.ueditor_set', answer, ctx, transaction, answer.blanks)
		},
		afterRestore: async (root, value, ctx, transaction) => {
			if (value.kind !== 'text' || !root.querySelector('iframe[id*="ueditor"]')) return
			await executeFixedSetter(
				'icve.ueditor_set',
				{
					questionFingerprint: value.questionFingerprint,
					type: 'completion',
					evidence: emptyEvidence(value.questionFingerprint),
				},
				ctx,
				transaction,
				value.values.map((entry) => ({ key: entry.blankKey, value: entry.value })),
			)
		},
	}
}

function icveAiDefinition(): DomVariantDefinition {
	return {
		manifest: manifest({
			platform: 'icve',
			variant: 'icve.ai_work',
			hosts: ['ai.icve.com.cn'],
			routes: ['icve.ai.preview_exam'],
			dom: ['icve.ai.content_item', 'icve.ai.questions_content'],
			path: 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/icve.ts',
			symbols: ['aiWork'],
			nextSelector: 'div.center_btn > button:nth-child(2):not([disabled])',
			allowedNextVariants: ['icve.ai_work'],
		}),
		routeMatchers: [(url) => url.pathname.includes('/preview-exam')],
		questionRootSelectors: ['.content-item'],
		stemSelectors: ['.questions-content [class*="title-content"]'],
		optionSelectors: ['label[class*="group-item"],.ivu-input-wrapper input'],
		blankSelectors: ['.ivu-input-wrapper input,.ivu-input-wrapper textarea'],
		detectType: detectControlType,
		optionKey: vocationalOptionKey,
		afterWrite: async (_root, answer, ctx, transaction) => {
			if (answer.type !== 'completion' || !answer.blanks) return
			await executeFixedSetter('common.native_input_set', answer, ctx, transaction, answer.blanks)
		},
		afterRestore: async (_root, value, ctx, transaction) => {
			if (value.kind !== 'text') return
			await executeFixedSetter(
				'common.native_input_set',
				{
					questionFingerprint: value.questionFingerprint,
					type: 'completion',
					evidence: emptyEvidence(value.questionFingerprint),
				},
				ctx,
				transaction,
				value.values.map((entry) => ({ key: entry.blankKey, value: entry.value })),
			)
		},
	}
}

interface ManifestInput {
	platform: 'zjy' | 'icve'
	variant: string
	hosts: string[]
	routes: string[]
	dom: string[]
	path: string
	symbols: string[]
	nextSelector?: string
	allowedNextVariants?: string[]
}

function manifest(input: ManifestInput): AdapterManifest {
	const hasNext = Boolean(input.nextSelector)
	return {
		ref: { platform: input.platform, variant: input.variant, version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [{ license: 'MIT', path: input.path, symbols: input.symbols }],
		probe: {
			hosts: input.hosts,
			routePatternIds: input.routes,
			requiredDomSignatures: input.dom,
			minimumScore: 0.8,
		},
		typeSupport: {
			single: 'inspect_answer_fill',
			multiple: 'inspect_answer_fill',
			judgement: 'inspect_answer_fill',
			completion: 'inspect_answer_fill',
		},
		maxModelConcurrency: 4,
		questionDelayMs: input.platform === 'icve' ? 200 : 0,
		readiness: { timeoutMs: 10_000, pollMs: 250, quietWindowMs: 250, requireNetworkQuiet: false },
		navigationProfiles: [
			{
				id: 'default',
				readOnly: 'none',
				afterFill: hasNext ? 'next' : 'none',
				advanceEffect: hasNext ? 'draft_irreversible' : 'none',
				...(hasNext ? { nextSelectorId: `selector:${input.nextSelector}` } : {}),
				allowedNextVariants: input.allowedNextVariants ?? [],
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

function isLegacyZjyRoute(url: URL): boolean {
	const path = url.pathname.toLowerCase()
	if (url.hostname.toLowerCase() === 'zjy2.icve.com.cn' && path.includes('/study/v2/')) return false
	return (
		/study\/(?:spockeeptest|spocjobtest|spoctest|courseteaching\/test\/homework)/.test(path) ||
		/icve-study\/(?:coursepreview\/(?:jobtes|test|keeptest)|test)/.test(path)
	)
}

function detectControlType(root: HTMLElement): QuestionType {
	const typeText = [
		root.getAttribute('data-question-type'),
		root.querySelector('[class*="question-type"],[class*="questions-type"],.subjectType')
			?.textContent,
	]
		.filter(Boolean)
		.join(' ')
	if (/多选/.test(typeText)) return 'multiple'
	if (/单选/.test(typeText)) return 'single'
	if (/判断/.test(typeText)) return 'judgement'
	if (/填空|简答/.test(typeText)) return 'completion'
	const radioCount = root.querySelectorAll('input[type="radio"]').length
	if (radioCount > 0) return radioCount === 2 ? 'judgement' : 'single'
	if (root.querySelector('input[type="checkbox"]')) return 'multiple'
	if (root.querySelector('textarea,input[type="text"],iframe[id*="ueditor"]')) return 'completion'
	return 'unknown'
}

function detectIcveType(root: HTMLElement): QuestionType {
	if (root.querySelector('.fillblank_input input')) return 'completion'
	return detectControlType(root)
}

function vocationalOptionKey(option: HTMLElement, index: number): string {
	return (
		option.getAttribute('data-option-key') ||
		option.querySelector<HTMLInputElement>('input')?.value ||
		/^\s*([A-Za-z])\s*[.、:：)）]/.exec(option.textContent ?? '')?.[1]?.toUpperCase() ||
		String.fromCharCode(65 + index)
	)
}

async function executeFixedSetter(
	operationId: MainWorldSetterOperationId,
	answer: StructuredAnswer,
	ctx: Parameters<NonNullable<DomVariantDefinition['afterWrite']>>[2],
	transaction: ControlTransactionRef,
	values: Array<{ key: string; value: string }>,
): Promise<void> {
	await ctx.mainWorld.execute(
		operationId,
		{ questionFingerprint: answer.questionFingerprint, values },
		{ ...transaction, questionFingerprint: answer.questionFingerprint },
	)
}

function emptyEvidence(questionFingerprint: string): StructuredAnswer['evidence'] {
	return {
		source: 'visible_solution',
		questionFingerprint,
		mappingConfidence: 1,
		warnings: [],
	}
}
