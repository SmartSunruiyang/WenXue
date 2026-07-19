// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
	AdapterContext,
	ControlSnapshot,
	FillCommand,
	FixedMainWorldRuntime,
	StructuredAnswer,
} from './contracts'
import { createGenericQuestionAdapter } from './platforms/generic'

const TOP_FIXTURE = readFixture('assessment-lab.html')
const FRAME_FIXTURE = readFixture('assessment-frame.html')

describe('local question solver assessment lab', () => {
	beforeEach(() => {
		document.body.innerHTML = bodyOf(FRAME_FIXTURE)
	})

	it('models an iframe assessment without embedding a hidden answer key', () => {
		expect(TOP_FIXTURE).toContain('data-question-fixture-frame')
		expect(TOP_FIXTURE).toContain('./assessment-frame.html')
		expect(FRAME_FIXTURE).toContain('data-final-submit')
		expect(FRAME_FIXTURE).not.toMatch(/data-correct|correctAnswer|standardAnswer|rightAnswer/i)
	})

	it('keeps top-document discovery empty and extracts the child-frame question surface', async () => {
		document.body.innerHTML = bodyOf(TOP_FIXTURE)
		const topAdapter = adapter('https://fixture.invalid/assessment-lab.html')
		expect(await topAdapter.probe(context('top-run', 0))).toMatchObject({ matched: false })

		document.body.innerHTML = bodyOf(FRAME_FIXTURE)
		const registered: Array<{ role: string; optionKey?: string }> = []
		const frameAdapter = adapter('https://fixture.invalid/assessment-frame.html')
		const ctx = context('frame-run', 4, (entry) => {
			registered.push(entry)
			return `fixture-anchor-${registered.length}`
		})
		expect(await frameAdapter.probe(ctx)).toMatchObject({ matched: true })
		const questions = await frameAdapter.extract(ctx)

		expect(questions.map((question) => question.type)).toEqual(['single', 'single', 'completion'])
		expect(questions[0].stem.map((part) => part.type)).toEqual(['text', 'image', 'text'])
		expect(questions[0].options[0].content.map((part) => part.type)).toEqual(['text', 'image'])
		expect(questions[0].options[1].content.map((part) => part.type)).toEqual(['image'])
		expect(questions[1].options).toHaveLength(4)
		expect(questions[1].options.every((option) => option.content[0]?.type === 'image')).toBe(true)
		expect(FRAME_FIXTURE).not.toMatch(/name="image-only-1"[\s\S]{0,160}<img[^>]+(?:alt|title)=/i)
		expect(questions.slice(0, 2).every((question) => question.hasRequiredVisuals)).toBe(true)
		expect(registered).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: 'stem' }),
				expect.objectContaining({ role: 'option', optionKey: 'A' }),
				expect.objectContaining({ role: 'option', optionKey: 'B' }),
			]),
		)
	})

	it('fills exact synthetic state, verifies it, restores the draft, and never submits', async () => {
		const submit = document.querySelector<HTMLElement>('[data-final-submit]')
		const submitClick = vi.fn()
		submit?.addEventListener('click', submitClick)
		const questionAdapter = adapter('https://fixture.invalid/assessment-frame.html')
		const ctx = context('fill-run', 2)
		const [question] = await questionAdapter.extract(ctx)
		const commands = [command(question, 'B')]
		const snapshot = await questionAdapter.captureControlState(ctx, commands)
		const transaction = transactionOf(snapshot)

		expect(await questionAdapter.setExactAnswers(ctx, transaction, commands)).toEqual([
			expect.objectContaining({ result: 'written', changed: true }),
		])
		expect(await questionAdapter.verify(ctx, commands)).toEqual([
			expect.objectContaining({ dom: 'matched' }),
		])
		expect(
			(document.querySelector('[name="mixed-1"][value="A"]') as HTMLInputElement).checked,
		).toBe(false)
		expect(
			(document.querySelector('[name="mixed-1"][value="B"]') as HTMLInputElement).checked,
		).toBe(true)
		expect(submitClick).not.toHaveBeenCalled()

		expect(await questionAdapter.restoreControlState(ctx, transaction, snapshot)).toMatchObject({
			restored: true,
			verified: true,
			pageMayRemainModified: false,
		})
		expect(
			(document.querySelector('[name="mixed-1"][value="A"]') as HTMLInputElement).checked,
		).toBe(true)
		expect(submitClick).not.toHaveBeenCalled()
	})

	it('interrupts on a visible captcha instead of reading, answering, or filling through it', async () => {
		const questionAdapter = adapter('https://fixture.invalid/assessment-frame.html')
		const ctx = context('interrupt-run', 2)
		expect(await questionAdapter.probeInterrupts(ctx)).toMatchObject({ blocked: false })
		document.querySelector<HTMLElement>('.captcha-dialog')?.removeAttribute('hidden')
		expect(await questionAdapter.probeInterrupts(ctx)).toMatchObject({
			blocked: true,
			kind: 'captcha',
			evidenceCodes: ['interrupt.captcha'],
		})
	})
})

function adapter(url: string) {
	return createGenericQuestionAdapter({ getUrl: () => url })
}

function context(
	runId: string,
	frameId: number,
	registerImage: (entry: { role: string; optionKey?: string }) => string = (() => {
		let index = 0
		return () => `fixture-anchor-${++index}`
	})(),
): AdapterContext {
	return {
		identity: { taskId: 'fixture-task', taskEpoch: 1, runId },
		frame: {
			tabId: 1,
			frameId,
			parentFrameId: frameId === 0 ? -1 : 0,
			documentId: `fixture-document-${frameId}`,
			documentToken: `fixture-token-${frameId}`,
			urlFingerprint: 'f'.repeat(64),
		},
		action: 'fill',
		scope: 'current_page',
		navigationProfileId: 'default',
		signal: new AbortController().signal,
		mainWorld: { execute: vi.fn() } as unknown as FixedMainWorldRuntime,
		anchors: {
			registerImage: (entry) =>
				registerImage({
					role: entry.role,
					optionKey: entry.optionKey,
				}),
		},
	}
}

function command(
	question: { locator: FillCommand['locator'] },
	selectedOption: string,
): FillCommand {
	const answer: StructuredAnswer = {
		questionFingerprint: question.locator.fingerprint,
		type: 'single',
		selectedOptions: [selectedOption],
		evidence: {
			source: 'llm_vision',
			questionFingerprint: question.locator.fingerprint,
			mappingConfidence: 1,
			modelConfidence: 0.9,
			warnings: [],
		},
	}
	return {
		locator: question.locator,
		expectedLogicalPageFingerprint: 'fixture-page',
		expectedBindingFingerprint: 'fixture-binding',
		answer,
	}
}

function transactionOf(snapshot: ControlSnapshot) {
	return {
		transactionId: snapshot.transactionId,
		snapshotDigestVersion: 1 as const,
		snapshotDigest: snapshot.snapshotDigest,
	}
}

function readFixture(name: string): string {
	return readFileSync(join(process.cwd(), 'test-fixtures', 'question-solver', name), 'utf8')
}

function bodyOf(html: string): string {
	return /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
}
