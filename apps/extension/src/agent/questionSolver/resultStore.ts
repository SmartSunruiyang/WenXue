import type {
	NavigationProfileId,
	QuestionOutcomeSummary,
	QuestionSolverAction,
	QuestionSolverResult,
	QuestionSolverScope,
	RunIdentity,
} from './contracts'
import { assertQuestionOutcomeContract, assertQuestionSolverCounts } from './stateMachine'

export const RESULT_CHUNK_MAX_BYTES = 96 * 1024
export const RESULT_STORE_MAX_BYTES = 8 * 1024 * 1024
export const RESULT_STORE_MAX_OUTCOMES = 2_000
export const QUESTION_OUTCOME_MAX_BYTES = 8 * 1024
export const QUESTION_RESULT_TTL_MS = 10 * 60 * 1_000

export type QuestionSolverResultBase = Omit<
	QuestionSolverResult,
	'status' | 'questions' | 'delivery'
>

export interface ResultPublication {
	identity: RunIdentity
	base: QuestionSolverResultBase
	questions: readonly QuestionOutcomeSummary[]
}

export interface ContinuationRead {
	taskId: string
	taskEpoch: number
	continuationToken: string
	action?: QuestionSolverAction
	scope?: QuestionSolverScope
}

export interface ResumeCursorInput {
	identity: RunIdentity
	action: QuestionSolverAction
	scope: QuestionSolverScope
	targetTabId: number
	managedTabLeaseId: string
	platform: string
	variant: string
	navigationProfileId: NavigationProfileId
	logicalPageFingerprint: string
	lastTerminalQuestionFingerprint?: string
	orderedPrefixHash: string
	processedQuestionCount: number
}

export interface ResumeCursorClaimInput {
	resumeToken: string
	identity: RunIdentity
	action: QuestionSolverAction
	scope: QuestionSolverScope
	targetTabId: number
	managedTabLeaseId: string
}

export interface ResumePrefixState {
	platform: string
	variant: string
	navigationProfileId: NavigationProfileId
	logicalPageFingerprint: string
	lastTerminalQuestionFingerprint?: string
	orderedPrefixHash: string
	processedQuestionCount: number
}

export interface ResumeCursorClaim extends ResumeCursorInput {
	resumeToken: string
	createdAt: number
	expiresAt: number
	claimedByRunId: string
}

export type QuestionSolverStoreErrorCode =
	| 'continuation_expired'
	| 'continuation_authorization_mismatch'
	| 'resume_expired'
	| 'resume_delivery_pending'
	| 'resume_target_mismatch'
	| 'resume_authorization_mismatch'
	| 'resume_already_claimed'
	| 'resume_claim_mismatch'
	| 'resume_cursor_mismatch'
	| 'result_outcome_too_large'
	| 'result_store_capacity_exceeded'
	| 'result_chunk_too_large'
	| 'result_counts_mismatch'
	| 'result_resume_token_invalid'
	| 'result_token_generation_failed'

export class QuestionSolverStoreError extends Error {
	readonly code: QuestionSolverStoreErrorCode

	constructor(code: QuestionSolverStoreErrorCode) {
		super(code)
		this.name = 'QuestionSolverStoreError'
		this.code = code
	}
}

interface StoredResult {
	taskId: string
	taskEpoch: number
	deliveryId: string
	resumeToken?: string
	expiresAt: number
	chunks: QuestionSolverResult[]
	nextChunkIndex: number
}

interface StoredResumeCursor extends ResumeCursorInput {
	resumeToken: string
	createdAt: number
	expiresAt: number
	deliveryId?: string
	deliveryDrained: boolean
	claimedByRunId?: string
}

interface StoreOptions {
	now?: () => number
	tokenFactory?: () => string
}

export class ResumeCursorStore {
	private readonly cursors = new Map<string, StoredResumeCursor>()
	private readonly now: () => number
	private readonly tokenFactory: () => string

	constructor(options: StoreOptions = {}) {
		this.now = options.now ?? Date.now
		this.tokenFactory = options.tokenFactory ?? createOpaqueToken
	}

	create(input: ResumeCursorInput): string {
		assertResumeCursorInput(input)
		this.clearExpired()
		const resumeToken = issueToken(this.tokenFactory, (token) => this.cursors.has(token))
		const createdAt = this.now()
		this.cursors.set(resumeToken, {
			...clone(input),
			resumeToken,
			createdAt,
			expiresAt: createdAt + QUESTION_RESULT_TTL_MS,
			deliveryDrained: false,
		})
		return resumeToken
	}

