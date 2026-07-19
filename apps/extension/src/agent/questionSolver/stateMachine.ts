import {
	QUESTION_OUTCOME_STATUSES,
	type QuestionOutcomeStatus,
	type QuestionOutcomeSummary,
	type QuestionProcessingState,
	type QuestionSolverAction,
	type QuestionSolverCounts,
	type SolverExecutionStatus,
} from './contracts'

export type QuestionStateEvent =
	| 'inspect_completed'
	| 'mapping_incomplete'
	| 'resolution_started'
	| 'resolution_succeeded'
	| 'resolution_failed'
	| 'answer_completed'
	| 'fill_unavailable'
	| 'snapshot_ready'
	| 'already_exact'
	| 'fingerprint_unstable'
	| 'write_started'
	| 'verification_succeeded'
	| 'retry_write'
	| 'verification_failed_restored'
	| 'verification_failed_unrestored'
	| 'interrupted_without_answer'
	| 'interrupted_with_answer'
	| 'write_interrupted_restored'
	| 'write_interrupted_unrestored'
	| 'late_result'

export interface QuestionStateTransition {
	action: QuestionSolverAction
	state: QuestionProcessingState
	event: QuestionStateEvent
}

export interface ExecutionStatusReductionInput {
	scopeExhausted: boolean
	stablePageCount: number
	discoveredQuestionCount: number
	terminalOutcomeCount: number
	hasUnresolvedTakeoverBlocker?: boolean
	cancelled?: boolean
	stoppedEarly?: boolean
	fatalError?: boolean
	capacityStopped?: boolean
}

const TERMINAL_STATES = new Set<QuestionProcessingState>(QUESTION_OUTCOME_STATUSES)

const ACTION_STATUSES: Record<QuestionSolverAction, ReadonlySet<QuestionOutcomeStatus>> = {
	inspect: new Set(['inspected', 'needsReview_notFilled', 'skipped']),
	answer: new Set(['answered_notFilled', 'needsReview_notFilled', 'skipped']),
	fill: new Set([
		'answered_notFilled',
		'needsReview_notFilled',
		'filled_verified',
		'fill_failed',
		'filled_unverified',
		'skipped',
	]),
}

const ANSWER_STATUSES = new Set<QuestionOutcomeStatus>([
	'answered_notFilled',
	'filled_verified',
	'fill_failed',
	'filled_unverified',
])

const PROBLEM_STATUSES = new Set<QuestionOutcomeStatus>([
	'needsReview_notFilled',
	'fill_failed',
	'filled_unverified',
	'skipped',
])

const PAGE_EFFECTS_BY_STATUS: Record<
	QuestionOutcomeStatus,
	ReadonlySet<QuestionOutcomeSummary['pageEffect']>
> = {
	inspected: new Set(['none']),
	answered_notFilled: new Set(['none']),
	needsReview_notFilled: new Set(['none']),
	filled_verified: new Set(['already_exact', 'written_and_verified']),
	fill_failed: new Set(['none', 'restored']),
	filled_unverified: new Set(['possibly_modified']),
	skipped: new Set(['none']),
}

export function isTerminalQuestionState(
	state: QuestionProcessingState,
): state is QuestionOutcomeStatus {
	return TERMINAL_STATES.has(state)
}

export function transitionQuestionState({
	action,
	state,
	event,
}: QuestionStateTransition): QuestionProcessingState {
	if (isTerminalQuestionState(state)) {
		if (event === 'late_result') return state
		throw invalidTransition(action, state, event)
	}

	if (state === 'discovered') {
		if (event === 'mapping_incomplete') return 'needsReview_notFilled'
		if (event === 'interrupted_without_answer') return 'skipped'
		if (event === 'inspect_completed' && action === 'inspect') return 'inspected'
		if (event === 'resolution_started' && action !== 'inspect') return 'resolving'
	}

	if (state === 'resolving' && action !== 'inspect') {
		if (event === 'resolution_succeeded') return 'answer_resolved'
		if (event === 'resolution_failed') return 'needsReview_notFilled'
		if (event === 'interrupted_without_answer') return 'skipped'
	}

	if (state === 'answer_resolved' && action !== 'inspect') {
		if (event === 'interrupted_with_answer') return 'answered_notFilled'
		if (event === 'answer_completed' && action === 'answer') return 'answered_notFilled'
		if (event === 'fill_unavailable' && action === 'fill') return 'answered_notFilled'
		if (event === 'snapshot_ready' && action === 'fill') return 'fill_ready'
	}

	if (state === 'fill_ready' && action === 'fill') {
		if (event === 'already_exact') return 'filled_verified'
		if (event === 'fingerprint_unstable') return 'needsReview_notFilled'
		if (event === 'write_started') return 'verifying'
		if (event === 'interrupted_with_answer') return 'answered_notFilled'
	}

	if (state === 'verifying' && action === 'fill') {
		if (event === 'verification_succeeded') return 'filled_verified'
		if (event === 'retry_write') return 'verifying'
		if (event === 'verification_failed_restored') return 'fill_failed'
		if (event === 'verification_failed_unrestored') return 'filled_unverified'
		if (event === 'write_interrupted_restored') return 'fill_failed'
		if (event === 'write_interrupted_unrestored') return 'filled_unverified'
	}

	throw invalidTransition(action, state, event)
}

