import { describe, expect, it, vi } from 'vitest'

import type { AnswerModelResolution } from './answerModel'
import type { QuestionSolverTaskLease, SolverRequestOptions } from './bridge'
import type {
	FrameRef,
	JsonValue,
	Question,
	QuestionSolverAction,
	QuestionSolverScope,
	StructuredAnswer,
} from './contracts'
import { sha256Hex } from './fingerprints'
import { QuestionSolverOrchestrator, type QuestionSolverRunClient } from './orchestrator'
import type { SolverOperation } from './protocol'
import { ResultCapacityLedger, ResultStore, ResumeCursorStore } from './resultStore'

const REF = { platform: 'chaoxing', variant: 'chaoxing.modern_work_exam', version: 1 }
const FRAME: FrameRef = {
	tabId: 1,
	frameId: 0,
	parentFrameId: -1,
	documentId: 'document-1',
	documentToken: 'document-token-1',
	urlFingerprint: 'a'.repeat(64),
}
const PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg=='

describe('QuestionSolverOrchestrator', () => {
	it('keeps inspect read-only and returns no answer fields', async () => {
		const run = new FakeRun('inspect', 'current_page', [question(false)])
		const answerQuestion = vi.fn()
		const result = await orchestrator(run, answerQuestion).execute({
			action: 'inspect',
			scope: 'current_page',
		})

		expect(result).toMatchObject({
			status: 'completed',
			executionStatus: 'completed',
			platform: 'chaoxing',
			counts: { inspected: 1, answered: 0, filledVerified: 0 },
			finalSubmissionPerformed: false,
		})
		expect(result.questions[0]).toMatchObject({ status: 'inspected', pageEffect: 'none' })
		expect(result.questions[0].answer).toBeUndefined()
		expect(answerQuestion).not.toHaveBeenCalled()
		expect(run.operations).not.toContain('state_capture')
	})

	it('binds mixed text/image question assets to the vision answer without exposing bytes', async () => {
		const run = new FakeRun('answer', 'current_page', [question(true)])
		const answerQuestion = vi.fn(async (resolved: Question): Promise<AnswerModelResolution> => {
			expect(resolved.stem.some((part) => part.type === 'image' && part.asset)).toBe(true)
			expect(resolved.options[1].content.some((part) => part.type === 'image' && part.asset)).toBe(
				true,
			)
			return {
				status: 'accepted',
				route: 'vision',
				answer: answer(resolved, 'llm_vision'),
				rechecked: false,
			}
		})
		const result = await orchestrator(run, answerQuestion).execute({
			action: 'answer',
			scope: 'current_page',
		})

		expect(result.questions[0]).toMatchObject({
			status: 'answered_notFilled',
			pageEffect: 'none',
			evidence: { source: 'llm_vision' },
		})
		expect(result.questions[0].question.stem).toContainEqual(
			expect.objectContaining({ kind: 'image', resolution: 'screenshot' }),
		)
		expect(JSON.stringify(result)).not.toContain(PNG)
		expect(run.operations).not.toContain('fill')
	})

	it('fills only after snapshot and reports verified exact state', async () => {
		const source = question(false)
		const run = new FakeRun('fill', 'current_page', [source])
		const result = await orchestrator(
			run,
			vi.fn(
				async (resolved: Question): Promise<AnswerModelResolution> => ({
					status: 'accepted',
					route: 'text',
					answer: answer(resolved, 'llm_text'),
					rechecked: false,
				}),
			),
		).execute({ action: 'fill', scope: 'current_page' })

		expect(result.questions[0]).toMatchObject({
			status: 'filled_verified',
			pageEffect: 'written_and_verified',
		})
		expect(run.operations.indexOf('state_capture')).toBeLessThan(run.operations.indexOf('fill'))
		expect(run.operations.indexOf('fill')).toBeLessThan(run.operations.indexOf('verify'))
		expect(run.operations).not.toContain('state_restore')
	})

	it('rescans protected interruptions immediately before automatic next-page navigation', async () => {
		const run = new FakeRun('answer', 'all_pages', [question(false)])
		run.hasNext = true
		run.blockOnInterruptCall = 2
		const result = await orchestrator(
			run,
			vi.fn(
				async (resolved: Question): Promise<AnswerModelResolution> => ({
					status: 'accepted',
					route: 'text',
					answer: answer(resolved, 'llm_text'),
					rechecked: false,
				}),
			),
		).execute({ action: 'answer', scope: 'all_pages' })

		expect(result.blocker).toMatchObject({ code: 'protected_captcha', requiresTakeover: true })
		expect(run.interruptCalls).toBe(2)
		expect(run.operations).not.toContain('next')
	})

	it('restores the complete snapshot when verification remains mismatched', async () => {
		const source = question(false)
		const run = new FakeRun('fill', 'current_page', [source])
		run.verifyMatched = false
		const result = await orchestrator(
			run,
			vi.fn(
				async (resolved: Question): Promise<AnswerModelResolution> => ({
					status: 'accepted',
					route: 'text',
					answer: answer(resolved, 'llm_text'),
					rechecked: false,
				}),
			),
		).execute({ action: 'fill', scope: 'current_page' })

		expect(result.questions[0]).toMatchObject({ status: 'fill_failed', pageEffect: 'restored' })
		expect(run.operations.filter((operation) => operation === 'fill')).toHaveLength(2)
		expect(run.operations).toContain('state_restore')
	})

	it('restores the complete snapshot when verification omits a written question', async () => {
		const source = question(false)
		const run = new FakeRun('fill', 'current_page', [source])
		run.omitVerification = true
		const result = await orchestrator(
			run,
			vi.fn(
				async (resolved: Question): Promise<AnswerModelResolution> => ({
					status: 'accepted',
					route: 'text',
					answer: answer(resolved, 'llm_text'),
					rechecked: false,
				}),
			),
		).execute({ action: 'fill', scope: 'current_page' })

		expect(result.questions[0]).toMatchObject({ status: 'fill_failed', pageEffect: 'restored' })
		expect(run.operations).toContain('state_restore')
	})

	it('resumes a capacity-paused page exactly once after result delivery is drained', async () => {
		let admitPage = false
		let runIndex = 0
		const resumeStore = new ResumeCursorStore({ tokenFactory: tokenFactory() })
		const resultStore = new ResultStore(resumeStore, { tokenFactory: tokenFactory() })
		const answerQuestion = vi.fn(
			async (resolved: Question): Promise<AnswerModelResolution> => ({
				status: 'accepted',
				route: 'text',
				answer: answer(resolved, 'llm_text'),
				rechecked: false,
			}),
		)
		const solver = new QuestionSolverOrchestrator({
			getLease: () => lease(),
			getModels: () => ({ text: { baseURL: 'https://model.test/v1', model: 'text' } }),
			beginRun: async (_lease, action, scope) =>
				new FakeRun(action, scope, [question(false)], `run-${++runIndex}`),
			answerQuestion,
			resumeStore,
			resultStore,
			capacityLedgerFactory: () => new GateCapacityLedger(() => admitPage),
		})

		const first = await solver.execute({ action: 'answer', scope: 'current_page' })
		expect(first).toMatchObject({
			status: 'partial',
			executionStatus: 'partial',
			blocker: { code: 'result_store_capacity_reached' },
			questions: [],
		})
		expect(first.resumeToken).toEqual(expect.any(String))
		expect(answerQuestion).not.toHaveBeenCalled()

		admitPage = true
		const resumed = await solver.execute({
			action: 'answer',
			scope: 'current_page',
			resumeToken: first.resumeToken,
		})
		expect(resumed).toMatchObject({
			status: 'completed',
			executionStatus: 'completed',
			counts: { discovered: 1, answered: 1 },
		})
		expect(resumed.resumeToken).toBeUndefined()
		expect(answerQuestion).toHaveBeenCalledOnce()
		expect(runIndex).toBe(2)
	})
})

