import { describe, expect, it, vi } from 'vitest'

import type { QuestionOutcomeSummary, QuestionSolverResult, RunIdentity } from './contracts'
import {
	QUESTION_OUTCOME_MAX_BYTES,
	QUESTION_RESULT_TTL_MS,
	RESULT_CHUNK_MAX_BYTES,
	RESULT_STORE_MAX_OUTCOMES,
	ResultCapacityLedger,
	ResultStore,
	ResumeCursorStore,
	type QuestionSolverResultBase,
	type ResumeCursorClaimInput,
	type ResumeCursorInput,
	type ResumePrefixState,
} from './resultStore'
import { summarizeQuestionOutcomes } from './stateMachine'

describe('question solver ResultStore', () => {
	it('delivers ordered outcomes without loss or duplication under the 96 KiB wire budget', () => {
		const tokens = tokenFactory()
		const store = new ResultStore(undefined, { tokenFactory: tokens })
		const questions = Array.from({ length: 48 }, (_, index) => outcome(index, 2_800))
		const expectedCounts = summarizeQuestionOutcomes(questions, 2)
		const pageModelOrWrite = {
			page: vi.fn(),
			model: vi.fn(),
			write: vi.fn(),
		}

		const chunks = drain(
			store,
			store.publish({
				identity: identity('source-run'),
				base: base(questions, { counts: expectedCounts }),
				questions,
			}),
		)

		expect(chunks.length).toBeGreaterThan(1)
		expect(
			chunks.flatMap((chunk) => chunk.questions.map((item) => item.questionFingerprint)),
		).toEqual(questions.map((item) => item.questionFingerprint))
		expect(
			new Set(chunks.flatMap((chunk) => chunk.questions.map((item) => item.questionFingerprint)))
				.size,
		).toBe(questions.length)
		expect(chunks.every((chunk) => byteLength(chunk) <= RESULT_CHUNK_MAX_BYTES)).toBe(true)
		expect(
			chunks.every((chunk) => JSON.stringify(chunk.counts) === JSON.stringify(expectedCounts)),
		).toBe(true)
		expect(chunks.slice(0, -1).every((chunk) => chunk.status === 'partial')).toBe(true)
		expect(chunks.at(-1)?.status).toBe('completed')
		expect(chunks.at(-1)?.executionStatus).toBe('completed')
		expect(chunks.at(-1)?.delivery.continuationToken).toBeUndefined()
		expect(pageModelOrWrite.page).not.toHaveBeenCalled()
		expect(pageModelOrWrite.model).not.toHaveBeenCalled()
		expect(pageModelOrWrite.write).not.toHaveBeenCalled()
	})

	it('keeps a capacity resume token on every chunk and unlocks it only after the final drain', () => {
		const tokens = tokenFactory()
		const resumeCursors = new ResumeCursorStore({ tokenFactory: tokens })
		const resumeToken = resumeCursors.create(cursorInput())
		const store = new ResultStore(resumeCursors, { tokenFactory: tokens })
		const questions = Array.from({ length: 48 }, (_, index) => outcome(index, 2_800))
		const first = store.publish({
			identity: identity('source-run'),
			base: base(questions, { executionStatus: 'partial', resumeToken }),
			questions,
		})

		expect(() => resumeCursors.claim(claimInput(resumeToken, 'resume-run'))).toThrowError(
			expect.objectContaining({ code: 'resume_delivery_pending' }),
		)
		const chunks = drain(store, first)
		expect(chunks.every((chunk) => chunk.resumeToken === resumeToken)).toBe(true)
		expect(resumeCursors.has(resumeToken)).toBe(true)
		const claim = resumeCursors.claim(claimInput(resumeToken, 'resume-run'))
		expect(claim.claimedByRunId).toBe('resume-run')
		expect(
			resumeCursors.validateClaim({
				resumeToken,
				identity: identity('resume-run'),
				prefix: prefix(),
			}),
		).toEqual(claim)

		const consumed = resumeCursors.consume({
			resumeToken,
			identity: identity('resume-run'),
			prefix: prefix(),
		})
		expect(consumed.resumeToken).toBe(resumeToken)
		expect(resumeCursors.has(resumeToken)).toBe(false)

		const chainedToken = resumeCursors.create(
			cursorInput({ identity: identity('resume-run'), orderedPrefixHash: 'd'.repeat(64) }),
		)
		expect(chainedToken).not.toBe(resumeToken)
	})

	it('expires continuation reads without recreating an execution', () => {
		let now = 10
		const store = new ResultStore(undefined, { now: () => now, tokenFactory: tokenFactory() })
		const questions = Array.from({ length: 48 }, (_, index) => outcome(index, 2_800))
		const first = store.publish({
			identity: identity('source-run'),
			base: base(questions),
			questions,
		})
		const continuationToken = first.delivery.continuationToken!

		now += QUESTION_RESULT_TTL_MS

		expect(() =>
			store.readContinuation({ taskId: 'task-1', taskEpoch: 2, continuationToken }),
		).toThrowError(expect.objectContaining({ code: 'continuation_expired' }))
	})

	it('enforces per-outcome, count and total-byte capacity before publication', () => {
		const store = new ResultStore(undefined, { tokenFactory: tokenFactory() })
		const oversized = [outcome(0, QUESTION_OUTCOME_MAX_BYTES + 1_000)]
		expect(() =>
			store.publish({
				identity: identity('source-run'),
				base: base(oversized),
				questions: oversized,
			}),
		).toThrow('question_outcome_too_large')

		const tooMany = Array.from({ length: RESULT_STORE_MAX_OUTCOMES + 1 }, (_, index) =>
			outcome(index),
		)
		expect(() =>
			store.publish({
				identity: identity('source-run'),
				base: base(tooMany),
				questions: tooMany,
			}),
		).toThrowError(expect.objectContaining({ code: 'result_store_capacity_exceeded' }))

		const ledger = new ResultCapacityLedger()
		let index = 0
		while (ledger.accept(outcome(index++, 7_000))) {}
		expect(ledger.measure().outcomeCount).toBeLessThan(RESULT_STORE_MAX_OUTCOMES)
		expect(ledger.canAccept(outcome(index, QUESTION_OUTCOME_MAX_BYTES + 1_000))).toBe(false)
	})

	it('rejects counts that do not describe the complete stored outcome set', () => {
		const store = new ResultStore(undefined, { tokenFactory: tokenFactory() })
		const questions = [outcome(0)]
		const invalid = base(questions)
		invalid.counts = { ...invalid.counts, discovered: 2, inspected: 1 }

		expect(() =>
			store.publish({ identity: identity('source-run'), base: invalid, questions }),
		).toThrowError(expect.objectContaining({ code: 'result_counts_mismatch' }))
	})

	it('releases unused continuation identifiers after single-chunk publications', () => {
		let index = 0
		const identifiers = ['reused-delivery-token', 'reused-continuation-token']
		const store = new ResultStore(undefined, {
			tokenFactory: () => identifiers[index++ % identifiers.length],
		})
		const questions = [outcome(0)]

		expect(() =>
			store.publish({
				identity: identity('first-run'),
				base: base(questions),
				questions,
			}),
		).not.toThrow()
		expect(() =>
			store.publish({
				identity: identity('second-run'),
				base: base(questions),
				questions,
			}),
		).not.toThrow()
	})
})

