// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import type {
	AdapterContext,
	FillCommand,
	FixedMainWorldRuntime,
	StructuredAnswer,
} from '../contracts'
import { createGenericQuestionAdapter } from './generic'

describe('generic standard HTML fallback', () => {
	it('requires an explicit stem and at least two mapped choices', async () => {
		let html = '<div class="question"><p>Loose text</p><input type="radio"></div>'
		document.body.innerHTML = html
		const adapter = createGenericQuestionAdapter({ getUrl: () => 'https://example.test/quiz' })
		expect(await adapter.probe(context())).toMatchObject({ matched: false })

		html = `
			<fieldset class="question" data-question data-question-type="single">
				<legend>Pick one</legend>
				<label data-option-key="A"><input type="radio" name="q" value="A" checked>A</label>
				<label data-option-key="B"><input type="radio" name="q" value="B">B</label>
			</fieldset>
		`
		document.body.innerHTML = html
		expect(await adapter.probe(context())).toMatchObject({ matched: true, score: 1 })
	})

	it('fills exact standard controls but has no pagination or embedded source', async () => {
		document.body.innerHTML = `
			<fieldset data-question data-question-type="single">
				<legend>Pick one</legend>
				<label data-option-key="A"><input type="radio" name="q" value="A" checked>A</label>
				<label data-option-key="B"><input type="radio" name="q" value="B">B</label>
			</fieldset>
		`
		const adapter = createGenericQuestionAdapter({ getUrl: () => 'https://example.test/quiz' })
		const ctx = context()
		ctx.navigationProfileId = 'default'
		const [question] = await adapter.extract(ctx)
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'single',
			selectedOptions: ['B'],
			evidence: {
				source: 'llm_text',
				questionFingerprint: question.locator.fingerprint,
				mappingConfidence: 1,
				modelConfidence: 0.9,
				warnings: [],
			},
		}
		const commands: FillCommand[] = [
			{
				locator: question.locator,
				expectedLogicalPageFingerprint: 'page',
				expectedBindingFingerprint: 'binding',
				answer,
			},
		]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = {
			transactionId: snapshot.transactionId,
			snapshotDigestVersion: 1 as const,
			snapshotDigest: snapshot.snapshotDigest,
		}
		expect(await adapter.setExactAnswers(ctx, transaction, commands)).toEqual([
			expect.objectContaining({ result: 'written' }),
		])
		expect((document.querySelector('[value="A"]') as HTMLInputElement).checked).toBe(false)
		expect((document.querySelector('[value="B"]') as HTMLInputElement).checked).toBe(true)
		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false, mode: 'none' })
		expect(adapter.manifest.embedded).toEqual({ domProjectionIds: [], runtimeOperationIds: [] })
	})
})

function context(): AdapterContext {
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
		mainWorld: { execute: vi.fn() } as unknown as FixedMainWorldRuntime,
		anchors: { registerImage: () => 'anchor' },
	}
}
