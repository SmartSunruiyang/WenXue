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
	tabId: 1,
	frameId: 0,
	parentFrameId: -1,
	documentId: 'image-only-document',
	documentToken: 'image-only-document-token',
	urlFingerprint: 'a'.repeat(64),
}
const CHAOXING_REF: AdapterRef = {
	platform: 'chaoxing',
	variant: 'chaoxing.modern_work_exam',
	version: 1,
}
const PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg=='

describe('question solver image-only synthetic E2E', () => {
	it('inspects the production Chaoxing fixture without resolving images, calling a model, or writing', async () => {
		const scenario = createScenario('inspect')
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
				options: [
					{ key: 'A', content: [{ kind: 'image', resolution: 'failed' }] },
					{ key: 'B', content: [{ kind: 'image', resolution: 'failed' }] },
					{ key: 'C', content: [{ kind: 'image', resolution: 'failed' }] },
					{ key: 'D', content: [{ kind: 'image', resolution: 'failed' }] },
				],
			},
		})
		expect(result.questions[0].answer).toBeUndefined()
		expect(extracted.options.map((option) => option.key)).toEqual(['A', 'B', 'C', 'D'])
		expect(extracted.options.map((option) => option.content.map((part) => part.type))).toEqual([
			['image'],
			['image'],
			['image'],
			['image'],
		])
		expect(extracted.visualAnchorKeys).toHaveLength(4)
		expect(new Set(extracted.visualAnchorKeys).size).toBe(4)
		expect(scenario.ask).not.toHaveBeenCalled()
		expect(scenario.fetchImage).not.toHaveBeenCalled()
		expect(scenario.run.screenshotCount).toBe(0)
		expect(scenario.run.operations).not.toContain('embedded_read')
		expect(scenario.run.operations).not.toContain('image_resolve')
		expect(scenario.run.operations).not.toContain('state_capture')
		expect(scenario.run.operations).not.toContain('fill')
		expect(scenario.run.operations).not.toContain('verify')
		expect(document.body.innerHTML).toBe(before)
		expect(scenario.submitClick).not.toHaveBeenCalled()
	})

	it('falls back from failed inline fetches to screenshots and answers B without changing the DOM', async () => {
		const scenario = createScenario('answer')
		const before = document.body.innerHTML
		const original = selectedOption()
		const images = Array.from(document.querySelectorAll('img'))

		expect(images).toHaveLength(4)
		expect(
			images.every((image) => !image.hasAttribute('alt') && !image.hasAttribute('title')),
		).toBe(true)

		const result = await scenario.solver.execute({ action: 'answer', scope: 'current_page' })

		expect(scenario.fetchImage).toHaveBeenCalledTimes(4)
		expect(scenario.run.screenshotCount).toBe(4)
		expect(scenario.ask).toHaveBeenCalledOnce()
		expect(imageBlocks(scenario.ask)).toHaveLength(4)
		expect(optionImageSequence(scenario.ask)).toEqual([
			'[root/option:A]',
			'<image>',
			'[root/option:B]',
			'<image>',
			'[root/option:C]',
			'<image>',
			'[root/option:D]',
			'<image>',
		])
		expect(result.questions[0]).toMatchObject({
			status: 'answered_notFilled',
			pageEffect: 'none',
			evidence: { source: 'llm_vision' },
			answer: {
				parts: [{ kind: 'choice', questionPath: 'root', selectedOptionKeys: ['B'] }],
			},
		})
		expect(selectedOption()).toBe(original)
		expect(selectedOption()).toBe('A')
		expect(scenario.run.operations).not.toContain('state_capture')
		expect(scenario.run.operations).not.toContain('fill')
		expect(document.body.innerHTML).toBe(before)
		expect(scenario.submitClick).not.toHaveBeenCalled()
		expect(JSON.stringify(result)).not.toMatch(/data:image|base64|iVBORw0KGgo/)
	})

	it('replaces the old A state with B, verifies it, and never touches final submit', async () => {
		const scenario = createScenario('fill')

		const result = await scenario.solver.execute({ action: 'fill', scope: 'current_page' })

		expect(result.questions[0]).toMatchObject({
			status: 'filled_verified',
			pageEffect: 'written_and_verified',
			evidence: { source: 'llm_vision' },
		})
		expect(selectedOption()).toBe('B')
		expect(scenario.run.operations.indexOf('state_capture')).toBeLessThan(
			scenario.run.operations.indexOf('fill'),
		)
		expect(scenario.run.operations.indexOf('fill')).toBeLessThan(
			scenario.run.operations.indexOf('verify'),
		)
		expect(scenario.fetchImage).toHaveBeenCalledTimes(4)
		expect(scenario.run.screenshotCount).toBe(4)
		expect(scenario.submitClick).not.toHaveBeenCalled()
		expect(JSON.stringify(result)).not.toMatch(/data:image|base64|iVBORw0KGgo/)
	})
})