	attachDelivery(args: {
		resumeToken: string
		deliveryId: string
		taskId: string
		taskEpoch: number
	}): void {
		const cursor = this.requireCursor(args.resumeToken, args.taskId, args.taskEpoch)
		if (cursor.deliveryId !== undefined && cursor.deliveryId !== args.deliveryId) {
			throw new QuestionSolverStoreError('result_resume_token_invalid')
		}
		cursor.deliveryId = args.deliveryId
		cursor.deliveryDrained = false
	}

	markDeliveryDrained(args: {
		resumeToken: string
		deliveryId: string
		taskId: string
		taskEpoch: number
	}): void {
		const cursor = this.requireCursor(args.resumeToken, args.taskId, args.taskEpoch)
		if (cursor.deliveryId !== args.deliveryId) {
			throw new QuestionSolverStoreError('result_resume_token_invalid')
		}
		cursor.deliveryDrained = true
	}

	claim(input: ResumeCursorClaimInput): ResumeCursorClaim {
		assertResumeClaimInput(input)
		const cursor = this.requireCursor(
			input.resumeToken,
			input.identity.taskId,
			input.identity.taskEpoch,
		)
		if (
			cursor.targetTabId !== input.targetTabId ||
			cursor.managedTabLeaseId !== input.managedTabLeaseId
		) {
			throw new QuestionSolverStoreError('resume_target_mismatch')
		}
		if (cursor.action !== input.action || cursor.scope !== input.scope) {
			throw new QuestionSolverStoreError('resume_authorization_mismatch')
		}
		if (!cursor.deliveryDrained) {
			throw new QuestionSolverStoreError('resume_delivery_pending')
		}
		if (cursor.claimedByRunId !== undefined && cursor.claimedByRunId !== input.identity.runId) {
			throw new QuestionSolverStoreError('resume_already_claimed')
		}
		cursor.claimedByRunId = input.identity.runId
		return publicClaim(cursor)
	}

	validateClaim(args: {
		resumeToken: string
		identity: RunIdentity
		prefix: ResumePrefixState
	}): ResumeCursorClaim {
		const cursor = this.requireClaim(args.resumeToken, args.identity)
		assertResumePrefix(args.prefix)
		if (!sameResumePrefix(cursor, args.prefix)) {
			throw new QuestionSolverStoreError('resume_cursor_mismatch')
		}
		return publicClaim(cursor)
	}

	consume(args: {
		resumeToken: string
		identity: RunIdentity
		prefix: ResumePrefixState
	}): ResumeCursorClaim {
		const claim = this.validateClaim(args)
		this.cursors.delete(args.resumeToken)
		return claim
	}

	release(args: { resumeToken: string; identity: RunIdentity }): boolean {
		const cursor = this.cursors.get(args.resumeToken)
		if (!cursor || isExpired(cursor.expiresAt, this.now())) return false
		if (
			cursor.identity.taskId !== args.identity.taskId ||
			cursor.identity.taskEpoch !== args.identity.taskEpoch ||
			cursor.claimedByRunId !== args.identity.runId
		) {
			return false
		}
		cursor.claimedByRunId = undefined
		return true
	}

	clear(resumeToken: string): boolean {
		return this.cursors.delete(resumeToken)
	}

	clearTask(taskId: string, taskEpoch?: number): number {
		let removed = 0
		for (const [token, cursor] of this.cursors) {
			if (
				cursor.identity.taskId === taskId &&
				(taskEpoch === undefined || cursor.identity.taskEpoch === taskEpoch)
			) {
				this.cursors.delete(token)
				removed++
			}
		}
		return removed
	}

	clearExpired(): number {
		const now = this.now()
		let removed = 0
		for (const [token, cursor] of this.cursors) {
			if (isExpired(cursor.expiresAt, now)) {
				this.cursors.delete(token)
				removed++
			}
		}
		return removed
	}

	has(resumeToken: string): boolean {
		const cursor = this.cursors.get(resumeToken)
		if (!cursor || isExpired(cursor.expiresAt, this.now())) return false
		return true
	}

