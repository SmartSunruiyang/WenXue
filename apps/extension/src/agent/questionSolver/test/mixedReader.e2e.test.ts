// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { QuestionSolverAdapterHost } from '../adapterHost.content'
import type { AnswerModelContentBlock, AnswerModelInvoker } from '../answerModel'
import type { QuestionSolverTaskLease, SolverRequestOptions } from '../bridge'
import type {
	AdapterRef,
	FrameRef,
	InternalImageEnvelope,
	JsonValue,
	Question,
	QuestionSolverAction,
	QuestionSolverScope,
	RunIdentity,
} from '../contracts'
import { sha256Hex } from '../fingerprints'
import { QuestionSolverOrchestrator, type QuestionSolverRunClient } from '../orchestrator'
import {
	QUESTION_SOLVER_PROTOCOL_VERSION,
	type SolverOperation,
	type SolverRequest,
} from '../protocol'

const FRAME: FrameRef = {
	tabId: 2,
	frameId: 0,
	parentFrameId: -1,
	documentId: 'mixed-reader-document',
	documentToken: 'mixed-reader-document-token',
	urlFingerprint: 'b'.repeat(64),
}
const CHAOXING_REF: AdapterRef = {
	platform: 'chaoxing',
	variant: 'chaoxing.modern_work_exam',
	version: 1,
}
const PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg=='

