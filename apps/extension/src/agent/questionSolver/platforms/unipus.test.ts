// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type {
	AdapterContext,
	ControlSnapshot,
	FillCommand,
	FixedMainWorldRuntime,
	StructuredAnswer,
} from '../contracts'
import { QuestionAdapterRegistry } from '../registry'
import { createUnipusAdapters, UNIPUS_HOSTS, UNIPUS_VARIANTS } from './unipus'

const URL = 'https://ucontent.unipus.cn/_explorationpc_default/pc.html?task=1'

const CASES = [
	['unipus.reading_fill', readingFillFixture()],
	['unipus.reading_choice', readingChoiceFixture()],
	['unipus.normal_choice', normalChoiceFixture()],
	['unipus.completion_translation', completionFixture()],
	['unipus.banked_cloze_input', bankedInputFixture()],
	['unipus.banked_cloze_dropdown', dropdownFixture()],
	['unipus.free_fill', freeFillFixture()],
	['unipus.line_matching', lineFixture()],
] as const

describe('U校园 classic adapters', () => {
	it('registers all eight variants with exact cross-task allowlists', () => {
		const adapters = createUnipusAdapters({ getUrl: () => URL })
		expect(adapters.map((adapter) => adapter.manifest.ref.variant)).toEqual(UNIPUS_VARIANTS)
		expect(UNIPUS_HOSTS).toEqual(['unipus.cn'])
		expect(() => new QuestionAdapterRegistry(adapters)).not.toThrow()
		for (const adapter of adapters.slice(0, 7)) {
			expect(adapter.manifest.navigationProfiles[0].allowedNextVariants).toEqual(UNIPUS_VARIANTS)
		}
		expect(adapters[7].manifest.navigationProfiles[0].allowedNextVariants).toEqual([])
	})

	it('attributes every adapter only to named functions that exist in the OCSJS source', () => {
		const source = readFileSync(
			resolve(
				process.cwd(),
				'../../ocsjs/ocsjs-4.0/packages/scripts/src/projects/unipus/exploration.ts',
			),
			'utf8',
		)
		const declaredFunctions = new Set(
			Array.from(source.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g), (match) =>
				String(match[1]),
			),
		)

		for (const adapter of createUnipusAdapters({ getUrl: () => URL })) {
			for (const attribution of adapter.manifest.sourceAttribution) {
				for (const symbol of attribution.symbols) {
					expect(declaredFunctions, `${adapter.manifest.ref.variant}: ${symbol}`).toContain(symbol)
				}
			}
		}
	})

	it.each(CASES)(
		'probes and extracts %s without any final-submit operation',
		async (variant, html) => {
			document.body.innerHTML = html
			const adapter = createUnipusAdapters({ getUrl: () => URL }).find(
				(candidate) => candidate.manifest.ref.variant === variant,
			)!
			const ctx = context()
			expect(await adapter.probe(ctx)).toMatchObject({ matched: true })
			const questions = await adapter.extract(ctx)
			expect(questions).toHaveLength(1)
			expect(questions[0].type).not.toBe('unknown')
			expect(JSON.stringify(adapter.manifest)).not.toMatch(/submit|hand.?in|finish.?exam/i)
		},
	)

	it('preserves reading material/image order and option images', async () => {
		document.body.innerHTML = readingChoiceFixture()
		const adapter = createUnipusAdapters({ getUrl: () => URL })[1]
		const [question] = await adapter.extract(context())
		expect(question.material?.map((part) => part.type)).toEqual(['text', 'image', 'text'])
		expect(question.options[1].content.map((part) => part.type)).toEqual(['text', 'image', 'text'])
		expect(question.hasRequiredVisuals).toBe(true)
	})

	it('replaces and restores controlled free-fill text through a fixed operation', async () => {
		document.body.innerHTML = freeFillFixture('old')
		const execute = vi.fn().mockResolvedValue(true)
		const adapter = createUnipusAdapters({ getUrl: () => URL })[6]
		const ctx = context(execute)
		ctx.navigationProfileId = 'default'
		const [question] = await adapter.extract(ctx)
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'completion',
			blanks: [{ key: 'blank-1', value: 'new' }],
			evidence: evidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = transactionOf(snapshot)
		expect(await adapter.setExactAnswers(ctx, transaction, commands)).toEqual([
			expect.objectContaining({ result: 'written' }),
		])
		expect((document.querySelector('#blank-1') as HTMLInputElement).value).toBe('new')
		expect(execute).toHaveBeenCalledWith(
			'unipus.controlled_input_set',
			expect.any(Object),
			expect.objectContaining({ snapshotDigest: snapshot.snapshotDigest }),
		)
		expect(await adapter.restoreControlState(ctx, transaction, snapshot)).toMatchObject({
			restored: true,
			verified: true,
		})
		expect((document.querySelector('#blank-1') as HTMLInputElement).value).toBe('old')
	})

	it('replaces a stale dropdown selection and rolls it back exactly', async () => {
		document.body.innerHTML = dropdownFixture()
		installDropdownFixtureBehavior()
		const adapter = createUnipusAdapters({ getUrl: () => URL })[5]
		const ctx = context()
		ctx.navigationProfileId = 'default'
		const [question] = await adapter.extract(ctx)
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'dropdown',
			dropdowns: [{ key: 'drop-1', optionKey: 'B' }],
			evidence: evidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = transactionOf(snapshot)
		expect(await adapter.setExactAnswers(ctx, transaction, commands)).toEqual([
			expect.objectContaining({ result: 'written' }),
		])
		expect(document.querySelector('.scoop-select-wrapper')?.getAttribute('data-selected-key')).toBe(
			'B',
		)
		expect(await adapter.verify(ctx, commands)).toEqual([
			expect.objectContaining({ dom: 'matched' }),
		])
		expect(await adapter.restoreControlState(ctx, transaction, snapshot)).toMatchObject({
			restored: true,
			verified: true,
		})
		expect(document.querySelector('.scoop-select-wrapper')?.getAttribute('data-selected-key')).toBe(
			'A',
		)
	})

	it('refuses ambiguous unbound dropdown portals instead of clicking another question', async () => {
		document.body.innerHTML = `
			<div class="question-wrap"><div class="question-title">First</div>
				<div class="scoop-select-wrapper" data-blank-key="drop-1" data-selected-key="A">
					<div class="input-wrapper"><button class="ant-dropdown-trigger" data-value="A">A</button></div>
					<i data-option-key="A" hidden>alpha</i><i data-option-key="B" hidden>beta</i>
				</div>
			</div>
			<div class="question-wrap"><div class="question-title">Second</div>
				<div class="scoop-select-wrapper" data-blank-key="drop-2" data-selected-key="A">
					<div class="input-wrapper"><button class="ant-dropdown-trigger" data-value="A">A</button></div>
					<i data-option-key="A" hidden>alpha</i><i data-option-key="B" hidden>beta</i>
				</div>
			</div>
			<div class="ant-dropdown-menu-item" data-option-key="B" id="portal-one">beta</div>
			<div class="ant-dropdown-menu-item" data-option-key="B" id="portal-two">beta</div>
		`
		const clicks = [vi.fn(), vi.fn()]
		document.querySelector('#portal-one')?.addEventListener('click', clicks[0])
		document.querySelector('#portal-two')?.addEventListener('click', clicks[1])
		const adapter = createUnipusAdapters({ getUrl: () => URL })[5]
		const ctx = context()
		ctx.navigationProfileId = 'default'
		const [question] = await adapter.extract(ctx)
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'dropdown',
			dropdowns: [{ key: 'drop-1', optionKey: 'B' }],
			evidence: evidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)

		expect(await adapter.setExactAnswers(ctx, transactionOf(snapshot), commands)).toEqual([
			expect.objectContaining({ result: 'not_written', changed: false }),
		])
		expect(clicks[0]).not.toHaveBeenCalled()
		expect(clicks[1]).not.toHaveBeenCalled()
		expect(
			document.querySelector('[data-blank-key="drop-1"]')?.getAttribute('data-selected-key'),
		).toBe('A')
	})

	it('refuses a single stale visible portal when an unbound trigger opens nothing', async () => {
		document.body.innerHTML = `
			<div class="question-wrap"><div class="question-title">Target</div>
				<div class="scoop-select-wrapper" data-blank-key="drop-1" data-selected-key="A">
					<div class="input-wrapper"><button class="ant-dropdown-trigger" data-value="A">A</button></div>
					<i data-option-key="A" hidden>alpha</i><i data-option-key="B" hidden>beta</i>
				</div>
			</div>
			<div class="ant-dropdown-menu-item" data-option-key="B" id="stale-portal">stale beta</div>
		`
		const staleClick = vi.fn()
		document.querySelector('#stale-portal')?.addEventListener('click', staleClick)
		const adapter = createUnipusAdapters({ getUrl: () => URL })[5]
		const ctx = context()
		ctx.navigationProfileId = 'default'
		const [question] = await adapter.extract(ctx)
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'dropdown',
			dropdowns: [{ key: 'drop-1', optionKey: 'B' }],
			evidence: evidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)

		expect(await adapter.setExactAnswers(ctx, transactionOf(snapshot), commands)).toEqual([
			expect.objectContaining({ result: 'not_written', changed: false }),
		])
		expect(staleClick).not.toHaveBeenCalled()
	})

	it('reorders line items exactly and restores the previous order without navigation', async () => {
		document.body.innerHTML = lineFixture()
		const adapter = createUnipusAdapters({ getUrl: () => URL })[7]
		const ctx = context()
		ctx.navigationProfileId = 'default'
		const [question] = await adapter.extract(ctx)
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'line',
			linePairs: question.subQuestions!.map((subQuestion, index) => ({
				leftKey: subQuestion.locator.fingerprint,
				rightKey: ['C', 'A', 'B'][index],
			})),
			evidence: evidence(question.locator.fingerprint),
		}
		const commands = [command(question.locator, answer)]
		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = transactionOf(snapshot)
		expect(await adapter.setExactAnswers(ctx, transaction, commands)).toEqual([
			expect.objectContaining({ result: 'written' }),
		])
		expect(itemOrder()).toEqual(['C', 'A', 'B'])
		expect(await adapter.restoreControlState(ctx, transaction, snapshot)).toMatchObject({
			restored: true,
			verified: true,
		})
		expect(itemOrder()).toEqual(['A', 'B', 'C'])
		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false, mode: 'none' })
	})

	it('accepts only the exact 下一题 control and never a submission control', async () => {
		document.body.innerHTML = `${normalChoiceFixture(false)}<button>下一题目</button><button>提交</button>`
		const adapter = createUnipusAdapters({ getUrl: () => URL })[2]
		const ctx = context()
		ctx.navigationProfileId = 'default'
		await adapter.extract(ctx)
		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false })
		const next = document.createElement('button')
		next.textContent = ' 下 一 题 '
		document.body.append(next)
		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: true })
	})
})