	private requireCursor(
		resumeToken: string,
		taskId: string,
		taskEpoch: number,
	): StoredResumeCursor {
		const cursor = this.cursors.get(resumeToken)
		if (!cursor || isExpired(cursor.expiresAt, this.now())) {
			if (cursor) this.cursors.delete(resumeToken)
			throw new QuestionSolverStoreError('resume_expired')
		}
		if (cursor.identity.taskId !== taskId || cursor.identity.taskEpoch !== taskEpoch) {
			throw new QuestionSolverStoreError('resume_expired')
		}
		return cursor
	}

	private requireClaim(resumeToken: string, identity: RunIdentity): StoredResumeCursor {
		const cursor = this.requireCursor(resumeToken, identity.taskId, identity.taskEpoch)
		if (cursor.claimedByRunId !== identity.runId) {
			throw new QuestionSolverStoreError('resume_claim_mismatch')
		}
		return cursor
	}
}

export class ResultStore {
	private readonly results = new Map<string, StoredResult>()
	private readonly issuedIds = new Set<string>()
	private readonly now: () => number
	private readonly tokenFactory: () => string

	constructor(
		private readonly resumeCursors?: ResumeCursorStore,
		options: StoreOptions = {},
	) {
		this.now = options.now ?? Date.now
		this.tokenFactory = options.tokenFactory ?? createOpaqueToken
	}

	publish({ identity, base, questions }: ResultPublication): QuestionSolverResult {
		this.clearExpired()
		assertPublication(base, questions)
		const deliveryId = this.issueId()
		const continuationToken = this.issueId()
		const storedBase = clone(base)
		const storedQuestions = clone(questions)
		const chunks = splitResult(storedBase, storedQuestions, continuationToken)

		if (base.resumeToken !== undefined) {
			if (!this.resumeCursors) {
				throw new QuestionSolverStoreError('result_resume_token_invalid')
			}
			this.resumeCursors.attachDelivery({
				resumeToken: base.resumeToken,
				deliveryId,
				taskId: identity.taskId,
				taskEpoch: identity.taskEpoch,
			})
		}

		if (chunks.length > 1) {
			this.results.set(continuationToken, {
				taskId: identity.taskId,
				taskEpoch: identity.taskEpoch,
				deliveryId,
				resumeToken: base.resumeToken,
				expiresAt: this.now() + QUESTION_RESULT_TTL_MS,
				chunks,
				nextChunkIndex: 1,
			})
		} else {
			this.issuedIds.delete(continuationToken)
			this.markResumeDeliveryDrained({
				taskId: identity.taskId,
				taskEpoch: identity.taskEpoch,
				deliveryId,
				resumeToken: base.resumeToken,
			})
		}

		return clone(chunks[0])
	}

	readContinuation({
		taskId,
		taskEpoch,
		continuationToken,
		action,
		scope,
	}: ContinuationRead): QuestionSolverResult {
		const result = this.results.get(continuationToken)
		if (!result || isExpired(result.expiresAt, this.now())) {
			if (result) this.deleteResult(continuationToken, result)
			throw new QuestionSolverStoreError('continuation_expired')
		}
		if (result.taskId !== taskId || result.taskEpoch !== taskEpoch) {
			throw new QuestionSolverStoreError('continuation_expired')
		}

		const chunk = result.chunks[result.nextChunkIndex]
		if ((action !== undefined && chunk.action !== action) || (scope && chunk.scope !== scope)) {
			throw new QuestionSolverStoreError('continuation_authorization_mismatch')
		}
		result.nextChunkIndex++
		if (result.nextChunkIndex === result.chunks.length) {
			this.results.delete(continuationToken)
			this.issuedIds.delete(continuationToken)
			this.markResumeDeliveryDrained(result)
		}
		return clone(chunk)
	}

	clearTask(taskId: string, taskEpoch?: number): number {
		let removed = 0
		for (const [token, result] of this.results) {
			if (result.taskId === taskId && (taskEpoch === undefined || result.taskEpoch === taskEpoch)) {
				this.deleteResult(token, result)
				removed++
			}
		}
		return removed
	}

	clearExpired(): number {
		const now = this.now()
		let removed = 0
		for (const [token, result] of this.results) {
			if (isExpired(result.expiresAt, now)) {
				this.deleteResult(token, result)
				removed++
			}
		}
		return removed
	}

	has(continuationToken: string): boolean {
		const result = this.results.get(continuationToken)
		return result !== undefined && !isExpired(result.expiresAt, this.now())
	}

	private issueId(): string {
		const token = issueToken(this.tokenFactory, (candidate) => this.issuedIds.has(candidate))
		this.issuedIds.add(token)
		return token
	}