describe('question solver mixed-reader synthetic E2E', () => {
	it('inspects material and both subquestions without resolving visuals, calling a model, or writing', async () => {
		const scenario = createScenario(true, 'inspect')
		const before = document.body.innerHTML

		const result = await scenario.solver.execute({ action: 'inspect', scope: 'current_page' })
		const extracted = scenario.run.lastQuestions[0]

		expect(result).toMatchObject({
			status: 'completed',
			counts: { inspected: 1, answered: 0, filledVerified: 0 },
			finalSubmissionPerformed: false,
		})
		expect(result.questions[0]).toMatchObject({
			status: 'inspected',
			pageEffect: 'none',
			question: {
				material: [
					{ kind: 'text', text: 'MATERIAL BEFORE' },
					{ kind: 'image', resolution: 'failed' },
					{ kind: 'text', text: 'MATERIAL AFTER' },
				],
				stem: [{ kind: 'text', text: 'ROOT STEM' }],
				subQuestionPaths: ['sub/0', 'sub/1'],
			},
		})
		expect(result.questions[0].answer).toBeUndefined()
		expect(partSequence(extracted.material)).toEqual([
			'text:MATERIAL BEFORE',
			'image',
			'text:MATERIAL AFTER',
		])
		expect(partSequence(extracted.stem)).toEqual(['text:ROOT STEM'])
		expect(
			extracted.subQuestions?.map((subQuestion) => ({
				type: subQuestion.type,
				stem: partSequence(subQuestion.stem),
				options: subQuestion.options.map((option) => ({
					key: option.key,
					content: partSequence(option.content),
				})),
			})),
		).toEqual([
			{
				type: 'single',
				stem: ['text:SUBQUESTION ONE'],
				options: [
					{ key: 'A', content: ['text:OLD ONE'] },
					{ key: 'B', content: ['text:NEW ONE'] },
				],
			},
			{
				type: 'single',
				stem: ['text:SUBQUESTION TWO'],
				options: [
					{ key: 'A', content: ['text:OLD TWO'] },
					{ key: 'B', content: ['text:NEW TWO'] },
				],
			},
		])
		expect(scenario.ask).not.toHaveBeenCalled()
		expect(scenario.fetchImage).not.toHaveBeenCalled()
		expect(scenario.run.screenshotCount).toBe(0)
		expect(scenario.run.operations).not.toContain('embedded_read')
		expect(scenario.run.operations).not.toContain('image_resolve')
		expect(scenario.run.operations).not.toContain('state_capture')
		expect(scenario.run.operations).not.toContain('fill')
		expect(scenario.run.operations).not.toContain('verify')
		expect(selectedReaderOptions()).toEqual(['A', 'A'])
		expect(document.body.innerHTML).toBe(before)
		expect(scenario.submitClick).not.toHaveBeenCalled()
	})

	it('answers the complete reader tree in one vision call while leaving the page unchanged', async () => {
		const scenario = createScenario(true, 'answer')
		const before = document.body.innerHTML

		const result = await scenario.solver.execute({ action: 'answer', scope: 'current_page' })
		const blocks = modelBlocks(scenario.ask)
		const text = blocks
			.filter(
				(block): block is Extract<AnswerModelContentBlock, { type: 'text' }> =>
					block.type === 'text',
			)
			.map((block) => block.text)
			.join('\n')

		expect(scenario.ask).toHaveBeenCalledOnce()
		expect(scenario.fetchImage).toHaveBeenCalledOnce()
		expect(scenario.run.screenshotCount).toBe(1)
		expect(blocks.filter((block) => block.type === 'image_url')).toHaveLength(1)
		expect(text.indexOf('MATERIAL BEFORE')).toBeLessThan(text.indexOf('ROOT STEM'))
		expect(text.indexOf('ROOT STEM')).toBeLessThan(text.indexOf('SUBQUESTION ONE'))
		expect(text.indexOf('SUBQUESTION ONE')).toBeLessThan(text.indexOf('SUBQUESTION TWO'))
		expect(result.questions[0]).toMatchObject({
			status: 'answered_notFilled',
			pageEffect: 'none',
			question: { subQuestionPaths: ['sub/0', 'sub/1'] },
			answer: {
				parts: [
					{ kind: 'choice', questionPath: 'sub/0', selectedOptionKeys: ['B'] },
					{ kind: 'choice', questionPath: 'sub/1', selectedOptionKeys: ['B'] },
				],
			},
		})
		expect(scenario.run.operations).not.toContain('state_capture')
		expect(scenario.run.operations).not.toContain('fill')
		expect(scenario.run.operations).not.toContain('verify')
		expect(selectedReaderOptions()).toEqual(['A', 'A'])
		expect(document.body.innerHTML).toBe(before)
		expect(scenario.submitClick).not.toHaveBeenCalled()
		expect(JSON.stringify(result)).not.toMatch(/data:image|base64|iVBORw0KGgo/)
	})

	it('keeps material/stem/option/subquestion order in one vision call and replaces old answers', async () => {
		const scenario = createScenario(true)
		const result = await scenario.solver.execute({ action: 'fill', scope: 'current_page' })

		expect(scenario.ask).toHaveBeenCalledOnce()
		expect(scenario.run.screenshotCount).toBe(1)
		expect(scenario.fetchImage).toHaveBeenCalledOnce()
		const blocks = modelBlocks(scenario.ask)
		expect(blocks.filter((block) => block.type === 'image_url')).toHaveLength(1)
		const text = blocks
			.filter(
				(block): block is Extract<AnswerModelContentBlock, { type: 'text' }> =>
					block.type === 'text',
			)
			.map((block) => block.text)
			.join('\n')
		expect(text.indexOf('MATERIAL BEFORE')).toBeLessThan(text.indexOf('ROOT STEM'))
		expect(text).not.toContain('ROOT OPTION CONTEXT')
		expect(text.indexOf('ROOT STEM')).toBeLessThan(text.indexOf('SUBQUESTION ONE'))
		expect(text.indexOf('SUBQUESTION ONE')).toBeLessThan(text.indexOf('SUBQUESTION TWO'))
		expect(text.indexOf('OLD ONE')).toBeLessThan(text.indexOf('NEW ONE'))
		expect(text.indexOf('OLD TWO')).toBeLessThan(text.indexOf('NEW TWO'))

		expect(result.questions[0]).toMatchObject({
			status: 'filled_verified',
			pageEffect: 'written_and_verified',
			question: { subQuestionPaths: ['sub/0', 'sub/1'] },
			answer: {
				parts: [
					{ kind: 'choice', questionPath: 'sub/0', selectedOptionKeys: ['B'] },
					{ kind: 'choice', questionPath: 'sub/1', selectedOptionKeys: ['B'] },
				],
			},
		})
		expect(selectedReaderOptions()).toEqual(['B', 'B'])
		expect(scenario.run.operations.indexOf('state_capture')).toBeLessThan(
			scenario.run.operations.indexOf('fill'),
		)
		expect(scenario.run.operations.indexOf('fill')).toBeLessThan(
			scenario.run.operations.indexOf('verify'),
		)
		expect(scenario.submitClick).not.toHaveBeenCalled()
		expect(JSON.stringify(result)).not.toMatch(/data:image|base64|iVBORw0KGgo/)
	})

	it('performs no model call or page write when the required image cannot be captured', async () => {
		const scenario = createScenario(false)
		const before = selectedReaderOptions()

		const result = await scenario.solver.execute({ action: 'fill', scope: 'current_page' })

		expect(result.questions[0]).toMatchObject({
			status: 'needsReview_notFilled',
			pageEffect: 'none',
			problem: { code: 'required_visual_unavailable', stage: 'image' },
		})
		expect(scenario.ask).not.toHaveBeenCalled()
		expect(scenario.run.operations).not.toContain('state_capture')
		expect(scenario.run.operations).not.toContain('fill')
		expect(selectedReaderOptions()).toEqual(before)
		expect(selectedReaderOptions()).toEqual(['A', 'A'])
		expect(scenario.submitClick).not.toHaveBeenCalled()
		expect(JSON.stringify(result)).not.toMatch(/data:image|base64|iVBORw0KGgo/)
	})
})

