// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
	AdapterContext,
	FillCommand,
	FixedMainWorldRuntime,
	StructuredAnswer,
} from '../contracts'
import { QuestionAdapterRegistry } from '../registry'
import { createChaoxingAdapters, CX_DOMAINS, mapChaoxingTypeCode } from './chaoxing'

describe('Chaoxing question adapters', () => {
	let currentUrl: string

	beforeEach(() => {
		currentUrl = 'https://mooc1.chaoxing.com/mooc2/work/dowork?id=1'
		document.body.innerHTML = modernFixture()
	})

	it('freezes the OCSJS mirror host list and both production variants', () => {
		expect(CX_DOMAINS).toContain('chaoxing.com')
		expect(CX_DOMAINS).toContain('sslibrary.com')
		const adapters = createChaoxingAdapters({ getUrl: () => currentUrl })
		expect(adapters.map((adapter) => adapter.manifest.ref.variant)).toEqual([
			'chaoxing.modern_work_exam',
			'chaoxing.chapter_test',
		])
		expect(() => new QuestionAdapterRegistry(adapters)).not.toThrow()
	})

	it('maps the complete OCSJS question type codes', () => {
		expect(mapChaoxingTypeCode(0)).toBe('single')
		expect(mapChaoxingTypeCode(1)).toBe('multiple')
		expect(mapChaoxingTypeCode(3)).toBe('judgement')
		expect(mapChaoxingTypeCode(8)).toBe('completion')
		expect(mapChaoxingTypeCode(11)).toBe('line')
		expect(mapChaoxingTypeCode(14)).toBe('fill')
		expect(mapChaoxingTypeCode(15)).toBe('reader')
		expect(mapChaoxingTypeCode(99)).toBe('unknown')
	})

	it('selects serial only when the route exposes the fixed next control', async () => {
		const [adapter] = createChaoxingAdapters({ getUrl: () => currentUrl })
		const ctx = context()
		expect(await adapter.probe(ctx)).toMatchObject({
			matched: true,
			navigationProfileId: 'chaoxing.modern.serial',
		})

		currentUrl = 'https://mooc1.chaoxing.com/mooc2/exam/preview?id=1'
		expect(await adapter.probe(ctx)).toMatchObject({
			matched: true,
			navigationProfileId: 'chaoxing.modern.preview',
		})

		currentUrl = 'https://mooc1.chaoxing.com/mooc2/work/dowork?id=1'
		document.querySelector('[onclick="getTheNextQuestion(1)"]')?.remove()
		expect(await adapter.probe(ctx)).toMatchObject({
			matched: true,
			navigationProfileId: 'chaoxing.modern.preview',
		})
	})

	it('preserves mixed stem images and replaces the old selected choice exactly', async () => {
		const [adapter] = createChaoxingAdapters({ getUrl: () => currentUrl })
		const ctx = context()
		ctx.navigationProfileId = 'chaoxing.modern.serial'
		const [question] = await adapter.extract(ctx)
		expect(question.type).toBe('single')
		expect(question.stem.map((part) => part.type)).toEqual(['text', 'image', 'text'])
		expect(question.options.map((option) => option.key)).toEqual(['A', 'B'])

		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'single',
			selectedOptions: ['B'],
			evidence: {
				source: 'llm_vision',
				questionFingerprint: question.locator.fingerprint,
				mappingConfidence: 1,
				modelConfidence: 0.92,
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
			expect.objectContaining({ result: 'written', changed: true }),
		])
		expect(
			(document.querySelector('[data-option-key="A"] input') as HTMLInputElement).checked,
		).toBe(false)
		expect(
			(document.querySelector('[data-option-key="B"] input') as HTMLInputElement).checked,
		).toBe(true)
		expect(await adapter.verify(ctx, commands)).toEqual([
			expect.objectContaining({ dom: 'matched' }),
		])
		expect(await adapter.restoreControlState(ctx, transaction, snapshot)).toMatchObject({
			restored: true,
			verified: true,
		})
		expect(
			(document.querySelector('[data-option-key="A"] input') as HTMLInputElement).checked,
		).toBe(true)
	})

	it('extracts reader subquestions in production and rejects a mismatched sub-answer identity', async () => {
		document.body.innerHTML = readerFixture()
		const [adapter] = createChaoxingAdapters({ getUrl: () => currentUrl })
		const ctx = context()
		const [question] = await adapter.extract(ctx)

		expect(question).toMatchObject({
			type: 'reader',
			options: [],
			hasRequiredVisuals: true,
		})
		expect(question.material?.map((part) => part.type)).toEqual(['text', 'image', 'text'])
		expect(question.subQuestions).toHaveLength(2)
		expect(question.subQuestions?.map((subQuestion) => subQuestion.stem[0])).toEqual([
			{ type: 'text', text: 'First subquestion' },
			{ type: 'text', text: 'Second subquestion' },
		])
		expect(
			question.subQuestions?.map((subQuestion) => subQuestion.options.map(({ key }) => key)),
		).toEqual([
			['A', 'B'],
			['A', 'B'],
		])
		expect(
			new Set(question.subQuestions?.map((subQuestion) => subQuestion.locator.fingerprint)).size,
		).toBe(2)

		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'reader',
			subAnswers: question.subQuestions!.map((subQuestion, index) => ({
				questionFingerprint: index === 0 ? 'f'.repeat(64) : subQuestion.locator.fingerprint,
				type: 'single',
				selectedOptions: ['B'],
				evidence: answerEvidence(subQuestion.locator.fingerprint),
			})),
			evidence: answerEvidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const attempts = await adapter.setExactAnswers(
			ctx,
			{
				transactionId: snapshot.transactionId,
				snapshotDigestVersion: 1,
				snapshotDigest: snapshot.snapshotDigest,
			},
			commands,
		)

		expect(attempts).toEqual([
			expect.objectContaining({
				result: 'not_written',
				changed: false,
				warningCodes: ['answer_binding_mismatch'],
			}),
		])
		expect(await adapter.verify(ctx, commands)).toEqual([
			expect.objectContaining({
				dom: 'mismatch',
				warningCodes: ['answer_binding_mismatch'],
			}),
		])
		expect(selectedSubOptions('.reading_answer')).toEqual(['A', 'A'])
	})

	it('refuses every write when a reader subquestion changes after extraction', async () => {
		document.body.innerHTML = readerFixture()
		const [adapter] = createChaoxingAdapters({ getUrl: () => currentUrl })
		const ctx = context()
		const [question] = await adapter.extract(ctx)
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'reader',
			subAnswers: question.subQuestions!.map((subQuestion) => ({
				questionFingerprint: subQuestion.locator.fingerprint,
				type: 'single',
				selectedOptions: ['B'],
				evidence: answerEvidence(subQuestion.locator.fingerprint),
			})),
			evidence: answerEvidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = {
			transactionId: snapshot.transactionId,
			snapshotDigestVersion: 1 as const,
			snapshotDigest: snapshot.snapshotDigest,
		}
		const changedStem = document.querySelectorAll<HTMLElement>('.reading_answer p')[1]
		changedStem.textContent = 'A different subquestion replaced this row'

		await expect(adapter.setExactAnswers(ctx, transaction, commands)).rejects.toThrow(
			'question_fingerprint_mismatch',
		)
		expect(selectedSubOptions('.reading_answer')).toEqual(['A', 'A'])
	})

	it('models line boxes as subquestions and verifies exact keyed replacement', async () => {
		document.body.innerHTML = modernLineFixture()
		installLineSelectionBehavior()
		const [adapter] = createChaoxingAdapters({ getUrl: () => currentUrl })
		const ctx = context()
		const [question] = await adapter.extract(ctx)

		expect(question.type).toBe('line')
		expect(question.options).toEqual([])
		expect(
			question.subQuestions?.map((subQuestion) => subQuestion.options.map(({ key }) => key)),
		).toEqual([
			['A', 'B'],
			['A', 'B'],
		])

		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'line',
			linePairs: question.subQuestions!.map((subQuestion) => ({
				leftKey: subQuestion.locator.fingerprint,
				rightKey: 'B',
			})),
			evidence: answerEvidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = {
			transactionId: snapshot.transactionId,
			snapshotDigestVersion: 1 as const,
			snapshotDigest: snapshot.snapshotDigest,
		}

		expect(await adapter.setExactAnswers(ctx, transaction, commands)).toEqual([
			expect.objectContaining({ result: 'written', changed: true }),
		])
		expect(selectedSubOptions('.line_answer_ct .selectBox')).toEqual(['B', 'B'])
		expect(await adapter.verify(ctx, commands)).toEqual([
			expect.objectContaining({ dom: 'matched' }),
		])
		expect(await adapter.restoreControlState(ctx, transaction, snapshot)).toMatchObject({
			restored: true,
			verified: true,
		})
		expect(selectedSubOptions('.line_answer_ct .selectBox')).toEqual(['A', 'A'])
	})

	it('recognizes chapter-test line questions without exposing navigation or submit', async () => {
		currentUrl = 'https://mooc1.chaoxing.com/knowledge/cards?knowledgeId=1'
		document.body.innerHTML = chapterFixture()
		const [, adapter] = createChaoxingAdapters({ getUrl: () => currentUrl })
		const ctx = context()
		ctx.navigationProfileId = 'default'
		expect(await adapter.probe(ctx)).toMatchObject({
			matched: true,
			navigationProfileId: 'default',
		})
		const [question] = await adapter.extract(ctx)
		expect(question.type).toBe('line')
		expect(adapter.manifest.navigationProfiles[0]).toMatchObject({
			readOnly: 'none',
			afterFill: 'none',
		})
		expect(JSON.stringify(adapter.manifest)).not.toMatch(/submit/i)
	})

	it('never treats the final submit control as the serial next control', async () => {
		document.querySelector('[onclick="getTheNextQuestion(1)"]')?.remove()
		const submit = document.createElement('button')
		submit.textContent = '提交'
		submit.onclick = vi.fn()
		document.body.append(submit)
		const [adapter] = createChaoxingAdapters({ getUrl: () => currentUrl })
		const match = await adapter.probe(context())
		expect(match.navigationProfileId).toBe('chaoxing.modern.preview')
	})
})