	private deleteResult(token: string, result: StoredResult): void {
		this.results.delete(token)
		this.issuedIds.delete(token)
		this.issuedIds.delete(result.deliveryId)
	}

	private markResumeDeliveryDrained(args: {
		taskId: string
		taskEpoch: number
		deliveryId: string
		resumeToken?: string
	}): void {
		if (args.resumeToken !== undefined) {
			this.resumeCursors?.markDeliveryDrained({
				resumeToken: args.resumeToken,
				deliveryId: args.deliveryId,
				taskId: args.taskId,
				taskEpoch: args.taskEpoch,
			})
		}
		this.issuedIds.delete(args.deliveryId)
	}
}

export class ResultCapacityLedger {
	private count = 0
	private serializedBytes = 2

	canReserve(outcomeCount: number, maximumOutcomeBytes = QUESTION_OUTCOME_MAX_BYTES): boolean {
		if (!Number.isInteger(outcomeCount) || outcomeCount < 0) return false
		return (
			this.count + outcomeCount <= RESULT_STORE_MAX_OUTCOMES &&
			this.serializedBytes + outcomeCount * maximumOutcomeBytes + Math.max(0, outcomeCount - 1) <=
				RESULT_STORE_MAX_BYTES
		)
	}

	canAccept(outcome: QuestionOutcomeSummary): boolean {
		const outcomeBytes = serializedByteLength(outcome)
		return (
			outcomeBytes <= QUESTION_OUTCOME_MAX_BYTES &&
			this.count + 1 <= RESULT_STORE_MAX_OUTCOMES &&
			this.serializedBytes + outcomeBytes + (this.count === 0 ? 0 : 1) <= RESULT_STORE_MAX_BYTES
		)
	}

	accept(outcome: QuestionOutcomeSummary): boolean {
		if (!this.canAccept(outcome)) return false
		this.serializedBytes += serializedByteLength(outcome) + (this.count === 0 ? 0 : 1)
		this.count++
		return true
	}

	measure(): { outcomeCount: number; serializedBytes: number } {
		return { outcomeCount: this.count, serializedBytes: this.serializedBytes }
	}
}

function splitResult(
	base: QuestionSolverResultBase,
	questions: readonly QuestionOutcomeSummary[],
	continuationToken: string,
): QuestionSolverResult[] {
	if (questions.length === 0) {
		const only = createEnvelope(base, [], 0, 0, continuationToken)
		assertChunkSize(only)
		return [only]
	}

	const chunks: QuestionSolverResult[] = []
	let start = 0
	while (start < questions.length) {
		let accepted: QuestionSolverResult | undefined
		let end = start
		while (end < questions.length) {
			const nextEnd = end + 1
			const candidate = createEnvelope(
				base,
				questions.slice(start, nextEnd),
				chunks.length,
				questions.length - nextEnd,
				continuationToken,
			)
			if (serializedByteLength(candidate) > RESULT_CHUNK_MAX_BYTES) break
			accepted = candidate
			end = nextEnd
		}
		if (!accepted) throw new QuestionSolverStoreError('result_chunk_too_large')
		chunks.push(accepted)
		start = end
	}
	return chunks
}

function createEnvelope(
	base: QuestionSolverResultBase,
	questions: QuestionOutcomeSummary[],
	chunkIndex: number,
	remainingQuestionCount: number,
	continuationToken: string,
): QuestionSolverResult {
	const hasMore = remainingQuestionCount > 0
	return {
		...base,
		status: hasMore ? 'partial' : base.executionStatus,
		questions,
		delivery: {
			chunkIndex,
			hasMore,
			remainingQuestionCount,
			...(hasMore ? { continuationToken } : {}),
		},
	}
}

function assertPublication(
	base: QuestionSolverResultBase,
	questions: readonly QuestionOutcomeSummary[],
): void {
	assertQuestionSolverCounts(base.counts)
	if (base.counts.discovered !== questions.length) {
		throw new QuestionSolverStoreError('result_counts_mismatch')
	}
	if (base.resumeToken !== undefined && base.executionStatus !== 'partial') {
		throw new QuestionSolverStoreError('result_resume_token_invalid')
	}
	if (questions.length > RESULT_STORE_MAX_OUTCOMES) {
		throw new QuestionSolverStoreError('result_store_capacity_exceeded')
	}

	for (const outcome of questions) {
		assertQuestionOutcomeContract(base.action, outcome)
		if (outcome.adapter.platform !== base.platform) {
			throw new QuestionSolverStoreError('result_counts_mismatch')
		}
		if (serializedByteLength(outcome) > QUESTION_OUTCOME_MAX_BYTES) {
			throw new QuestionSolverStoreError('result_outcome_too_large')
		}
	}
	if (serializedByteLength(questions) > RESULT_STORE_MAX_BYTES) {
		throw new QuestionSolverStoreError('result_store_capacity_exceeded')
	}
}