function readingFillFixture(): string {
	return `
		<div class="layout-material-container">Passage <img src="passage.png"> text</div>
		<div class="layout-reply-container">
			<div class="question-common-abs-reply"><div class="question-inputbox-header">Fill</div><div class="question-inputbox-body"><textarea id="rf-1"></textarea></div></div>
		</div><button>下一题</button>
	`
}

function readingChoiceFixture(): string {
	return `
		<div class="layout-material-container">Before <img src="chart.png"> after</div>
		<div class="layout-reply-container">
			<div class="question-common-abs-choice"><div class="ques-title">Choose</div><div class="option-wrap">
				<label class="option" data-option-key="A"><input type="radio" value="A"><span class="content">A. Alpha</span></label>
				<label class="option" data-option-key="B"><input type="radio" value="B"><span class="content">B. before <img src="b.png"> after</span></label>
			</div></div>
		</div><button>下一题</button>
	`
}

function normalChoiceFixture(withNext = true): string {
	return `
		<div class="layout-reply-container">
			<div class="question-common-abs-choice"><div class="ques-title">多选: Choose</div><div class="option-wrap">
				<label class="option" data-option-key="A"><input type="checkbox" value="A"><span class="content">A. Alpha</span></label>
				<label class="option" data-option-key="B"><input type="checkbox" value="B"><span class="content">B. Beta</span></label>
			</div></div>
		</div>${withNext ? '<button>下一题</button>' : ''}
	`
}

