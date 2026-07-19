import { describe, expect, it } from 'vitest'

import type {
	QuestionOutcomeStatus,
	QuestionOutcomeSummary,
	QuestionProcessingState,
	QuestionSolverAction,
} from './contracts'
import {
	assertQuestionOutcomeContract,
	assertQuestionSolverCounts,
	reduceExecutionStatus,
	summarizeQuestionOutcomes,
	transitionQuestionState,
	type QuestionStateEvent,
} from './stateMachine'

describe('question processing state machine', () => {
	it.each<
		[QuestionSolverAction, QuestionProcessingState, QuestionStateEvent, QuestionProcessingState]
	>([
		['inspect', 'discovered', 'inspect_completed', 'inspected'],
		['inspect', 'discovered', 'mapping_incomplete', 'needsReview_notFilled'],
		['answer', 'discovered', 'resolution_started', 'resolving'],
		['fill', 'discovered', 'resolution_started', 'resolving'],
		['answer', 'resolving', 'resolution_succeeded', 'answer_resolved'],
		['fill', 'resolving', 'resolution_failed', 'needsReview_notFilled'],
		['answer', 'answer_resolved', 'answer_completed', 'answered_notFilled'],
		['fill', 'answer_resolved', 'fill_unavailable', 'answered_notFilled'],
		['fill', 'answer_resolved', 'snapshot_ready', 'fill_ready'],
		['fill', 'fill_ready', 'already_exact', 'filled_verified'],
		['fill', 'fill_ready', 'fingerprint_unstable', 'needsReview_notFilled'],
		['fill', 'fill_ready', 'write_started', 'verifying'],
		['fill', 'verifying', 'verification_succeeded', 'filled_verified'],
		['fill', 'verifying', 'retry_write', 'verifying'],
		['fill', 'verifying', 'verification_failed_restored', 'fill_failed'],
		['fill', 'verifying', 'verification_failed_unrestored', 'filled_unverified'],
		['fill', 'verifying', 'write_interrupted_restored', 'fill_failed'],
		['fill', 'verifying', 'write_interrupted_unrestored', 'filled_unverified'],
	])('%s: %s + %s -> %s', (action, state, event, expected) => {
		expect(transitionQuestionState({ action, state, event })).toBe(expected)
	})

	it('maps interruption according to whether a valid answer or a dispatched write exists', () => {
		expect(
			transitionQuestionState({
				action: 'answer',
				state: 'resolving',
				event: 'interrupted_without_answer',
			}),
		).toBe('skipped')
		expect(
			transitionQuestionState({
				action: 'fill',
				state: 'fill_ready',
				event: 'interrupted_with_answer',
			}),
		).toBe('answered_notFilled')
		expect(
			transitionQuestionState({
				action: 'fill',
				state: 'verifying',
				event: 'write_interrupted_unrestored',
			}),
		).toBe('filled_unverified')
	})

	it('rejects action escalation and keeps every terminal outcome immutable', () => {
		expect(() =>
			transitionQuestionState({
				action: 'inspect',
				state: 'discovered',
				event: 'resolution_started',
			}),
		).toThrow('question_state_transition_forbidden')
		expect(() =>
			transitionQuestionState({
				action: 'answer',
				state: 'answer_resolved',
				event: 'snapshot_ready',
			}),
		).toThrow('question_state_transition_forbidden')

		for (const status of [
			'inspected',
			'answered_notFilled',
			'needsReview_notFilled',
			'filled_verified',
			'fill_failed',
			'filled_unverified',
			'skipped',
		] as const) {
			expect(
				transitionQuestionState({ action: actionFor(status), state: status, event: 'late_result' }),
			).toBe(status)
			expect(() =>
				transitionQuestionState({
					action: actionFor(status),
					state: status,
					event: 'mapping_incomplete',
				}),
			).toThrow('question_state_transition_forbidden')
		}
	})
})

describe('question outcome contract', () => {
	it('accepts all seven terminal shapes with their exact page effects', () => {
		const cases: Array<[QuestionSolverAction, QuestionOutcomeSummary]> = [
			['inspect', outcome('inspected')],
			['answer', outcome('answered_notFilled')],
			['answer', outcome('needsReview_notFilled')],
			['fill', outcome('filled_verified', { pageEffect: 'already_exact' })],
			['fill', outcome('fill_failed', { pageEffect: 'restored' })],
			['fill', outcome('filled_unverified')],
			['fill', outcome('skipped')],
		]
		for (const [action, summary] of cases) {
			expect(() => assertQuestionOutcomeContract(action, summary)).not.toThrow()
		}
	})

	it('requires answer/evidence/problem presence and status-specific effects', () => {
		expect(() =>
			assertQuestionOutcomeContract('answer', outcome('answered_notFilled', { answer: undefined })),
		).toThrow('question_outcome_answer_presence')
		expect(() =>
			assertQuestionOutcomeContract(
				'inspect',
				outcome('inspected', { answer: answer(), evidence: evidence() }),
			),
		).toThrow('question_outcome_answer_presence')
		expect(() =>
			assertQuestionOutcomeContract('fill', outcome('answered_notFilled', { problem: undefined })),
		).toThrow('question_outcome_problem_required')
		expect(() =>
			assertQuestionOutcomeContract('fill', outcome('fill_failed', { problem: undefined })),
		).toThrow('question_outcome_problem_required')
		expect(() =>
			assertQuestionOutcomeContract(
				'fill',
				outcome('filled_verified', { pageEffect: 'possibly_modified' }),
			),
		).toThrow('question_outcome_page_effect')
		expect(() => assertQuestionOutcomeContract('answer', outcome('filled_verified'))).toThrow(
			'question_outcome_status_forbidden',
		)
	})
})

