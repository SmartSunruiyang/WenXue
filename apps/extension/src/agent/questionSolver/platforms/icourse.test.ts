// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterContext, FixedMainWorldRuntime } from '../contracts'
import { QuestionAdapterRegistry } from '../registry'
import { createIcourseAdapters, ICOURSE_HOSTS } from './icourse'

const CHAPTER_URL =
	'https://www.icourse163.org/learn/course-1#/learn/content?type=detail&id=chapter'
const WORK_URL = 'https://www.icourse163.org/spoc/learn/course-1#/learn/quiz?id=work'
const EXAM_URL = 'https://www.icourse163.org/learn/examObject?id=exam'

describe('iCourse adapters', () => {
	afterEach(() => vi.useRealTimers())

	it('registers chapter, work and exam with the frozen host', () => {
		const adapters = createIcourseAdapters({ getUrl: () => CHAPTER_URL })
		expect(adapters.map((adapter) => adapter.manifest.ref.variant)).toEqual([
			'icourse.chapter_test',
			'icourse.work',
			'icourse.exam',
		])
		expect(ICOURSE_HOSTS).toEqual(['icourse163.org'])
		expect(() => new QuestionAdapterRegistry(adapters)).not.toThrow()
	})

	it.each([
		['icourse.chapter_test', CHAPTER_URL, standardFixture()],
		['icourse.work', WORK_URL, standardFixture()],
		['icourse.exam', EXAM_URL, examFixture()],
	] as const)('probes and extracts %s', async (variant, url, html) => {
		document.body.innerHTML = html
		const adapter = createIcourseAdapters({ getUrl: () => url }).find(
			(candidate) => candidate.manifest.ref.variant === variant,
		)!
		expect(await adapter.probe(context())).toMatchObject({ matched: true })
		const [question] = await adapter.extract(context())
		expect(question.type).toBe('judgement')
		expect(question.options).toHaveLength(2)
		expect(adapter.manifest.questionDelayMs).toBe(5_000)
		expect(adapter.manifest.readiness).toMatchObject({
			requireNetworkQuiet: true,
			quietWindowMs: 5_000,
		})
	})

	it('excludes score/review routes and never exposes the chapter submit control', async () => {
		document.body.innerHTML = standardFixture()
		let url = WORK_URL.replace('/learn/quiz?', '/learn/quizscore?')
		const [, work] = createIcourseAdapters({ getUrl: () => url })
		expect(await work.probe(context())).toMatchObject({ matched: false })
		url = EXAM_URL.replace('examObject', 'examObjectScore')
		const exam = createIcourseAdapters({ getUrl: () => url })[2]
		document.body.innerHTML = examFixture()
		expect(await exam.probe(context())).toMatchObject({ matched: false })
		for (const adapter of createIcourseAdapters({ getUrl: () => CHAPTER_URL })) {
			expect(JSON.stringify(adapter.manifest)).not.toMatch(/j-submit|submit/i)
			expect(adapter.manifest.navigationProfiles[0]).toMatchObject({
				readOnly: 'none',
				afterFill: 'none',
			})
		}
	})

	it('requires both request and mutation quiet for five seconds', async () => {
		vi.useFakeTimers()
		let now = 0
		const execute = vi
			.fn()
			.mockResolvedValueOnce({ activeRequests: 1, lastNetworkAt: 0, lastMutationAt: 0 })
			.mockResolvedValue({ activeRequests: 0, lastNetworkAt: 0, lastMutationAt: 0 })
		document.body.innerHTML = standardFixture()
		const [adapter] = createIcourseAdapters({
			getUrl: () => CHAPTER_URL,
			now: () => now,
		})
		const ctx = context(execute)
		ctx.navigationProfileId = 'default'
		await adapter.extract(ctx)
		const ready = adapter.waitReady(ctx)
		await vi.advanceTimersByTimeAsync(0)
		now = 5_001
		await vi.advanceTimersByTimeAsync(250)
		expect(await ready).toMatchObject({ ready: true, networkQuietObserved: true })
		expect(execute).toHaveBeenCalledWith('common.network_quiet_snapshot', {})
	})

	it('treats icon judgement options as semantic options and preserves mixed images', async () => {
		document.body.innerHTML = standardFixture()
		const [adapter] = createIcourseAdapters({ getUrl: () => CHAPTER_URL })
		const [question] = await adapter.extract(context())
		expect(question.type).toBe('judgement')
		expect(question.stem.map((part) => part.type)).toEqual(['text', 'image', 'text'])
		expect(question.options.map((option) => option.key)).toEqual(['A', 'B'])
		expect(question.hasRequiredVisuals).toBe(true)
	})
})

function standardFixture(): string {
	return `
		<div class="u-questionItem" data-id="course-q1">
			<div class="j-title"><div class="j-richTxt">Is <img src="graph.png"> increasing?</div></div>
			<ul class="choices">
				<li data-option-key="A"><label><input type="radio" value="A"><i class="u-icon-correct"></i>对</label></li>
				<li data-option-key="B"><label><input type="radio" value="B"><i class="u-icon-wrong"></i>错</label></li>
			</ul>
		</div>
		<button class="j-submit">提交</button>
	`
}

function examFixture(): string {
	return `
		<div class="index-module__questionBody_x" data-id="exam-q1" data-question-type="判断">
			<div class="index-module__questionInfo_x">Exam statement</div>
			<label class="index-module__optionBody_x" data-option-key="A"><input type="radio" value="A">对</label>
			<label class="index-module__optionBody_x" data-option-key="B"><input type="radio" value="B">错</label>
		</div>
	`
}

function context(execute = vi.fn()): AdapterContext {
	let anchor = 0
	return {
		identity: { taskId: 'task', taskEpoch: 1, runId: `run-${Math.random()}` },
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