function completionFixture(): string {
	return `
		<div class="layout-reply-container"><div class="full">
			<div class="question-common-abs-reply"><div class="question-inputbox-header">翻译句子</div><div class="question-inputbox-body"><textarea id="ct-1"></textarea></div></div>
		</div></div><button>下一题</button>
	`
}

function bankedInputFixture(): string {
	return `
		<div class="question-material-banked-cloze-scoop">Banked passage</div>
		<div class="option-wrapper"><span class="option">alpha</span><span class="option">beta</span></div>
		<div class="question-material-banked-cloze-reply"><div class="question-wrap"><div class="input-wrapper"><input id="bank-1"></div></div></div>
		<button>下一题</button>
	`
}

function dropdownFixture(): string {
	return `
		<div class="question-wrap"><div class="question-title">Select words</div>
			<div class="scoop-select-wrapper" data-blank-key="drop-1" data-selected-key="A">
				<div class="input-wrapper"><button class="ant-dropdown-trigger" data-value="A">A</button></div>
				<i data-option-key="A">alpha</i><i data-option-key="B">beta</i>
			</div>
		</div><button>下一题</button>
	`
}

function freeFillFixture(value = ''): string {
	return `
		<div class="layout-reply-container"><div class="question-title">Complete</div><div class="fe-scoop"><div class="scoop-input-wrapper"><input id="blank-1" value="${value}"></div></div></div>
		<button>下一题</button>
	`
}

function lineFixture(): string {
	return `
		<div class="question-wrap"><div class="sequence-view">Order these</div><div class="sequence-reply-view">
			<div class="sequence-reply-view-item-text" data-id="A">Alpha</div>
			<div class="sequence-reply-view-item-text" data-id="B">Beta</div>
			<div class="sequence-reply-view-item-text" data-id="C">Gamma</div>
		</div></div><button>提交</button>
	`
}

function installDropdownFixtureBehavior(): void {
	const container = document.querySelector<HTMLElement>('.scoop-select-wrapper')!
	for (const option of Array.from(container.querySelectorAll<HTMLElement>('[data-option-key]'))) {
		option.addEventListener('click', () => {
			const key = option.getAttribute('data-option-key') ?? ''
			container.setAttribute('data-selected-key', key)
			container.querySelector('.ant-dropdown-trigger')?.setAttribute('data-value', key)
		})
	}
}

function itemOrder(): string[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.sequence-reply-view-item-text')).map(
		(item) => item.dataset.id ?? '',
	)
}

function context(execute = vi.fn().mockResolvedValue(true)): AdapterContext {
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