class FakeRun implements QuestionSolverRunClient {
	readonly targetTabId = 1
	readonly operations: SolverOperation[] = []
	verifyMatched = true
	omitVerification = false
	hasNext = false
	blockOnInterruptCall?: number
	interruptCalls = 0
	private imageIndex = 0

	constructor(
		readonly action: QuestionSolverAction,
		readonly scope: QuestionSolverScope,
		private readonly questions: Question[],
		runId = 'run-1',
	) {
		this.identity = { taskId: 'task', taskEpoch: 1, runId }
	}

	readonly identity: { taskId: string; taskEpoch: number; runId: string }

	async discoverFrames() {
		return { frames: [FRAME], incompleteFrameIds: [] }
	}

	async request<T extends JsonValue = JsonValue>(
		_target: FrameRef,
		operation: SolverOperation,
		options: SolverRequestOptions = {},
	): Promise<T> {
		this.operations.push(operation)
		const payload = (options.payload ?? {}) as Record<string, any>
		let value: unknown
		switch (operation) {
			case 'probe':
				value = {
					ambiguous: false,
					selected: {
						matched: true,
						score: 1,
						ref: REF,
						navigationProfileId: 'chaoxing.modern.preview',
						surfaceFingerprint: 'surface',
						localRootRectCssPx: { x: 0, y: 0, width: 100, height: 100 },
						questionRootCount: this.questions.length,
						evidenceCodes: [],
					},
				}
				break
			case 'interrupts':
				this.interruptCalls++
				value =
					this.interruptCalls === this.blockOnInterruptCall
						? { blocked: true, kind: 'captcha', evidenceCodes: ['fixture-captcha'] }
						: { blocked: false, evidenceCodes: [] }
				break
			case 'extract':
				value = this.questions
				break
			case 'ready':
				value = {
					ready: true,
					logicalPageFingerprint: 'c'.repeat(64),
					bindingFingerprint: 'd'.repeat(64),
					networkQuietObserved: true,
					warningCodes: [],
				}
				break
			case 'embedded_read':
				value = []
				break
			case 'image_resolve': {
				const locator = payload.locator as { fingerprint: string }
				const base64 = PNG
				const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
				value = {
					kind: 'resolved',
					resolution: 'screenshot',
					envelope: {
						kind: 'question_solver_image_asset',
						assetId: `asset-${++this.imageIndex}-unique`,
						runId: this.identity.runId,
						questionFingerprint: locator.fingerprint,
						anchorKey: payload.anchorKey,
						mimeType: 'image/png',
						base64,
						sha256: await sha256Hex(bytes),
						width: 1,
						height: 1,
						byteLength: bytes.byteLength,
					},
				}
				break
			}
			case 'state_capture':
				value = {
					transactionId: 'transaction-1',
					snapshotDigestVersion: 1,
					snapshotDigest: 'e'.repeat(64),
					logicalPageFingerprint: 'c'.repeat(64),
					bindingFingerprint: 'd'.repeat(64),
					values: [],
					restoreCapability: 'exact',
				}
				break
			case 'fill':
				value = [
					{
						questionFingerprint: this.questions[0].locator.fingerprint,
						result: 'written',
						changed: true,
						warningCodes: [],
					},
				]
				break
			case 'verify':
				value = this.omitVerification
					? []
					: [
							{
								questionFingerprint: this.questions[0].locator.fingerprint,
								dom: this.verifyMatched ? 'matched' : 'mismatch',
								runtime: 'unavailable',
								warningCodes: [],
							},
						]
				break
			case 'state_restore':
				value = { restored: true, verified: true, pageMayRemainModified: false, warningCodes: [] }
				break
			case 'navigation':
				value = {
					profileId: 'chaoxing.modern.preview',
					hasNext: this.hasNext,
					mode: 'read_only',
					advanceEffect: 'none',
				}
				break
			case 'next':
				value = { initiated: true, oldDocumentExpectedToUnload: false, warningCodes: [] }
				break
			default:
				throw new Error(`Unexpected operation: ${operation}`)
		}
		return value as T
	}