describe('question solver ResumeCursorStore', () => {
	it('binds resume to task epoch, action, scope, original tab and managed lease', () => {
		const store = readyResumeStore()

		expect(() =>
			store.cursors.claim(claimInput(store.resumeToken, 'resume-run', { targetTabId: 8 })),
		).toThrowError(expect.objectContaining({ code: 'resume_target_mismatch' }))
		expect(() =>
			store.cursors.claim(
				claimInput(store.resumeToken, 'resume-run', { managedTabLeaseId: 'other-lease' }),
			),
		).toThrowError(expect.objectContaining({ code: 'resume_target_mismatch' }))
		expect(() =>
			store.cursors.claim(claimInput(store.resumeToken, 'resume-run', { action: 'answer' })),
		).toThrowError(expect.objectContaining({ code: 'resume_authorization_mismatch' }))
		expect(() =>
			store.cursors.claim({
				...claimInput(store.resumeToken, 'resume-run'),
				identity: { taskId: 'task-1', taskEpoch: 3, runId: 'resume-run' },
			}),
		).toThrowError(expect.objectContaining({ code: 'resume_expired' }))

		expect(store.cursors.claim(claimInput(store.resumeToken, 'resume-run')).claimedByRunId).toBe(
			'resume-run',
		)
	})

	it('allows only one run to claim, supports pre-effect release, and validates the ordered prefix', () => {
		const { cursors, resumeToken } = readyResumeStore()
		cursors.claim(claimInput(resumeToken, 'resume-run-1'))
		expect(() => cursors.claim(claimInput(resumeToken, 'resume-run-2'))).toThrowError(
			expect.objectContaining({ code: 'resume_already_claimed' }),
		)
		expect(() =>
			cursors.validateClaim({
				resumeToken,
				identity: identity('resume-run-1'),
				prefix: { ...prefix(), orderedPrefixHash: '0'.repeat(64) },
			}),
		).toThrowError(expect.objectContaining({ code: 'resume_cursor_mismatch' }))

		expect(cursors.release({ resumeToken, identity: identity('resume-run-1') })).toBe(true)
		expect(cursors.claim(claimInput(resumeToken, 'resume-run-2')).claimedByRunId).toBe(
			'resume-run-2',
		)
	})

	it('expires independently and clears only the requested task generation', () => {
		let now = 100
		const cursors = new ResumeCursorStore({ now: () => now, tokenFactory: tokenFactory() })
		const expired = cursors.create(cursorInput())
		const otherEpoch = cursors.create(
			cursorInput({ identity: { taskId: 'task-1', taskEpoch: 3, runId: 'source-2' } }),
		)
		now += QUESTION_RESULT_TTL_MS

		expect(cursors.has(expired)).toBe(false)
		expect(() => cursors.claim(claimInput(expired, 'resume-run'))).toThrowError(
			expect.objectContaining({ code: 'resume_expired' }),
		)
		expect(cursors.clearTask('task-1', 3)).toBe(1)
		expect(cursors.has(otherEpoch)).toBe(false)
	})
})