function context(): AdapterContext {
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
		mainWorld: { execute: vi.fn() } as unknown as FixedMainWorldRuntime,
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

function answerEvidence(questionFingerprint: string): StructuredAnswer['evidence'] {
	return {
		source: 'llm_text',
		questionFingerprint,
		mappingConfidence: 1,
		modelConfidence: 0.95,
		warnings: [],
	}
}

function selectedSubOptions(selector: string): string[] {
	return Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
		(container) =>
			container.querySelector<HTMLElement>('[data].selected')?.getAttribute('data') ?? '',
	)
}

function installLineSelectionBehavior(): void {
	for (const box of document.querySelectorAll<HTMLElement>('.line_answer_ct .selectBox')) {
		const choices = Array.from(box.querySelectorAll<HTMLElement>('li[data]'))
		for (const choice of choices) {
			choice.querySelector('a')?.addEventListener('click', () => {
				for (const peer of choices) peer.classList.remove('selected')
				choice.classList.add('selected')
			})
		}
	}
}

function modernFixture(): string {
	return `
		<div class="questionLi" data-question-id="cx-q1">
			<input id="answertype-cx-q1" value="0" />
			<h3>Which <img alt="shape" /> is correct?</h3>
			<div class="answerBg">
				<label class="answer_p" data-option-key="A"><input type="radio" name="q1" checked />A. Circle</label>
				<label class="answer_p" data-option-key="B"><input type="radio" name="q1" />B. Square</label>
			</div>
		</div>
		<button onclick="getTheNextQuestion(1)">下一题</button>
	`
}