	async cancel() {}
	async enterCleanup() {}
	async finish(): Promise<'closed'> {
		return 'closed'
	}
}

function orchestrator(run: FakeRun, answerQuestion: ReturnType<typeof vi.fn>) {
	return new QuestionSolverOrchestrator({
		getLease: () => lease(),
		getModels: () => ({ text: { baseURL: 'https://model.test/v1', model: 'text' } }),
		beginRun: async () => run,
		answerQuestion: answerQuestion as any,
	})
}

function lease(): QuestionSolverTaskLease {
	return {
		taskId: 'task',
		taskEpoch: 1,
		leaseToken: 'lease-token-that-is-long-enough-for-the-solver',
		managedTabIds: [1],
		targetTabId: 1,
	}
}

function question(withImages: boolean): Question {
	const fingerprint = 'f'.repeat(64)
	return {
		locator: {
			platform: 'chaoxing',
			variant: REF.variant,
			adapterVersion: 1,
			tabId: 1,
			frameId: 0,
			platformQuestionId: 'q1',
			fingerprint,
		},
		type: 'single',
		stem: withImages
			? [
					{ type: 'text', text: 'Choose the matching diagram' },
					{
						type: 'image',
						label: 'stem diagram',
						anchorKey: 'anchor-stem',
						requiredForAnswer: true,
						resolution: 'failed',
					},
				]
			: [{ type: 'text', text: 'Which option is correct?' }],
		options: [
			{ key: 'A', content: [{ type: 'text', text: 'First' }] },
			{
				key: 'B',
				content: withImages
					? [
							{ type: 'text', text: 'Second' },
							{
								type: 'image',
								label: 'option B diagram',
								anchorKey: 'anchor-option-b',
								requiredForAnswer: true,
								resolution: 'failed',
							},
						]
					: [{ type: 'text', text: 'Second' }],
			},
		],
		hasRequiredVisuals: withImages,
		visibility: 'fully_visible',
		visualAnchorKeys: withImages ? ['anchor-stem', 'anchor-option-b'] : [],
		extractionWarnings: [],
	}
}

function answer(question: Question, source: 'llm_text' | 'llm_vision'): StructuredAnswer {
	return {
		questionFingerprint: question.locator.fingerprint,
		type: 'single',
		selectedOptions: ['B'],
		evidence: {
			source,
			questionFingerprint: question.locator.fingerprint,
			mappingConfidence: 1,
			modelConfidence: 0.9,
			warnings: [],
		},
	}
}

class GateCapacityLedger extends ResultCapacityLedger {
	constructor(private readonly isOpen: () => boolean) {
		super()
	}

	override canReserve(outcomeCount: number, maximumOutcomeBytes?: number): boolean {
		return this.isOpen() && super.canReserve(outcomeCount, maximumOutcomeBytes)
	}
}

function tokenFactory(): () => string {
	let index = 0
	return () => `question-solver-test-token-${++index}`
}
