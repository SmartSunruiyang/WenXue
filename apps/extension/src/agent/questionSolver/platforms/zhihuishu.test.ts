// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
	AdapterContext,
	FillCommand,
	FixedMainWorldRuntime,
	StructuredAnswer,
} from '../contracts'
import { QuestionAdapterRegistry } from '../registry'
import { createZhihuishuAdapters, ZHS_HIKE_HOSTS } from './zhihuishu'

const CASES = [
	{
		variant: 'zhs.gxk_work_exam',
		url: 'https://online.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework/1',
		html: '<div class="examPaper_subject" data-id="gxk"><div class="subject_type">单选题</div><div class="subject_describe"><div>GXK stem</div></div><div class="subject_node"><label class="nodeLab"><input type="radio" value="A">A. one</label></div></div>',
	},
	{
		variant: 'zhs.xnk_work',
		url: 'https://online.zhihuishu.com/atHomeworkExam/stu/homeworkQ/exerciseList',
		html: '<div class="questionBox"><div class="questionTit">多选题</div><div class="questionContent">XNK stem</div><div class="optionUl"><label><input type="checkbox" value="A">A. one</label></div></div>',
	},
	{
		variant: 'zhs.smart_work',
		url: 'https://smartcourseexam.zhihuishu.com/ReviewExam',
		html: '<div class="questionContent"><div class="questionName"><span class="letterSortNum">单选题</span><div class="centent-pre">Smart stem</div></div><ul class="radio-view"><li class="clearfix"><input type="radio" value="A">A. one</li></ul></div>',
	},
	{
		variant: 'zhs.smart_exam',
		url: 'https://examloop.zhihuishu.com/exam/1',
		html: '<div class="question-area-content"><div class="flex items-center mb-[16px]">单选题</div><div class="flex-1"><div class="mb-[32px]"><div class="text-mainText font-medium">Exam stem</div></div></div><label class="user-select group"><input type="radio" value="A">A. one</label></div>',
	},
	{
		variant: 'zhs.fusioncourse_work',
		url: 'https://fusioncourseh5.zhihuishu.com/exam/1',
		html: '<div class="exam-item"><div class="quest-type">判断题</div><div class="quest-title"><div class="option-name">Fusion stem</div></div><label><input type="radio" value="A">正确</label></div>',
	},
	{
		variant: 'zhs.hike_work',
		url: 'https://hike-teaching-center.polymas.com/stu-hike/stuHomeworkDo/1',
		html: '<div class="q_main"><div class="question_score">单选题</div><div class="question-topic">Hike stem</div><label><input type="radio" value="A">A. one</label></div>',
	},
	{
		variant: 'zhs.hike_homework',
		url: 'https://online.zhihuishu.com/stu/answer-homework/1',
		html: '<div class="question-item"><div class="title-box">问答题</div><div class="qeustion-content"><span>Homework stem <img src="diagram.png"></span></div><div class="vditor-content"><div class="vditor-reset" contenteditable="true"></div></div></div>',
	},
] as const