function chapterFixture(): string {
	return `
		<div class="TiMu" data-question-id="chapter-q1">
			<input id="answertype-chapter-q1" value="11" />
			<div class="Zy_TItle"><div class="clearfix">Match the pairs</div></div>
			<div class="thirdUlList">
				<select class="dept_select"><option value="A" selected>A</option><option value="B">B</option></select>
			</div>
		</div>
	`
}

function readerFixture(): string {
	return `
		<div class="questionLi" data-question-id="reader-root">
			<input id="answertype-reader-root" value="15" />
			<div class="reader-material">Before <img src="/reader.png" /> after</div>
			<h3>Reader root</h3>
			<div class="reading_answer" data-subquestion="1">
				<p>First subquestion</p>
				<span class="saveSingleSelect selected" data="A">Old one</span>
				<span class="saveSingleSelect" data="B">New one</span>
			</div>
			<div class="reading_answer" data-subquestion="2">
				<p>Second subquestion</p>
				<span class="saveSingleSelect selected" data="A">Old two</span>
				<span class="saveSingleSelect" data="B">New two</span>
			</div>
		</div>
	`
}

function modernLineFixture(): string {
	return `
		<div class="questionLi" data-question-id="line-root">
			<input id="answertype-line-root" value="11" />
			<h3>Match both rows.</h3>
			<div class="line_answer_ct">
				<div class="selectBox">
					<ul><li class="selected" data="A"><a>A</a></li><li data="B"><a>B</a></li></ul>
				</div>
				<div class="selectBox">
					<ul><li class="selected" data="A"><a>A</a></li><li data="B"><a>B</a></li></ul>
				</div>
			</div>
		</div>
	`
}