function assertChunkSize(result: QuestionSolverResult): void {
	if (serializedByteLength(result) > RESULT_CHUNK_MAX_BYTES) {
		throw new QuestionSolverStoreError('result_chunk_too_large')
	}
}

function assertResumeCursorInput(input: ResumeCursorInput): void {
	if (
		!input.identity.taskId ||
		!input.identity.runId ||
		!Number.isInteger(input.identity.taskEpoch) ||
		input.identity.taskEpoch < 0 ||
		!Number.isInteger(input.targetTabId) ||
		input.targetTabId < 0 ||
		!input.managedTabLeaseId ||
		!input.platform ||
		!input.variant ||
		!input.logicalPageFingerprint ||
		!Number.isInteger(input.processedQuestionCount) ||
		input.processedQuestionCount < 0 ||
		!/^[a-f0-9]{64}$/.test(input.orderedPrefixHash)
	) {
		throw new QuestionSolverStoreError('resume_cursor_mismatch')
	}
}

function assertResumeClaimInput(input: ResumeCursorClaimInput): void {
	if (
		!input.resumeToken ||
		!input.identity.runId ||
		!Number.isInteger(input.targetTabId) ||
		input.targetTabId < 0 ||
		!input.managedTabLeaseId
	) {
		throw new QuestionSolverStoreError('resume_target_mismatch')
	}
}

function assertResumePrefix(prefix: ResumePrefixState): void {
	if (
		!prefix.platform ||
		!prefix.variant ||
		!prefix.logicalPageFingerprint ||
		!Number.isInteger(prefix.processedQuestionCount) ||
		prefix.processedQuestionCount < 0 ||
		!/^[a-f0-9]{64}$/.test(prefix.orderedPrefixHash)
	) {
		throw new QuestionSolverStoreError('resume_cursor_mismatch')
	}
}

function sameResumePrefix(cursor: StoredResumeCursor, prefix: ResumePrefixState): boolean {
	return (
		cursor.platform === prefix.platform &&
		cursor.variant === prefix.variant &&
		cursor.navigationProfileId === prefix.navigationProfileId &&
		cursor.logicalPageFingerprint === prefix.logicalPageFingerprint &&
		cursor.lastTerminalQuestionFingerprint === prefix.lastTerminalQuestionFingerprint &&
		cursor.orderedPrefixHash === prefix.orderedPrefixHash &&
		cursor.processedQuestionCount === prefix.processedQuestionCount
	)
}

function publicClaim(cursor: StoredResumeCursor): ResumeCursorClaim {
	return clone({
		identity: cursor.identity,
		action: cursor.action,
		scope: cursor.scope,
		targetTabId: cursor.targetTabId,
		managedTabLeaseId: cursor.managedTabLeaseId,
		platform: cursor.platform,
		variant: cursor.variant,
		navigationProfileId: cursor.navigationProfileId,
		logicalPageFingerprint: cursor.logicalPageFingerprint,
		lastTerminalQuestionFingerprint: cursor.lastTerminalQuestionFingerprint,
		orderedPrefixHash: cursor.orderedPrefixHash,
		processedQuestionCount: cursor.processedQuestionCount,
		resumeToken: cursor.resumeToken,
		createdAt: cursor.createdAt,
		expiresAt: cursor.expiresAt,
		claimedByRunId: cursor.claimedByRunId!,
	})
}

function issueToken(factory: () => string, exists: (token: string) => boolean): string {
	for (let attempt = 0; attempt < 16; attempt++) {
		const token = factory()
		if (token.length >= 16 && token.length <= 256 && !exists(token)) return token
	}
	throw new QuestionSolverStoreError('result_token_generation_failed')
}

function createOpaqueToken(): string {
	const bytes = new Uint8Array(24)
	globalThis.crypto.getRandomValues(bytes)
	return `qs_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

function isExpired(expiresAt: number, now: number): boolean {
	return expiresAt <= now
}

function serializedByteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function clone<T>(value: T): T {
	return structuredClone(value)
}