function createScenario(action: QuestionSolverAction) {
	document.body.innerHTML = imageOnlyFixture()
	Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
	const submitClick = vi.fn()
	document
		.querySelector<HTMLButtonElement>('[data-final-submit]')
		?.addEventListener('click', submitClick)
	const fetchImage = vi.fn(async () => new Response(null, { status: 403 }))
	const host = new QuestionSolverAdapterHost({
		environment: {
			getUrl: () => 'https://mooc1.chaoxing.com/mooc2/work/dowork?id=image-only',
		},
		fetchImpl: fetchImage,
	})
	const identity: RunIdentity = {
		taskId: 'image-only-task',
		taskEpoch: 1,
		runId: `image-only-${action}`,
	}
	host.activate(FRAME, identity)
	const run = new HostBackedRun(host, identity, action, 'current_page')
	const ask = vi.fn<AnswerModelInvoker>(async (model) => {
		expect(model.model).toBe('synthetic-vision')
		const question = run.lastQuestions[0]
		return {
			answer: {
				questionFingerprint: question.locator.fingerprint,
				type: 'single',
				selectedOptions: ['B'],
			},
			confidence: 0.98,
		}
	})
	const solver = new QuestionSolverOrchestrator({
		getLease: lease,
		getModels: () => ({
			vision: { baseURL: 'https://vision.fixture/v1', model: 'synthetic-vision' },
		}),
		beginRun: async () => run,
		answerModelOptions: { ask },
	})
	return { solver, run, ask, fetchImage, submitClick }
}

class HostBackedRun implements QuestionSolverRunClient {
	readonly targetTabId = FRAME.tabId
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
		readonly scope: QuestionSolverScope,
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
			this.lastQuestions.splice(
				0,
				this.lastQuestions.length,
				...(response.data as unknown as Question[]),
			)
		}
		if (operation !== 'image_resolve') return response.data as T
		const data = response.data as Record<string, unknown>
		if (data.kind !== 'capture_required') return response.data as T
		this.screenshotCount++
		const preparation = data.preparation as { transactionId: string }
		await this.restoreVisual(options.adapter ?? CHAOXING_REF, preparation.transactionId)
		const payload = (options.payload ?? {}) as Record<string, unknown>
		const locator = payload.locator as { fingerprint: string }
		const envelope = await this.screenshotEnvelope(locator.fingerprint, String(payload.anchorKey))
		return {
			kind: 'resolved',
			resolution: 'screenshot',
			envelope,
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
		const requestId = `image-only-request-${++this.requestSeq}`
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
			assetId: `fixture-image-${++this.imageIndex}`,
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

function imageBlocks(ask: ReturnType<typeof vi.fn<AnswerModelInvoker>>): AnswerModelContentBlock[] {
	return modelBlocks(ask).filter((block) => block.type === 'image_url')
}

function optionImageSequence(ask: ReturnType<typeof vi.fn<AnswerModelInvoker>>): string[] {
	return modelBlocks(ask).flatMap((block) => {
		if (block.type === 'image_url') return ['<image>']
		if (/^\[root\/option:[A-D]\]$/.test(block.text)) return [block.text]
		return []
	})
}

function modelBlocks(ask: ReturnType<typeof vi.fn<AnswerModelInvoker>>): AnswerModelContentBlock[] {
	const messages = ask.mock.calls[0][1]
	const content = messages[1].content
	if (!Array.isArray(content)) throw new Error('Expected a multimodal model request.')
	return content
}

function selectedOption(): string | undefined {
	return Array.from(
		document.querySelectorAll<HTMLInputElement>('input[name="image-question"]'),
	).find((input) => input.checked)?.value
}

function lease(): QuestionSolverTaskLease {
	return {
		taskId: 'image-only-task',
		taskEpoch: 1,
		leaseToken: 'lease-token-that-is-long-enough-for-tests',
		managedTabIds: [FRAME.tabId],
		targetTabId: FRAME.tabId,
	}
}

function imageOnlyFixture(): string {
	return `
		<div class="questionLi" data-question-id="image-only-q1">
			<input id="answertype-image-only-q1" value="0">
			<h3>Choose the matching shape.</h3>
			<div class="answerBg">
				<label class="answer_p" data-option-key="A"><input type="radio" name="image-question" value="A" checked><img src="/assets/a.png"></label>
				<label class="answer_p" data-option-key="B"><input type="radio" name="image-question" value="B"><img src="/assets/b.png"></label>
				<label class="answer_p" data-option-key="C"><input type="radio" name="image-question" value="C"><img src="/assets/c.png"></label>
				<label class="answer_p" data-option-key="D"><input type="radio" name="image-question" value="D"><img src="/assets/d.png"></label>
			</div>
		</div>
		<button data-final-submit>Submit assessment</button>
	`
}