describe('question solver counts and execution status', () => {
	it('derives all count invariants from mutually exclusive outcomes', () => {
		const outcomes = [
			outcome('inspected'),
			outcome('answered_notFilled'),
			outcome('needsReview_notFilled'),
			outcome('filled_verified'),
			outcome('fill_failed'),
			outcome('filled_unverified'),
			outcome('skipped'),
		]
		expect(summarizeQuestionOutcomes(outcomes, 3)).toEqual({
			pages: 3,
			discovered: 7,
			inspected: 1,
			answered: 4,
			answeredNotFilled: 1,
			filledVerified: 1,
			needsReviewNotFilled: 1,
			fillFailed: 1,
			filledUnverified: 1,
			skipped: 1,
		})
		expect(() =>
			assertQuestionSolverCounts({
				...summarizeQuestionOutcomes(outcomes, 3),
				answered: 5,
			}),
		).toThrow('question_solver_counts_answered_mismatch')
	})

	it('reduces blocker, cancel, fatal, capacity and completed scope deterministically', () => {
		expect(
			reduceExecutionStatus({
				scopeExhausted: false,
				stablePageCount: 1,
				discoveredQuestionCount: 2,
				terminalOutcomeCount: 1,
				hasUnresolvedTakeoverBlocker: true,
				fatalError: true,
			}),
		).toBe('blocked')
		expect(
			reduceExecutionStatus({
				scopeExhausted: false,
				stablePageCount: 1,
				discoveredQuestionCount: 2,
				terminalOutcomeCount: 1,
				fatalError: true,
			}),
		).toBe('partial')
		expect(
			reduceExecutionStatus({
				scopeExhausted: false,
				stablePageCount: 0,
				discoveredQuestionCount: 0,
				terminalOutcomeCount: 0,
				cancelled: true,
			}),
		).toBe('partial')
		expect(
			reduceExecutionStatus({
				scopeExhausted: false,
				stablePageCount: 0,
				discoveredQuestionCount: 0,
				terminalOutcomeCount: 0,
				fatalError: true,
			}),
		).toBe('failed')
		expect(
			reduceExecutionStatus({
				scopeExhausted: false,
				stablePageCount: 2,
				discoveredQuestionCount: 10,
				terminalOutcomeCount: 8,
				capacityStopped: true,
			}),
		).toBe('partial')
		expect(
			reduceExecutionStatus({
				scopeExhausted: true,
				stablePageCount: 1,
				discoveredQuestionCount: 3,
				terminalOutcomeCount: 3,
				cancelled: true,
			}),
		).toBe('completed')
	})
})

function actionFor(status: QuestionOutcomeStatus): QuestionSolverAction {
	if (status === 'inspected') return 'inspect'
	if (status === 'answered_notFilled') return 'answer'
	return 'fill'
}

function outcome(
	status: QuestionOutcomeStatus,
	overrides: Partial<QuestionOutcomeSummary> = {},
): QuestionOutcomeSummary {
	const withAnswer = [
		'answered_notFilled',
		'filled_verified',
		'fill_failed',
		'filled_unverified',
	].includes(status)
	const withProblem = [
		'needsReview_notFilled',
		'fill_failed',
		'filled_unverified',
		'skipped',
	].includes(status)
	const pageEffect = {
		inspected: 'none',
		answered_notFilled: 'none',
		needsReview_notFilled: 'none',
		filled_verified: 'written_and_verified',
		fill_failed: 'restored',
		filled_unverified: 'possibly_modified',
		skipped: 'none',
	}[status] as QuestionOutcomeSummary['pageEffect']

	return {
		adapter: { platform: 'chaoxing', variant: 'chaoxing.modern_work_exam', version: 1 },
		questionFingerprint: 'a'.repeat(64),
		pageOrdinal: 1,
		questionOrdinal: '1',
		type: 'single',
		status,
		question: {
			stem: [{ kind: 'text', text: 'Question', truncated: false }],
			options: [{ key: 'A', content: [{ kind: 'text', text: 'Answer', truncated: false }] }],
		},
		...(withAnswer ? { answer: answer(), evidence: evidence() } : {}),
		pageEffect,
		...(withProblem
			? {
					problem: {
						code: 'review_required',
						stage: 'verify' as const,
						message: 'Review required.',
						retryable: false,
						requiresReview: true,
					},
				}
			: {}),
		warningCodes: [],
		...overrides,
	}
}

function answer(): NonNullable<QuestionOutcomeSummary['answer']> {
	return {
		parts: [{ kind: 'choice', questionPath: 'root', selectedOptionKeys: ['A'] }],
	}
}

function evidence(): NonNullable<QuestionOutcomeSummary['evidence']> {
	return {
		source: 'llm_text',
		mappingConfidence: 0.9,
		modelConfidence: 0.9,
		warningCodes: [],
	}
}