function createScenario(imageAvailable: boolean, action: QuestionSolverAction = 'fill') {
	document.body.innerHTML = mixedReaderFixture()
	Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
	installReaderSelectionBehavior()
	const submitClick = vi.fn()
	document
		.querySelector<HTMLButtonElement>('[data-final-submit]')
		?.addEventListener('click', submitClick)
	const fetchImage = vi.fn(async () => new Response(null, { status: 403 }))
	const host = new QuestionSolverAdapterHost({
		environment: {
			getUrl: () => 'https://mooc1.chaoxing.com/mooc2/work/dowork?id=mixed-reader',
		},
		fetchImpl: fetchImage,
	})
	const identity: RunIdentity = {
		taskId: 'mixed-reader-task',
		taskEpoch: 1,
		runId: imageAvailable ? `mixed-reader-${action}` : `mixed-reader-${action}-missing-image`,
	}
	host.activate(FRAME, identity)
	const run = new MixedReaderRun(host, identity, action, imageAvailable)
	const ask = vi.fn<AnswerModelInvoker>(async (model) => {
		expect(model.model).toBe('synthetic-reader-vision')
		const question = run.lastQuestions[0]
		return {
			answer: {
				questionFingerprint: question.locator.fingerprint,
				type: 'reader',
				subAnswers: question.subQuestions!.map((subQuestion) => ({
					questionFingerprint: subQuestion.locator.fingerprint,
					type: 'single' as const,
					selectedOptions: ['B'],
				})),
			},
			confidence: 0.97,
		}
	})
	const solver = new QuestionSolverOrchestrator({
		getLease: lease,
		getModels: () => ({
			vision: { baseURL: 'https://vision.fixture/v1', model: 'synthetic-reader-vision' },
		}),
		beginRun: async () => run,
		answerModelOptions: { ask },
	})
	return { solver, run, ask, fetchImage, submitClick }
}

class MixedReaderRun implements QuestionSolverRunClient {
	readonly targetTabId = FRAME.tabId
	readonly scope: QuestionSolverScope = 'current_page'
	readonly operations: SolverOperation[] = []
	readonly lastQuestions: Question[] = []
	screenshotCount = 0
	private requestSeq = 0
	private imageIndex = 0
	private readonly laneGenerations = new Map<string, number>()

	constructor(
		private readonly host: QuestionSolverAdapterHost,
		readonly identity: RunIdentity,
		readonly action: QuestionSolverAction,
		private readonly imageAvailable: boolean,
	) {}

	async discoverFrames() {
		return { frames: [FRAME], incompleteFrameIds: [] }
	}

	async request<T extends JsonValue = JsonValue>(
		_target: FrameRef,
		operation: SolverOperation,
		options: SolverRequestOptions = {},
	): Promise<T> {
		this.operations.push(operation)
		const response = await this.host.handleRequest(this.createRequest(operation, options))
		if (!response.ok) throw new Error(response.error.code)
		if (operation === 'extract') {
			const questions = response.data as unknown as Question[]
			this.lastQuestions.splice(0, this.lastQuestions.length, ...questions)
			return questions as unknown as T
		}
		if (operation !== 'image_resolve') return response.data as T
		const data = response.data as Record<string, unknown>
		if (data.kind !== 'capture_required') return response.data as T
		this.screenshotCount++
		const preparation = data.preparation as { transactionId: string }
		await this.restoreVisual(options.adapter ?? CHAOXING_REF, preparation.transactionId)
		if (!this.imageAvailable) {
			return {
				kind: 'failed',
				warningCodes: ['synthetic_capture_failed'],
			} as unknown as T
		}
		const payload = (options.payload ?? {}) as Record<string, unknown>
		const locator = payload.locator as { fingerprint: string }
		return {
			kind: 'resolved',
			resolution: 'screenshot',
			envelope: await this.screenshotEnvelope(locator.fingerprint, String(payload.anchorKey)),
		} as unknown as T
	}

