import type { AdapterManifest, QuestionPlatformAdapter, QuestionType } from '../contracts'
import {
	createDomQuestionAdapter,
	type DomAdapterEnvironment,
	type DomVariantDefinition,
} from './sharedDom'

export const ICOURSE_HOSTS = ['icourse163.org'] as const

export function createIcourseAdapters(
	environment: Partial<DomAdapterEnvironment> = {},
): QuestionPlatformAdapter[] {
	return [chapterDefinition(), workDefinition(), examDefinition()].map((definition) =>
		createDomQuestionAdapter(definition, environment),
	)
}

function chapterDefinition(): DomVariantDefinition {
	return standardDefinition(
		'icourse.chapter_test',
		['icourse.chapter.content_detail'],
		['workAndExam', 'handleVideoTest'],
		(url) =>
			isLearnPage(url) &&
			url.hash.includes('/learn/content?type=detail') &&
			!url.hash.includes('/learn/quiz'),
	)
}

function workDefinition(): DomVariantDefinition {
	return standardDefinition(
		'icourse.work',
		['icourse.learn.quiz'],
		['workAndExam'],
		(url) =>
			isLearnPage(url) &&
			url.hash.includes('/learn/quiz') &&
			!url.hash.includes('/learn/quizscore'),
	)
}

function standardDefinition(
	variant: 'icourse.chapter_test' | 'icourse.work',
	routes: string[],
	symbols: string[],
	matcher: (url: URL) => boolean,
): DomVariantDefinition {
	return {
		manifest: icourseManifest(variant, routes, ['icourse.u_question_item'], symbols),
		routeMatchers: [matcher],
		questionRootSelectors: ['.u-questionItem'],
		stemSelectors: ['.j-title .j-richTxt'],
		optionSelectors: ['.choices li,.inputArea'],
		blankSelectors: ['.inputArea textarea,.inputArea input[type="text"]'],
		detectType: detectIcourseType,
		optionKey: icourseOptionKey,
	}
}

function examDefinition(): DomVariantDefinition {
	return {
		manifest: icourseManifest(
			'icourse.exam',
			['icourse.exam.legacy', 'icourse.exam.new'],
			['icourse.question_body'],
			['workAndExam'],
		),
		routeMatchers: [
			(url) => {
				const full = `${url.pathname}${url.search}${url.hash}`
				return (
					(full.includes('/learn/examObject') && !full.includes('examObjectScore')) ||
					full.includes('/mooc/main/newExam')
				)
			},
		],
		questionRootSelectors: ['[class*="questionBody"]'],
		stemSelectors: ['[class*="questionInfo"]'],
		optionSelectors: ['[class*="index-module__optionBody"]'],
		blankSelectors: ['textarea,input[type="text"]'],
		detectType: detectIcourseType,
		optionKey: icourseOptionKey,
	}
}

function icourseManifest(
	variant: string,
	routes: string[],
	dom: string[],
	symbols: string[],
): AdapterManifest {
	return {
		ref: { platform: 'icourse', variant, version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [
			{
				license: 'MIT',
				path: 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/icourse.ts',
				symbols,
			},
		],
		probe: {
			hosts: [...ICOURSE_HOSTS],
			routePatternIds: routes,
			requiredDomSignatures: dom,
			minimumScore: 0.8,
		},
		typeSupport: {
			single: 'inspect_answer_fill',
			multiple: 'inspect_answer_fill',
			judgement: 'inspect_answer_fill',
			completion: 'inspect_answer_fill',
		},
		maxModelConcurrency: 1,
		questionDelayMs: 5_000,
		readiness: {
			timeoutMs: 15_000,
			pollMs: 250,
			quietWindowMs: 5_000,
			requireNetworkQuiet: true,
		},
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
		embedded: { domProjectionIds: [], runtimeOperationIds: ['icourse.runtime_read'] },
	}
}

function isLearnPage(url: URL): boolean {
	return /\/(?:spoc\/)?learn(?:\/|$)/.test(url.pathname)
}

function detectIcourseType(root: HTMLElement): QuestionType {
	const typeText = [
		root.getAttribute('data-question-type'),
		root.querySelector('[class*="questionType"],.j-type')?.textContent,
	]
		.filter(Boolean)
		.join(' ')
	if (/多选/.test(typeText)) return 'multiple'
	if (/单选/.test(typeText)) return 'single'
	if (/判断/.test(typeText)) return 'judgement'
	if (/填空|简答/.test(typeText)) return 'completion'
	if (root.querySelector('.u-icon-correct,.u-icon-wrong,[data-judgement]')) return 'judgement'
	if (root.querySelector('input[type="checkbox"]')) return 'multiple'
	if (root.querySelector('input[type="radio"]')) return 'single'
	if (root.querySelector('textarea,input[type="text"]')) return 'completion'
	return 'unknown'
}

function icourseOptionKey(option: HTMLElement, index: number): string {
	return (
		option.getAttribute('data-option-key') ||
		option.querySelector<HTMLInputElement>('input')?.value ||
		/^\s*([A-Za-z])\s*[.、:：)）]/.exec(option.textContent ?? '')?.[1]?.toUpperCase() ||
		String.fromCharCode(65 + index)
	)
}