function drain(store: ResultStore, first: QuestionSolverResult): QuestionSolverResult[] {
	const chunks = [first]
	let current = first
	while (current.delivery.hasMore) {
		current = store.readContinuation({
			taskId: 'task-1',
			taskEpoch: 2,
			continuationToken: current.delivery.continuationToken!,
		})
		chunks.push(current)
	}
	return chunks
}

function readyResumeStore(): { cursors: ResumeCursorStore; resumeToken: string } {
	const cursors = new ResumeCursorStore({ tokenFactory: tokenFactory() })
	const resumeToken = cursors.create(cursorInput())
	cursors.attachDelivery({
		resumeToken,
		deliveryId: 'delivery-0000000001',
		taskId: 'task-1',
		taskEpoch: 2,
	})
	cursors.markDeliveryDrained({
		resumeToken,
		deliveryId: 'delivery-0000000001',
		taskId: 'task-1',
		taskEpoch: 2,
	})
	return { cursors, resumeToken }
}

function base(
	questions: readonly QuestionOutcomeSummary[],
	overrides: Partial<QuestionSolverResultBase> = {},
): QuestionSolverResultBase {
	return {
		mode: 'capability',
		capability: 'question_solver',
		action: 'answer',
		scope: 'current_page',
		executionStatus: 'completed',
		platform: 'chaoxing',
		adapters: [
			{
				ref: { platform: 'chaoxing', variant: 'chaoxing.modern_work_exam', version: 1 },
				maturity: 'fixture_verified',
				pages: 1,
			},
		],
		counts: summarizeQuestionOutcomes(questions, 1),
		finalSubmissionPerformed: false,
		...overrides,
	}
}

function outcome(index: number, payloadLength = 20): QuestionOutcomeSummary {
	const payload = 'x'.repeat(payloadLength)
	const stem = Array.from({ length: Math.ceil(payload.length / 1_000) || 1 }, (_, part) => ({
		kind: 'text' as const,
		text: payload.slice(part * 1_000, (part + 1) * 1_000),
		truncated: false,
	}))
	return {
		adapter: { platform: 'chaoxing', variant: 'chaoxing.modern_work_exam', version: 1 },
		questionFingerprint: index.toString(16).padStart(64, '0'),
		pageOrdinal: 1,
		questionOrdinal: String(index + 1),
		type: 'single',
		status: 'answered_notFilled',
		question: {
			stem,
			options: [{ key: 'A', content: [{ kind: 'text', text: 'Option A', truncated: false }] }],
		},
		answer: {
			parts: [{ kind: 'choice', questionPath: 'root', selectedOptionKeys: ['A'] }],
		},
		evidence: {
			source: 'llm_text',
			mappingConfidence: 0.95,
			modelConfidence: 0.9,
			warningCodes: [],
		},
		pageEffect: 'none',
		warningCodes: [],
	}
}

function cursorInput(overrides: Partial<ResumeCursorInput> = {}): ResumeCursorInput {
	return {
		identity: identity('source-run'),
		action: 'fill',
		scope: 'all_pages',
		targetTabId: 7,
		managedTabLeaseId: 'managed-lease-1',
		platform: 'chaoxing',
		variant: 'chaoxing.modern_work_exam',
		navigationProfileId: 'chaoxing.modern.serial',
		logicalPageFingerprint: 'logical-page-1',
		lastTerminalQuestionFingerprint: 'b'.repeat(64),
		orderedPrefixHash: 'c'.repeat(64),
		processedQuestionCount: 48,
		...overrides,
	}
}

function claimInput(
	resumeToken: string,
	runId: string,
	overrides: Partial<ResumeCursorClaimInput> = {},
): ResumeCursorClaimInput {
	return {
		resumeToken,
		identity: identity(runId),
		action: 'fill',
		scope: 'all_pages',
		targetTabId: 7,
		managedTabLeaseId: 'managed-lease-1',
		...overrides,
	}
}

function prefix(): ResumePrefixState {
	return {
		platform: 'chaoxing',
		variant: 'chaoxing.modern_work_exam',
		navigationProfileId: 'chaoxing.modern.serial',
		logicalPageFingerprint: 'logical-page-1',
		lastTerminalQuestionFingerprint: 'b'.repeat(64),
		orderedPrefixHash: 'c'.repeat(64),
		processedQuestionCount: 48,
	}
}

function identity(runId: string): RunIdentity {
	return { taskId: 'task-1', taskEpoch: 2, runId }
}

function tokenFactory(): () => string {
	let next = 0
	return () => `token-${String(++next).padStart(20, '0')}`
}

function byteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