	async cancel() {}
	async enterCleanup() {}

	async finish(): Promise<'closed'> {
		this.host.releaseRun({
			type: 'QUESTION_SOLVER_RELEASE',
			protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
			identity: this.identity,
			target: FRAME,
			preserveRecovery: false,
		})
		return 'closed'
	}

	private createRequest(operation: SolverOperation, options: SolverRequestOptions): SolverRequest {
		const requestId = `mixed-reader-request-${++this.requestSeq}`
		let generation: number | undefined
		if (options.laneKey) {
			generation = (this.laneGenerations.get(options.laneKey) ?? 0) + 1
			this.laneGenerations.set(options.laneKey, generation)
		}
		return {
			type: 'QUESTION_SOLVER_CONTROL',
			protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
			kind: 'request',
			identity: this.identity,
			requestId,
			requestSeq: this.requestSeq,
			leaseToken: 'l'.repeat(32),
			target: FRAME,
			operation,
			adapter: options.adapter,
			phase: options.phase,
			laneKey: options.laneKey,
			generation,
			payload: {
				solverAction: this.action,
				solverScope: this.scope,
				...((options.payload ?? {}) as Record<string, JsonValue>),
			},
		}
	}

	private async restoreVisual(adapter: AdapterRef, transactionId: string): Promise<void> {
		const response = await this.host.handleRequest(
			this.createRequest('visual_restore', {
				adapter,
				phase: 'cleanup',
				payload: { transactionId },
			}),
		)
		if (!response.ok) throw new Error(response.error.code)
	}

	private async screenshotEnvelope(
		questionFingerprint: string,
		anchorKey: string,
	): Promise<InternalImageEnvelope> {
		const bytes = Uint8Array.from(atob(PNG), (character) => character.charCodeAt(0))
		return {
			kind: 'question_solver_image_asset',
			assetId: `reader-image-${++this.imageIndex}`,
			runId: this.identity.runId,
			questionFingerprint,
			anchorKey,
			mimeType: 'image/png',
			base64: PNG,
			sha256: await sha256Hex(bytes),
			width: 1,
			height: 1,
			byteLength: bytes.byteLength,
		}
	}
}

function modelBlocks(ask: ReturnType<typeof vi.fn<AnswerModelInvoker>>): AnswerModelContentBlock[] {
	const messages = ask.mock.calls[0][1]
	const content = messages[1].content
	if (!Array.isArray(content)) throw new Error('Expected a multimodal reader request.')
	return content
}

function partSequence(parts: Question['material']): string[] {
	return (parts ?? []).map((part) => (part.type === 'text' ? `text:${part.text}` : 'image'))
}

function installReaderSelectionBehavior(): void {
	for (const container of document.querySelectorAll<HTMLElement>('.reading_answer')) {
		const options = Array.from(container.querySelectorAll<HTMLElement>('[data]'))
		for (const option of options) {
			option.addEventListener('click', () => {
				for (const peer of options) peer.classList.remove('selected')
				option.classList.add('selected')
			})
		}
	}
}

function selectedReaderOptions(): string[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.reading_answer')).map(
		(container) =>
			container.querySelector<HTMLElement>('[data].selected')?.getAttribute('data') ?? '',
	)
}

function lease(): QuestionSolverTaskLease {
	return {
		taskId: 'mixed-reader-task',
		taskEpoch: 1,
		leaseToken: 'lease-token-that-is-long-enough-for-tests',
		managedTabIds: [FRAME.tabId],
		targetTabId: FRAME.tabId,
	}
}

function mixedReaderFixture(): string {
	return `
		<div class="questionLi" data-question-id="reader-root">
			<input id="answertype-reader-root" value="15">
			<div class="reader-material">MATERIAL BEFORE <img src="/assets/reader.png"> MATERIAL AFTER</div>
			<h3>ROOT STEM</h3>
			<div class="reading_answer" data-subquestion="1">
				<p>SUBQUESTION ONE</p>
				<span class="saveSingleSelect selected" data="A">OLD ONE</span>
				<span class="saveSingleSelect" data="B">NEW ONE</span>
			</div>
			<div class="reading_answer" data-subquestion="2">
				<p>SUBQUESTION TWO</p>
				<span class="saveSingleSelect selected" data="A">OLD TWO</span>
				<span class="saveSingleSelect" data="B">NEW TWO</span>
			</div>
		</div>
		<button data-final-submit>Submit assessment</button>
	`
}
