// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
	AdapterContext,
	AdapterManifest,
	FillCommand,
	FixedMainWorldRuntime,
	StructuredAnswer,
} from '../contracts'
import { createDomQuestionAdapter } from './sharedDom'

describe('declarative question adapter', () => {
	beforeEach(() => {
		document.body.innerHTML = fixtureHtml()
		window.history.replaceState({}, '', '/quiz/attempt/1')
	})

	it('probes host+route+DOM and preserves mixed text/image order with bound ownership', async () => {
		const registered: Array<{ questionFingerprint: string; role: string; optionKey?: string }> = []
		const adapter = makeAdapter()
		const ctx = makeContext((args) => {
			registered.push(args)
			return `anchor-${registered.length}`
		})

		const match = await adapter.probe(ctx)
		expect(match).toMatchObject({ matched: true, score: 1, navigationProfileId: 'default' })
		const questions = await adapter.extract(ctx)
		expect(questions).toHaveLength(2)
		expect(questions[0].stem.map((part) => part.type)).toEqual(['text', 'image', 'text'])
		expect(questions[0].options.map((option) => option.key)).toEqual(['A', 'B'])
		expect(questions[0].hasRequiredVisuals).toBe(true)
		expect(JSON.stringify(questions[0])).not.toContain('HIDDEN_CORRECT_ANSWER')
		expect(registered).toEqual([
			expect.objectContaining({
				questionFingerprint: questions[0].locator.fingerprint,
				role: 'stem',
			}),
		])
	})

	it('captures, writes and verifies exact state, then restores the old controls', async () => {
		const adapter = makeAdapter()
		const ctx = makeContext()
		const questions = await adapter.extract(ctx)
		const [choice, completion] = questions
		const commands: FillCommand[] = [
			command(choice, {
				questionFingerprint: choice.locator.fingerprint,
				type: 'single',
				selectedOptions: ['B'],
				evidence: evidence(choice.locator.fingerprint),
			}),
			command(completion, {
				questionFingerprint: completion.locator.fingerprint,
				type: 'completion',
				blanks: [{ key: 'blank-1', value: 'new text' }],
				evidence: evidence(completion.locator.fingerprint),
			}),
		]

		const snapshot = await adapter.captureControlState(ctx, commands)
		const transaction = {
			transactionId: snapshot.transactionId,
			snapshotDigestVersion: 1 as const,
			snapshotDigest: snapshot.snapshotDigest,
		}
		const attempts = await adapter.setExactAnswers(ctx, transaction, commands)
		expect(attempts.map((attempt) => attempt.result)).toEqual(['written', 'written'])
		expect(
			(document.querySelector('[data-option-key="A"] input') as HTMLInputElement).checked,
		).toBe(false)
		expect(
			(document.querySelector('[data-option-key="B"] input') as HTMLInputElement).checked,
		).toBe(true)
		expect((document.querySelector('#blank-1') as HTMLInputElement).value).toBe('new text')
		expect((await adapter.verify(ctx, commands)).map((result) => result.dom)).toEqual([
			'matched',
			'matched',
		])

		const restored = await adapter.restoreControlState(ctx, transaction, snapshot)
		expect(restored).toMatchObject({ restored: true, verified: true, pageMayRemainModified: false })
		expect(
			(document.querySelector('[data-option-key="A"] input') as HTMLInputElement).checked,
		).toBe(true)
		expect((document.querySelector('#blank-1') as HTMLInputElement).value).toBe('old text')
	})

	it('keeps identical questions without platform ids independently bound by root order', async () => {
		document.body.innerHTML = [0, 1]
			.map(
				(index) => `
					<div class="question" data-question-type="single">
						<div class="stem">Same prompt</div>
						<label class="option" data-option-key="A"><input type="radio" name="same-${index}" checked /><span class="content">Alpha</span></label>
						<label class="option" data-option-key="B"><input type="radio" name="same-${index}" /><span class="content">Beta</span></label>
					</div>
				`,
			)
			.join('')
		const adapter = makeAdapter()
		const ctx = makeContext()
		const questions = await adapter.extract(ctx)
		expect(new Set(questions.map((question) => question.locator.fingerprint)).size).toBe(2)
		const second = questions[1]
		const commands = [
			command(second, {
				questionFingerprint: second.locator.fingerprint,
				type: 'single',
				selectedOptions: ['B'],
				evidence: evidence(second.locator.fingerprint),
			}),
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
		const roots = document.querySelectorAll<HTMLElement>('.question')
		expect(roots[0].querySelector<HTMLInputElement>('[data-option-key="A"] input')?.checked).toBe(
			true,
		)
		expect(roots[1].querySelector<HTMLInputElement>('[data-option-key="B"] input')?.checked).toBe(
			true,
		)
	})

	it('restores a pending visual-capture scroll before releasing run-owned state', async () => {
		const scrollTo = vi.fn()
		const windowState = {
			scrollX: 10,
			scrollY: 20,
			innerWidth: 800,
			innerHeight: 600,
			scrollTo,
		}
		const adapter = createDomQuestionAdapter(
			{
				manifest: makeManifest(),
				routeMatchers: [(url) => url.pathname.startsWith('/quiz/')],
				questionRootSelectors: ['.question'],
				stemSelectors: ['.stem'],
				optionSelectors: ['.option'],
				optionContentSelectors: ['.content'],
				blankSelectors: ['input[type="text"]'],
			},
			{ getWindow: () => windowState as unknown as Window },
		)
		const ctx = makeContext()
		const [question] = await adapter.extract(ctx)
		const image = document.querySelector<HTMLImageElement>('.stem img')!
		image.getBoundingClientRect = () =>
			({
				x: 1_000,
				y: 1_000,
				left: 1_000,
				top: 1_000,
				right: 1_020,
				bottom: 1_020,
				width: 20,
				height: 20,
			}) as DOMRect
		image.scrollIntoView = () => {
			windowState.scrollX = 100
			windowState.scrollY = 200
		}

		const preparation = await adapter.prepareVisualCapture(ctx, question.locator, 'anchor-1', true)
		const wrongRun = {
			...ctx,
			identity: { ...ctx.identity, runId: 'another-run' },
		}
		await expect(adapter.restoreVisualCapture(wrongRun, preparation.transactionId)).rejects.toThrow(
			'visual_transaction_binding_mismatch',
		)
		expect(scrollTo).not.toHaveBeenCalled()

		await adapter.restoreVisualCapture(ctx, preparation.transactionId)

		expect(scrollTo).toHaveBeenCalledWith(10, 20)
	})

	it('rejects a setter without the admitted control transaction', async () => {
		const adapter = makeAdapter()
		const ctx = makeContext()
		const [question] = await adapter.extract(ctx)
		const commands = [
			command(question, {
				questionFingerprint: question.locator.fingerprint,
				type: 'single',
				selectedOptions: ['B'],
				evidence: evidence(question.locator.fingerprint),
			}),
		]
		await expect(
			adapter.setExactAnswers(
				ctx,
				{
					transactionId: 'missing',
					snapshotDigestVersion: 1,
					snapshotDigest: '0'.repeat(64),
				},
				commands,
			),
		).rejects.toThrow('control_transaction_mismatch')
	})

	it('uses only the manifest next control and reports protected interruptions', async () => {
		const adapter = makeAdapter()
		const ctx = makeContext()
		const click = vi.fn()
		document.querySelector<HTMLButtonElement>('.next')?.addEventListener('click', click)
		expect(await adapter.getNavigation(ctx)).toMatchObject({
			profileId: 'default',
			hasNext: true,
			mode: 'after_fill',
		})
		expect(await adapter.gotoNext(ctx, 'read_only', 'page')).toMatchObject({ initiated: false })
		expect(await adapter.gotoNext(ctx, 'after_fill', 'page')).toMatchObject({ initiated: true })
		expect(click).toHaveBeenCalledTimes(1)

		const captcha = document.createElement('div')
		captcha.className = 'captcha-dialog'
		document.body.append(captcha)
		expect(await adapter.probeInterrupts(ctx)).toMatchObject({ blocked: true, kind: 'captcha' })
	})

	it('ignores a hidden duplicate next control and refuses two visible candidates', async () => {
		const adapter = makeAdapter()
		const ctx = makeContext()
		const hidden = document.createElement('button')
		hidden.className = 'next'
		hidden.textContent = 'Next'
		hidden.hidden = true
		document.body.prepend(hidden)

		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: true })

		const duplicate = document.createElement('button')
		duplicate.className = 'next'
		duplicate.textContent = 'Next'
		document.body.append(duplicate)
		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false })
		expect(await adapter.gotoNext(ctx, 'after_fill', 'page')).toMatchObject({ initiated: false })
	})

	it('rejects a selector match whose live semantics changed to final submission', async () => {
		const adapter = makeAdapter()
		const ctx = makeContext()
		const next = document.querySelector<HTMLButtonElement>('.next')!
		next.textContent = '提交试卷'
		const click = vi.fn()
		next.addEventListener('click', click)

		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false })
		expect(await adapter.gotoNext(ctx, 'after_fill', 'page')).toMatchObject({ initiated: false })
		expect(click).not.toHaveBeenCalled()
	})

	it('rejects an icon-only next selector that points at a final submission action', async () => {
		const adapter = makeAdapter()
		const ctx = makeContext()
		const next = document.querySelector<HTMLButtonElement>('.next')!
		next.textContent = ''
		next.setAttribute('formaction', '/exam/submitPaper')
		const form = document.createElement('form')
		next.replaceWith(form)
		form.append(next)
		const click = vi.fn()
		next.addEventListener('click', click)

		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false })
		expect(await adapter.gotoNext(ctx, 'after_fill', 'page')).toMatchObject({ initiated: false })
		expect(click).not.toHaveBeenCalled()
	})

	it('rejects a next-looking link whose href is a bare final action', async () => {
		const adapter = makeAdapter()
		const ctx = makeContext()
		const next = document.querySelector<HTMLButtonElement>('.next')!
		const link = document.createElement('a')
		link.className = 'next'
		link.textContent = 'Next'
		link.href = '/quiz/finish'
		next.replaceWith(link)
		const click = vi.fn()
		link.addEventListener('click', click)

		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false })
		expect(await adapter.gotoNext(ctx, 'after_fill', 'page')).toMatchObject({ initiated: false })
		expect(click).not.toHaveBeenCalled()
	})

	it('rejects a next-looking submit control associated with an external form', async () => {
		const adapter = makeAdapter()
		const ctx = makeContext()
		const next = document.querySelector<HTMLButtonElement>('.next')!
		const form = document.createElement('form')
		form.id = 'final-form'
		form.action = '/quiz/final'
		document.body.append(form)
		next.setAttribute('form', form.id)
		next.type = 'submit'
		const click = vi.fn()
		next.addEventListener('click', click)

		expect(await adapter.getNavigation(ctx)).toMatchObject({ hasNext: false })
		expect(await adapter.gotoNext(ctx, 'after_fill', 'page')).toMatchObject({ initiated: false })
		expect(click).not.toHaveBeenCalled()
	})

	it('excludes common visually-hidden answer text from the normal and fallback extractors', async () => {
		document.head.innerHTML = `<style>
			.display-secret { display: none }
			.offscreen-secret { position: absolute; left: -9999px }
			.clipped-secret { position: absolute; clip: rect(0, 0, 0, 0) }
			.zero-secret { width: 0; height: 0; overflow: hidden }
			.scaled-secret { transform: scale(0) }
			.content-secret { content-visibility: hidden }
			.transparent-secret { color: transparent }
			.font-zero-secret { font-size: 0 }
			.filter-secret { filter: opacity(0) }
		</style>`
		document.body.innerHTML = `
			<div class="question" data-question-id="q-hidden" data-question-type="single">
				<div>Visible fallback prompt
					<span class="display-secret">HIDDEN_DISPLAY_ANSWER</span>
					<span class="offscreen-secret">HIDDEN_OFFSCREEN_ANSWER</span>
					<span class="clipped-secret">HIDDEN_CLIPPED_ANSWER</span>
					<span class="zero-secret">HIDDEN_ZERO_ANSWER</span>
					<span class="scaled-secret">HIDDEN_SCALED_ANSWER</span>
					<span class="content-secret">HIDDEN_CONTENT_ANSWER</span>
					<span class="transparent-secret">HIDDEN_TRANSPARENT_ANSWER</span>
					<span class="font-zero-secret">HIDDEN_FONT_ZERO_ANSWER</span>
					<span class="filter-secret">HIDDEN_FILTER_ANSWER</span>
					<svg><text style="display: none">HIDDEN_SVG_ANSWER</text></svg>
				</div>
				<label class="option" data-option-key="A"><input type="radio" name="hidden" /><span class="content">Alpha</span></label>
				<label class="option" data-option-key="B"><input type="radio" name="hidden" /><span class="content">Beta</span></label>
			</div>
		`
		const [question] = await makeAdapter().extract(makeContext())
		const serialized = JSON.stringify(question)

		expect(serialized).toContain('Visible fallback prompt')
		expect(serialized).not.toContain('HIDDEN_')
	})
})