describe('Zhihuishu adapter family', () => {
	let currentUrl: string = CASES[0].url

	beforeEach(() => {
		currentUrl = CASES[0].url
		document.body.innerHTML = CASES[0].html
	})

	it('registers the seven frozen production variants and both Hike hosts', () => {
		const adapters = createZhihuishuAdapters({ getUrl: () => currentUrl })
		expect(adapters.map((adapter) => adapter.manifest.ref.variant)).toEqual(
			CASES.map((entry) => entry.variant),
		)
		expect(ZHS_HIKE_HOSTS).toEqual(['zhihuishu.com', 'hike-teaching-center.polymas.com'])
		expect(() => new QuestionAdapterRegistry(adapters)).not.toThrow()
	})

	it.each(CASES)('probes and extracts $variant from its attributed fixture', async (fixture) => {
		currentUrl = fixture.url
		document.body.innerHTML = fixture.html
		const adapter = createZhihuishuAdapters({ getUrl: () => currentUrl }).find(
			(candidate) => candidate.manifest.ref.variant === fixture.variant,
		)
		expect(adapter).toBeDefined()
		const ctx = context()
		expect(await adapter!.probe(ctx)).toMatchObject({
			matched: true,
			navigationProfileId: 'default',
		})
		const questions = await adapter!.extract(ctx)
		expect(questions).toHaveLength(1)
		expect(questions[0].type).not.toBe('unknown')
		expect(JSON.stringify(adapter!.manifest)).not.toMatch(/submit|hand.?in|finish.?exam/i)
	})

	it('keeps gxk response projection title-only and never exposes an answer field', () => {
		const [adapter] = createZhihuishuAdapters({ getUrl: () => currentUrl })
		expect(adapter.manifest.embedded.domProjectionIds).toEqual(['zhs.gxk.question.name'])
		expect(adapter.manifest.embedded.runtimeOperationIds).toEqual([
			'zhihuishu.gxk_project_exam_response',
		])
		expect(JSON.stringify(adapter.manifest.embedded)).not.toMatch(/correct|right|standard.?answer/i)
	})

	it('requires exact 下一题 text for smart-exam navigation', async () => {
		currentUrl = CASES[3].url
		document.body.innerHTML = `${CASES[3].html}<button>提交</button><button>下一题目</button>`
		const adapter = createZhihuishuAdapters({ getUrl: () => currentUrl })[3]
		const ctx = context()
		ctx.navigationProfileId = 'default'
		await adapter.extract(ctx)
		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false, mode: 'after_fill' })
		const next = document.createElement('button')
		next.textContent = ' 下一题 '
		document.body.append(next)
		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: true })
	})

	it('routes Hike Vditor writes through a fixed operation and restores the old value', async () => {
		currentUrl = CASES[6].url
		document.body.innerHTML = CASES[6].html
		const execute = vi.fn().mockResolvedValue(true)
		const adapter = createZhihuishuAdapters({ getUrl: () => currentUrl })[6]
		const ctx = context(execute)
		ctx.navigationProfileId = 'default'
		const [question] = await adapter.extract(ctx)
		expect(question.hasRequiredVisuals).toBe(true)
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'completion',
			blanks: [{ key: '1', value: 'new response' }],
			evidence: {
				source: 'llm_vision',
				questionFingerprint: question.locator.fingerprint,
				mappingConfidence: 1,
				warnings: [],
			},
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = {
			transactionId: snapshot.transactionId,
			snapshotDigestVersion: 1 as const,
			snapshotDigest: snapshot.snapshotDigest,
		}
		expect(await adapter.setExactAnswers(ctx, transaction, commands)).toEqual([
			expect.objectContaining({ result: 'written' }),
		])
		expect(execute).toHaveBeenCalledWith(
			'common.vditor_set',
			expect.objectContaining({ questionFingerprint: question.locator.fingerprint }),
			expect.objectContaining({ transactionId: snapshot.transactionId }),
		)
		expect(await adapter.restoreControlState(ctx, transaction, snapshot)).toMatchObject({
			restored: true,
			verified: true,
		})
	})

	it('marks unsupported completion writers as answer-only', () => {
		const adapters = createZhihuishuAdapters({ getUrl: () => currentUrl })
		for (const index of [3, 4, 5]) {
			expect(adapters[index].manifest.typeSupport.completion).toBe('inspect_answer')
		}
	})
})

function context(execute = vi.fn()): AdapterContext {
	let anchor = 0
	return {
		identity: { taskId: 'task', taskEpoch: 1, runId: 'run' },
		frame: {
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'doc',
			documentToken: 'token',
			urlFingerprint: 'url',
		},
		action: 'fill',
		scope: 'current_page',
		signal: new AbortController().signal,
		mainWorld: { execute } as unknown as FixedMainWorldRuntime,
		anchors: { registerImage: () => `anchor-${++anchor}` },
	}
}

function command(locator: FillCommand['locator'], answer: StructuredAnswer): FillCommand {
	return {
		locator,
		expectedLogicalPageFingerprint: 'page',
		expectedBindingFingerprint: 'binding',
		answer,
	}
}