export function assertQuestionOutcomeContract(
	action: QuestionSolverAction,
	outcome: QuestionOutcomeSummary,
): void {
	if (!ACTION_STATUSES[action].has(outcome.status)) {
		throw new Error(`question_outcome_status_forbidden:${action}:${outcome.status}`)
	}

	const requiresAnswer = ANSWER_STATUSES.has(outcome.status)
	if (requiresAnswer !== (outcome.answer !== undefined)) {
		throw new Error(`question_outcome_answer_presence:${outcome.status}`)
	}
	if (requiresAnswer !== (outcome.evidence !== undefined)) {
		throw new Error(`question_outcome_evidence_presence:${outcome.status}`)
	}

	const requiresProblem =
		PROBLEM_STATUSES.has(outcome.status) ||
		(action === 'fill' && outcome.status === 'answered_notFilled')
	if (requiresProblem && outcome.problem === undefined) {
		throw new Error(`question_outcome_problem_required:${action}:${outcome.status}`)
	}
	if (
		(outcome.status === 'inspected' || outcome.status === 'filled_verified') &&
		outcome.problem !== undefined
	) {
		throw new Error(`question_outcome_problem_forbidden:${outcome.status}`)
	}

	if (!PAGE_EFFECTS_BY_STATUS[outcome.status].has(outcome.pageEffect)) {
		throw new Error(`question_outcome_page_effect:${outcome.status}:${outcome.pageEffect}`)
	}

	if (serializedByteLength(outcome) > 8 * 1024) {
		throw new Error('question_outcome_too_large')
	}
}

export function summarizeQuestionOutcomes(
	outcomes: readonly QuestionOutcomeSummary[],
	pages: number,
): QuestionSolverCounts {
	assertNonNegativeInteger(pages, 'pages')
	const byStatus = Object.fromEntries(
		QUESTION_OUTCOME_STATUSES.map((status) => [status, 0]),
	) as Record<QuestionOutcomeStatus, number>
	for (const outcome of outcomes) byStatus[outcome.status]++

	const counts: QuestionSolverCounts = {
		pages,
		discovered: outcomes.length,
		inspected: byStatus.inspected,
		answered:
			byStatus.answered_notFilled +
			byStatus.filled_verified +
			byStatus.fill_failed +
			byStatus.filled_unverified,
		answeredNotFilled: byStatus.answered_notFilled,
		filledVerified: byStatus.filled_verified,
		needsReviewNotFilled: byStatus.needsReview_notFilled,
		fillFailed: byStatus.fill_failed,
		filledUnverified: byStatus.filled_unverified,
		skipped: byStatus.skipped,
	}
	assertQuestionSolverCounts(counts)
	return counts
}

export function assertQuestionSolverCounts(counts: QuestionSolverCounts): void {
	for (const [key, value] of Object.entries(counts)) assertNonNegativeInteger(value, key)

	const terminalTotal =
		counts.inspected +
		counts.answeredNotFilled +
		counts.needsReviewNotFilled +
		counts.filledVerified +
		counts.fillFailed +
		counts.filledUnverified +
		counts.skipped
	if (counts.discovered !== terminalTotal) {
		throw new Error('question_solver_counts_discovered_mismatch')
	}

	const answeredTotal =
		counts.answeredNotFilled + counts.filledVerified + counts.fillFailed + counts.filledUnverified
	if (counts.answered !== answeredTotal) {
		throw new Error('question_solver_counts_answered_mismatch')
	}
}

export function reduceExecutionStatus({
	scopeExhausted,
	stablePageCount,
	discoveredQuestionCount,
	terminalOutcomeCount,
	hasUnresolvedTakeoverBlocker = false,
	cancelled = false,
	stoppedEarly = false,
	fatalError = false,
	capacityStopped = false,
}: ExecutionStatusReductionInput): SolverExecutionStatus {
	assertNonNegativeInteger(stablePageCount, 'stablePageCount')
	assertNonNegativeInteger(discoveredQuestionCount, 'discoveredQuestionCount')
	assertNonNegativeInteger(terminalOutcomeCount, 'terminalOutcomeCount')
	if (terminalOutcomeCount > discoveredQuestionCount) {
		throw new Error('question_solver_terminal_count_exceeds_discovered')
	}

	if (!scopeExhausted && hasUnresolvedTakeoverBlocker) return 'blocked'

	const allDiscoveredQuestionsTerminal = terminalOutcomeCount === discoveredQuestionCount
	if (
		scopeExhausted &&
		allDiscoveredQuestionsTerminal &&
		!hasUnresolvedTakeoverBlocker &&
		!capacityStopped
	) {
		return 'completed'
	}

	const hasStableWork = stablePageCount > 0 || terminalOutcomeCount > 0
	if (
		hasStableWork &&
		(cancelled || stoppedEarly || fatalError || capacityStopped || !scopeExhausted)
	) {
		return 'partial'
	}
	if (cancelled) return 'partial'
	if (fatalError || stoppedEarly || !scopeExhausted) return 'failed'
	return 'failed'
}

function invalidTransition(
	action: QuestionSolverAction,
	state: QuestionProcessingState,
	event: QuestionStateEvent,
): Error {
	return new Error(`question_state_transition_forbidden:${action}:${state}:${event}`)
}

function assertNonNegativeInteger(value: number, field: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`question_solver_invalid_count:${field}`)
	}
}

function serializedByteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