function makeAdapter() {
	return createDomQuestionAdapter({
		manifest: makeManifest(),
		routeMatchers: [(url) => url.pathname.startsWith('/quiz/')],
		questionRootSelectors: ['.question'],
		stemSelectors: ['.stem'],
		optionSelectors: ['.option'],
		optionContentSelectors: ['.content'],
		blankSelectors: ['input[type="text"]'],
	})
}

function makeManifest(): AdapterManifest {
	return {
		ref: { platform: 'generic', variant: 'generic.standard_html', version: 1 },
		maturity: 'fixture_verified',
		sourceAttribution: [{ license: 'MIT', path: 'ocsjs/shared', symbols: ['worker'] }],
		probe: {
			hosts: ['localhost'],
			routePatternIds: ['generic.quiz'],
			requiredDomSignatures: ['generic.question'],
			minimumScore: 0.85,
		},
		typeSupport: { single: 'inspect_answer_fill', completion: 'inspect_answer_fill' },
		maxModelConcurrency: 4,
		questionDelayMs: 0,
		readiness: { timeoutMs: 100, pollMs: 1, quietWindowMs: 0, requireNetworkQuiet: false },
		navigationProfiles: [
			{
				id: 'default',
				readOnly: 'none',
				afterFill: 'next',
				advanceEffect: 'none',
				nextSelectorId: 'selector:.next',
				allowedNextVariants: [],
			},
		],
		fill: {
			exactState: true,
			snapshot: 'required',
			saveEffect: 'none',
			visualControlVerification: false,
		},
		embedded: { domProjectionIds: [], runtimeOperationIds: [] },
	}
}

