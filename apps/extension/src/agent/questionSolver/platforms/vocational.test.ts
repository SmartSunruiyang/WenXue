// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import type {
	AdapterContext,
	ControlSnapshot,
	FillCommand,
	FixedMainWorldRuntime,
	StructuredAnswer,
} from '../contracts'
import { QuestionAdapterRegistry } from '../registry'
import { createVocationalAdapters, ICVE_HOSTS, ZJY_HOSTS } from './vocational'

describe('ZJY and ICVE adapters', () => {
	it('registers the exact three vocational variants and frozen hosts', () => {
		const adapters = createVocationalAdapters({ getUrl: () => zjyUrl() })
		expect(adapters.map((adapter) => adapter.manifest.ref.variant)).toEqual([
			'zjy.legacy_work_exam',
			'icve.standard_work_exam',
			'icve.ai_work',
		])
		expect(ZJY_HOSTS).toContain('zjy2.icve.com.cn')
		expect(ICVE_HOSTS).toContain('webtrn.cn')
		expect(() => new QuestionAdapterRegistry(adapters)).not.toThrow()
	})

	it('matches legacy ZJY work but explicitly rejects study/v2', async () => {
		let url = zjyUrl()
		document.body.innerHTML = zjyFixture()
		const [adapter] = createVocationalAdapters({ getUrl: () => url })
		expect(await adapter.probe(context())).toMatchObject({ matched: true })
		url = 'https://zjy2.icve.com.cn/study/v2/work/123'
		expect(await adapter.probe(context())).toMatchObject({
			matched: false,
			evidenceCodes: expect.arrayContaining(['route_mismatch']),
		})
	})

	it('extracts mixed ZJY controls without adding navigation or submit', async () => {
		document.body.innerHTML = zjyFixture()
		const [adapter] = createVocationalAdapters({ getUrl: () => zjyUrl() })
		const [question] = await adapter.extract(context())
		expect(question.type).toBe('multiple')
		expect(question.options.map((option) => option.key)).toEqual(['A', 'B'])
		expect(adapter.manifest.navigationProfiles[0].afterFill).toBe('none')
		expect(JSON.stringify(adapter.manifest)).not.toMatch(/submit/i)
	})

	it('writes and restores ICVE UEditor through the fixed operation', async () => {
		document.body.innerHTML = icveUeditorFixture()
		const execute = vi.fn().mockResolvedValue(true)
		const adapter = createVocationalAdapters({
			getUrl: () => 'https://course.icve.com.cn/exam/1',
		})[1]
		const ctx = context(execute)
		ctx.navigationProfileId = 'default'
		expect(await adapter.probe(ctx)).toMatchObject({ matched: true })
		const [question] = await adapter.extract(ctx)
		expect(question.type).toBe('completion')
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'completion',
			blanks: [{ key: 'ueditor-1', value: 'replacement' }],
			evidence: evidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = transactionOf(snapshot)
		expect(await adapter.setExactAnswers(ctx, transaction, commands)).toEqual([
			expect.objectContaining({ result: 'written' }),
		])
		expect(execute).toHaveBeenCalledWith(
			'icve.ueditor_set',
			expect.any(Object),
			expect.objectContaining({ snapshotDigest: snapshot.snapshotDigest }),
		)
		expect(await adapter.verify(ctx, commands)).toEqual([
			expect.objectContaining({ dom: 'matched' }),
		])
		expect(await adapter.restoreControlState(ctx, transaction, snapshot)).toMatchObject({
			restored: true,
			verified: true,
		})
	})

	it('routes AI image options to vision and stops on a disabled next button', async () => {
		document.body.innerHTML = icveAiFixture()
		const adapter = createVocationalAdapters({
			getUrl: () => 'https://ai.icve.com.cn/preview-exam/1',
		})[2]
		const ctx = context()
		ctx.navigationProfileId = 'default'
		expect(await adapter.probe(ctx)).toMatchObject({ matched: true })
		const [question] = await adapter.extract(ctx)
		expect(question.type).toBe('single')
		expect(question.hasRequiredVisuals).toBe(true)
		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false })
	})
})

function zjyUrl(): string {
	return 'https://zyk.icve.com.cn/study/spockeepTest/1'
}

function zjyFixture(): string {
	return `
		<div class="subjectList">
			<div class="subjectDet" data-id="zjy-1">
				<h3>Select all</h3>
				<div class="optionList">
					<div data-option-key="A"><label><input type="checkbox" value="A">A. one</label></div>
					<div data-option-key="B"><label><input type="checkbox" value="B">B. two</label></div>
				</div>
			</div>
		</div>
	`
}

function icveUeditorFixture(): string {
	return `
		<div class="q_content" data-id="icve-1">
			<div class="divQuestionTitle">Explain</div>
			<div class="questionOptions divTextarea">
				<iframe id="ueditor-1"></iframe>
			</div>
		</div>
		<button class="paging_next">下一题</button>
	`
}

function icveAiFixture(): string {
	return `
		<div class="content-item" data-id="ai-1">
			<div class="questions-type">单选题</div>
			<div class="questions-content"><div class="title-content-x">Pick the diagram</div></div>
			<label class="group-item-a" data-option-key="A"><input type="radio" value="A"><img src="a.png"></label>
			<label class="group-item-b" data-option-key="B"><input type="radio" value="B"><img src="b.png"></label>
		</div>
		<div class="center_btn"><button>上一题</button><button disabled>下一题</button></div>
	`
}

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

function transactionOf(snapshot: ControlSnapshot) {
	return {
		transactionId: snapshot.transactionId,
		snapshotDigestVersion: 1 as const,
		snapshotDigest: snapshot.snapshotDigest,
	}
}

function evidence(questionFingerprint: string): StructuredAnswer['evidence'] {
	return {
		source: 'llm_text',
		questionFingerprint,
		mappingConfidence: 1,
		modelConfidence: 0.9,
		warnings: [],
	}
}