function makeContext(
	registerImage: (args: {
		questionFingerprint: string
		role: 'stem' | 'material' | 'option'
		optionKey?: string
		element: Element
	}) => string = () => 'anchor-1',
): AdapterContext {
	return {
		identity: { taskId: 'task', taskEpoch: 1, runId: 'run' },
		frame: {
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'document',
			documentToken: 'token',
			urlFingerprint: 'url',
		},
		action: 'fill',
		scope: 'current_page',
		navigationProfileId: 'default',
		signal: new AbortController().signal,
		mainWorld: { execute: vi.fn() } as unknown as FixedMainWorldRuntime,
		anchors: { registerImage },
	}
}

function command(
	question: { locator: FillCommand['locator'] },
	answer: StructuredAnswer,
): FillCommand {
	return {
		locator: question.locator,
		expectedLogicalPageFingerprint: 'logical',
		expectedBindingFingerprint: 'binding',
		answer,
	}
}

function evidence(questionFingerprint: string): StructuredAnswer['evidence'] {
	return {
		source: 'llm_text',
		questionFingerprint,
		mappingConfidence: 1,
		modelConfidence: 0.95,
		warnings: [],
	}
}

function fixtureHtml(): string {
	return `
		<style>.secret-answer { display: none }</style>
		<div class="question" data-question-id="q1" data-question-type="single">
			<div class="stem">Before <img alt="diagram" /> After <span class="secret-answer">HIDDEN_CORRECT_ANSWER</span></div>
			<label class="option" data-option-key="A"><input type="radio" name="q1" checked /><span class="content">Alpha</span></label>
			<label class="option" data-option-key="B"><input type="radio" name="q1" /><span class="content">Beta</span></label>
		</div>
		<div class="question" data-question-id="q2" data-question-type="completion">
			<div class="stem">Complete this</div>
			<input id="blank-1" data-blank-key="blank-1" type="text" value="old text" />
		</div>
		<button class="next">Next</button>
	`
}
