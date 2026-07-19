import type { LLMConfig } from '@page-agent/llms'

import { answerQuestionWithModel, type AnswerQuestionWithModelOptions } from './answerModel'
import { delayWithAbort } from './asyncControl'
import {
	QuestionSolverBridge,
	type QuestionSolverTaskLease,
	type SolverRequestOptions,
} from './bridge'
import type {
	AdapterManifest,
	AdapterMatch,
	AdapterRef,
	ControlSnapshot,
	EmbeddedAnswerCandidate,
	FillAttempt,
	FillCommand,
	FrameRef,
	InternalImageEnvelope,
	InterruptResult,
	JsonValue,
	NavigationState,
	Question,
	QuestionOutcomeSummary,
	QuestionSolverAction,
	QuestionSolverResult,
	QuestionSolverScope,
	ReadinessResult,
	RestoreResult,
	StructuredAnswer,
	VerificationResult,
	WireAnswerPart,
	WireContentPart,
	WireQuestionView,
	WireStructuredAnswer,
} from './contracts'
import { mapEmbeddedAnswerCandidates } from './embeddedAnswers'
import { sha256Hex } from './fingerprints'
import { EphemeralImageStore } from './imageAssets'
import { createQuestionSolverAdapterRegistry } from './platforms'
import { QuestionAdapterRegistry } from './registry'
import {
	ResultCapacityLedger,
	ResultStore,
	ResumeCursorStore,
	type QuestionSolverResultBase,
	type ResumeCursorClaim,
} from './resultStore'
import { assertPublicWireBudget } from './schemas'
import { reduceExecutionStatus, summarizeQuestionOutcomes } from './stateMachine'

const GENERIC_REF: AdapterRef = {
	platform: 'generic',
	variant: 'generic.standard_html',
	version: 1,
}
const MAX_PAGES_PER_RUN = 100

export interface QuestionSolverCapabilityRequest {
	action: QuestionSolverAction
	scope: QuestionSolverScope
	continuationToken?: string
	resumeToken?: string
}

export interface QuestionSolverRunClient {
	readonly identity: { taskId: string; taskEpoch: number; runId: string }
	readonly action: QuestionSolverAction
	readonly scope: QuestionSolverScope
	readonly targetTabId: number
	discoverFrames(signal?: AbortSignal): Promise<{
		frames: FrameRef[]
		incompleteFrameIds: number[]
	}>
	request<T extends JsonValue = JsonValue>(
		target: FrameRef,
		operation: Parameters<QuestionSolverBridgeRunRequest>[1],
		options?: SolverRequestOptions,
	): Promise<T>
	cancel(
		reason?: 'user' | 'abort_signal' | 'task_replaced' | 'navigation' | 'interrupt',
	): Promise<void>
	enterCleanup(): Promise<void>
	finish(cleanupVerified: boolean): Promise<'closed' | 'quarantined'>
}

type QuestionSolverBridgeRunRequest = InstanceType<
	typeof import('./bridge').QuestionSolverRunBridge
>['request']

export interface QuestionSolverOrchestratorDeps {
	getLease: () => QuestionSolverTaskLease
	getModels: () => { text?: LLMConfig; vision?: LLMConfig }
	beginRun?: (
		lease: QuestionSolverTaskLease,
		action: QuestionSolverAction,
		scope: QuestionSolverScope,
		signal?: AbortSignal,
	) => Promise<QuestionSolverRunClient>
	answerQuestion?: typeof answerQuestionWithModel
	answerModelOptions?: Pick<AnswerQuestionWithModelOptions, 'ask' | 'fetchImpl'>
	registry?: QuestionAdapterRegistry
	imageStore?: EphemeralImageStore
	resultStore?: ResultStore
	resumeStore?: ResumeCursorStore
	capacityLedgerFactory?: () => ResultCapacityLedger
}

interface SelectedFrame {
	frame: FrameRef
	ref: AdapterRef
	profileId: AdapterMatch['navigationProfileId']
	match: AdapterMatch
}

interface StablePage {
	selected: SelectedFrame
	questions: Question[]
	readiness: ReadinessResult
	pageOrdinal: number
	candidates: EmbeddedAnswerCandidate[]
}

interface AnsweredQuestion {
	question: Question
	answer?: StructuredAnswer
	review?: { code: string; retryable: boolean; stage: 'image' | 'model' | 'embedded' }
	warnings: string[]
	ordinal: string
}

interface RunAccumulator {
	outcomes: QuestionOutcomeSummary[]
	pageFingerprints: Set<string>
	adapterPages: Map<
		string,
		{ ref: AdapterRef; maturity: AdapterManifest['maturity']; pages: number }
	>
	platform: string
	blocker?: { code: string; message: string; requiresTakeover: boolean }
	scopeExhausted: boolean
	stoppedEarly: boolean
	fatalError: boolean
	capacityStopped: boolean
	cleanupVerified: boolean
	resumeToken?: string
}

export class QuestionSolverOrchestrator {
	private readonly registry: QuestionAdapterRegistry
	private readonly imageStore: EphemeralImageStore
	private readonly resumeStore: ResumeCursorStore
	private readonly resultStore: ResultStore
	private readonly answerQuestion: typeof answerQuestionWithModel

	constructor(private readonly deps: QuestionSolverOrchestratorDeps) {
		this.registry = deps.registry ?? createQuestionSolverAdapterRegistry()
		this.imageStore = deps.imageStore ?? new EphemeralImageStore()
		this.resumeStore = deps.resumeStore ?? new ResumeCursorStore()
		this.resultStore = deps.resultStore ?? new ResultStore(this.resumeStore)
		this.answerQuestion = deps.answerQuestion ?? answerQuestionWithModel
	}

	async execute(
		capability: QuestionSolverCapabilityRequest,
		signal: AbortSignal = new AbortController().signal,
	): Promise<QuestionSolverResult> {
		const lease = this.deps.getLease()
		if (capability.continuationToken) {
			const continuation = this.resultStore.readContinuation({
				taskId: lease.taskId,
				taskEpoch: lease.taskEpoch,
				continuationToken: capability.continuationToken,
				action: capability.action,
				scope: capability.scope,
			})
			assertPublicWireBudget(continuation)
			return continuation
		}
		const run = await this.beginRun(lease, capability.action, capability.scope, signal)
		const accumulator: RunAccumulator = {
			outcomes: [],
			pageFingerprints: new Set(),
			adapterPages: new Map(),
			platform: 'unknown',
			scopeExhausted: false,
			stoppedEarly: false,
			fatalError: false,
			capacityStopped: false,
			cleanupVerified: true,
		}
		const capacity = this.deps.capacityLedgerFactory?.() ?? new ResultCapacityLedger()
		const managedTabLeaseId = await managedLeaseDigest(lease)
		let resumeClaim: ResumeCursorClaim | undefined
		let resumeConsumed = false
		try {
			if (capability.resumeToken) {
				resumeClaim = this.resumeStore.claim({
					resumeToken: capability.resumeToken,
					identity: run.identity,
					action: capability.action,
					scope: capability.scope,
					targetTabId: lease.targetTabId,
					managedTabLeaseId,
				})
			}
			await this.executeRun(
				run,
				capability,
				accumulator,
				capacity,
				signal,
				managedTabLeaseId,
				resumeClaim,
				() => {
					resumeConsumed = true
				},
			)
		} catch (error) {
			if (signal.aborted || isAbortError(error)) {
				accumulator.stoppedEarly = true
				try {
					await run.cancel('abort_signal')
					await run.enterCleanup()
				} catch {
					accumulator.cleanupVerified = false
				}
			} else {
				accumulator.fatalError = true
				accumulator.stoppedEarly = true
				if (accumulator.outcomes.length === 0 && !accumulator.blocker) {
					accumulator.blocker = blocker('solver_runtime_failed', false)
				}
			}
		} finally {
			if (resumeClaim && !resumeConsumed && capability.resumeToken) {
				this.resumeStore.release({
					resumeToken: capability.resumeToken,
					identity: run.identity,
				})
			}
			this.imageStore.releaseRun(run.identity.runId)
			try {
				const lifecycle = await run.finish(accumulator.cleanupVerified)
				if (lifecycle === 'quarantined') accumulator.cleanupVerified = false
			} catch {
				accumulator.cleanupVerified = false
				accumulator.stoppedEarly = true
			}
		}

		const executionStatus = reduceExecutionStatus({
			scopeExhausted: accumulator.scopeExhausted,
			stablePageCount: accumulator.pageFingerprints.size,
			discoveredQuestionCount: accumulator.outcomes.length,
			terminalOutcomeCount: accumulator.outcomes.length,
			hasUnresolvedTakeoverBlocker: accumulator.blocker?.requiresTakeover === true,
			cancelled: signal.aborted,
			stoppedEarly: accumulator.stoppedEarly,
			fatalError: accumulator.fatalError,
			capacityStopped: accumulator.capacityStopped,
		})
		const base: QuestionSolverResultBase = {
			mode: 'capability',
			capability: 'question_solver',
			action: capability.action,
			scope: capability.scope,
			executionStatus,
			platform: accumulator.platform,
			adapters: [...accumulator.adapterPages.values()],
			counts: summarizeQuestionOutcomes(accumulator.outcomes, accumulator.pageFingerprints.size),
			blocker: accumulator.blocker,
			resumeToken: accumulator.resumeToken,
			finalSubmissionPerformed: false,
		}
		const result = this.resultStore.publish({
			identity: run.identity,
			base,
			questions: accumulator.outcomes,
		})
		assertPublicWireBudget(result)
		return result
	}

	private beginRun(
		lease: QuestionSolverTaskLease,
		action: QuestionSolverAction,
		scope: QuestionSolverScope,
		signal: AbortSignal,
	): Promise<QuestionSolverRunClient> {
		if (this.deps.beginRun) return this.deps.beginRun(lease, action, scope, signal)
		return new QuestionSolverBridge(lease).begin(action, scope, signal)
	}

	private async executeRun(
		run: QuestionSolverRunClient,
		capability: QuestionSolverCapabilityRequest,
		accumulator: RunAccumulator,
		capacity: ResultCapacityLedger,
		signal: AbortSignal,
		managedTabLeaseId: string,
		resumeClaim: ResumeCursorClaim | undefined,
		onResumeConsumed: () => void,
	): Promise<void> {
		let pendingResume = resumeClaim
		for (let iteration = 0; iteration < MAX_PAGES_PER_RUN; iteration++) {
			signal.throwIfAborted()
			const discovery = await run.discoverFrames(signal)
			const selected = await this.probeFrames(run, discovery.frames, signal)
			if (selected.length === 0) {
				accumulator.fatalError = accumulator.outcomes.length === 0
				accumulator.stoppedEarly = true
				accumulator.blocker = blocker('assessment_not_detected', false)
				return
			}
			const platforms = new Set(selected.map((entry) => entry.ref.platform))
			if (platforms.size !== 1) {
				accumulator.stoppedEarly = true
				accumulator.blocker = blocker('multiple_platforms_detected', false)
				return
			}
			const platform = selected[0].ref.platform
			if (accumulator.platform === 'unknown') accumulator.platform = platform
			if (accumulator.platform !== platform) {
				accumulator.stoppedEarly = true
				accumulator.blocker = blocker('platform_changed_during_navigation', false)
				return
			}

			const interrupt = await this.scanInterrupts(run, discovery.frames, selected, signal)
			if (interrupt.blocked) {
				accumulator.blocker = blocker(`protected_${interrupt.kind ?? 'interrupt'}`, true)
				return
			}
			if (capability.action === 'fill' && discovery.incompleteFrameIds.length > 0) {
				accumulator.blocker = blocker('interrupt_scan_incomplete', true)
				return
			}

			const pages: StablePage[] = []
			for (const target of selected) {
				const page = await this.readStablePage(run, target, capability, signal)
				if (!page) continue
				const logical = page.readiness.logicalPageFingerprint!
				if (accumulator.pageFingerprints.has(logical)) {
					accumulator.stoppedEarly = true
					accumulator.blocker = blocker('page_cycle_detected', false)
					return
				}
				accumulator.pageFingerprints.add(logical)
				page.pageOrdinal = accumulator.pageFingerprints.size
				pages.push(page)
				this.recordAdapterPage(accumulator, target.ref)
			}
			if (pages.length === 0) {
				accumulator.stoppedEarly = true
				accumulator.fatalError = accumulator.outcomes.length === 0
				accumulator.blocker = blocker('stable_question_page_unavailable', false)
				return
			}
			if (pendingResume) {
				const resumePage = pages.find(
					(page) =>
						page.readiness.logicalPageFingerprint === pendingResume!.logicalPageFingerprint &&
						page.selected.ref.platform === pendingResume!.platform &&
						page.selected.ref.variant === pendingResume!.variant &&
						page.selected.profileId === pendingResume!.navigationProfileId,
				)
				if (!resumePage) throw new Error('resume_cursor_mismatch')
				const processed = pendingResume.processedQuestionCount
				const prefix = resumePage.questions
					.slice(0, processed)
					.map((question) => question.locator.fingerprint)
				const prefixState = {
					platform: resumePage.selected.ref.platform,
					variant: resumePage.selected.ref.variant,
					navigationProfileId: resumePage.selected.profileId,
					logicalPageFingerprint: resumePage.readiness.logicalPageFingerprint!,
					lastTerminalQuestionFingerprint: prefix.at(-1),
					orderedPrefixHash: await orderedPrefixHash(prefix),
					processedQuestionCount: processed,
				}
				this.resumeStore.validateClaim({
					resumeToken: pendingResume.resumeToken,
					identity: run.identity,
					prefix: prefixState,
				})
				this.resumeStore.consume({
					resumeToken: pendingResume.resumeToken,
					identity: run.identity,
					prefix: prefixState,
				})
				onResumeConsumed()
				resumePage.questions = resumePage.questions.slice(processed)
				pages.splice(0, pages.length, resumePage)
				pendingResume = undefined
			}

			for (const page of pages) {
				if (!capacity.canReserve(page.questions.length)) {
					accumulator.capacityStopped = true
					accumulator.stoppedEarly = true
					accumulator.blocker = blocker('result_store_capacity_reached', false)
					accumulator.resumeToken = this.resumeStore.create({
						identity: run.identity,
						action: capability.action,
						scope: capability.scope,
						targetTabId: run.targetTabId,
						managedTabLeaseId,
						platform: page.selected.ref.platform,
						variant: page.selected.ref.variant,
						navigationProfileId: page.selected.profileId,
						logicalPageFingerprint: page.readiness.logicalPageFingerprint!,
						orderedPrefixHash: await orderedPrefixHash([]),
						processedQuestionCount: 0,
					})
					return
				}
				const produced = await this.processPage(run, page, capability, discovery, selected, signal)
				for (const outcome of produced) {
					if (outcome.status === 'filled_unverified') accumulator.cleanupVerified = false
					if (!capacity.accept(outcome)) {
						accumulator.capacityStopped = true
						accumulator.stoppedEarly = true
						accumulator.blocker = blocker('result_store_capacity_reached', false)
						return
					}
					accumulator.outcomes.push(outcome)
				}
			}

			if (capability.scope !== 'all_pages') {
				accumulator.scopeExhausted = true
				return
			}
			const navigation = await this.chooseNavigation(run, pages, capability.action, signal)
			if (!navigation) {
				accumulator.scopeExhausted = true
				return
			}
			if ('code' in navigation) {
				accumulator.stoppedEarly = true
				accumulator.blocker = blocker(navigation.code, false)
				return
			}
			const preNavigationInterrupt = await this.scanInterrupts(
				run,
				discovery.frames,
				selected,
				signal,
			)
			if (preNavigationInterrupt.blocked) {
				accumulator.blocker = blocker(
					`protected_${preNavigationInterrupt.kind ?? 'interrupt'}`,
					true,
				)
				return
			}
			await run.request(navigation.page.selected.frame, 'next', {
				adapter: navigation.page.selected.ref,
				payload: {
					authorization: capability.action === 'fill' ? 'after_fill' : 'read_only',
					before: navigation.page.readiness.logicalPageFingerprint!,
				},
				signal,
			})
			await delay(100, signal)
		}
		accumulator.stoppedEarly = true
		accumulator.blocker = blocker('page_limit_reached', false)
	}

	private async probeFrames(
		run: QuestionSolverRunClient,
		frames: FrameRef[],
		signal: AbortSignal,
	): Promise<SelectedFrame[]> {
		const selected: SelectedFrame[] = []
		for (const frame of frames) {
			try {
				const value = asRecord(await run.request(frame, 'probe', { signal }))
				if (value.ambiguous === true) continue
				const match = value.selected as unknown as AdapterMatch | undefined
				if (!match || !isAdapterRef(match.ref)) continue
				this.registry.require(match.ref)
				selected.push({ frame, ref: match.ref, profileId: match.navigationProfileId, match })
			} catch {
				// An inaccessible frame is represented by discovery.incompleteFrameIds and handled by policy.
			}
		}
		return selected.sort((left, right) => left.frame.frameId - right.frame.frameId)
	}

	private async scanInterrupts(
		run: QuestionSolverRunClient,
		frames: FrameRef[],
		selected: SelectedFrame[],
		signal: AbortSignal,
	): Promise<InterruptResult> {
		const refs = new Map(selected.map((entry) => [entry.frame.frameId, entry.ref]))
		for (const frame of frames) {
			try {
				const result = (await run.request(frame, 'interrupts', {
					adapter: refs.get(frame.frameId) ?? GENERIC_REF,
					signal,
				})) as unknown as InterruptResult
				if (result.blocked) return result
			} catch {
				return { blocked: true, kind: 'permission', evidenceCodes: ['interrupt_scan_failed'] }
			}
		}
		return { blocked: false, evidenceCodes: [] }
	}

	private async readStablePage(
		run: QuestionSolverRunClient,
		selected: SelectedFrame,
		capability: QuestionSolverCapabilityRequest,
		signal: AbortSignal,
	): Promise<StablePage | null> {
		const adapter = this.registry.require(selected.ref)
		let armed = false
		if (capability.action !== 'inspect' && adapter.manifest.embedded.passive) {
			await run.request(selected.frame, 'embedded_arm', {
				adapter: selected.ref,
				payload: { transactionId: crypto.randomUUID() },
				signal,
			})
			armed = true
		}
		try {
			const questions = (await run.request(selected.frame, 'extract', {
				adapter: selected.ref,
				signal,
			})) as unknown as Question[]
			if (!Array.isArray(questions) || questions.length === 0) return null
			const readiness = (await run.request(selected.frame, 'ready', {
				adapter: selected.ref,
				signal,
			})) as unknown as ReadinessResult
			if (!readiness.ready || !readiness.logicalPageFingerprint || !readiness.bindingFingerprint) {
				return null
			}
			let candidates: EmbeddedAnswerCandidate[] = []
			if (capability.action !== 'inspect') {
				const value = await run.request(selected.frame, 'embedded_read', {
					adapter: selected.ref,
					payload: { questions: questions as unknown as JsonValue },
					signal,
				})
				if (Array.isArray(value)) candidates = value as unknown as EmbeddedAnswerCandidate[]
			}
			return { selected, questions, readiness, pageOrdinal: 0, candidates }
		} finally {
			if (armed) {
				await run.request(selected.frame, 'embedded_disarm', {
					adapter: selected.ref,
					phase: 'cleanup',
					payload: { transactionId: crypto.randomUUID() },
				})
			}
		}
	}

	private async processPage(
		run: QuestionSolverRunClient,
		page: StablePage,
		capability: QuestionSolverCapabilityRequest,
		discovery: { frames: FrameRef[]; incompleteFrameIds: number[] },
		selected: SelectedFrame[],
		signal: AbortSignal,
	): Promise<QuestionOutcomeSummary[]> {
		if (capability.action === 'inspect') {
			return page.questions.map((question, index) =>
				fitOutcome({
					adapter: page.selected.ref,
					questionFingerprint: question.locator.fingerprint,
					pageOrdinal: page.pageOrdinal,
					questionOrdinal: String(index + 1),
					type: question.type,
					status: 'inspected',
					question: toWireQuestion(question),
					pageEffect: 'none',
					warningCodes: sanitizeWarnings(question.extractionWarnings),
				}),
			)
		}

		const adapter = this.registry.require(page.selected.ref)
		const answered: AnsweredQuestion[] = []
		for (const [index, sourceQuestion] of page.questions.entries()) {
			signal.throwIfAborted()
			if (index > 0 && adapter.manifest.questionDelayMs > 0) {
				await delay(adapter.manifest.questionDelayMs, signal)
			}
			answered.push(
				await this.resolveQuestion(run, page, sourceQuestion, String(index + 1), signal),
			)
		}

		if (capability.action === 'answer') {
			return answered.map((entry) => this.answerOutcome(page, entry))
		}

		const immediate: QuestionOutcomeSummary[] = []
		const fillable: Array<AnsweredQuestion & { answer: StructuredAnswer }> = []
		for (const entry of answered) {
			if (!entry.answer) {
				immediate.push(this.answerOutcome(page, entry))
				continue
			}
			if (adapter.manifest.typeSupport[entry.question.type] !== 'inspect_answer_fill') {
				immediate.push(
					fitOutcome({
						...answeredBase(page, entry),
						status: 'answered_notFilled',
						answer: toWireAnswer(entry.answer),
						evidence: toWireEvidence(entry.answer),
						pageEffect: 'none',
						problem: problem('fill_not_supported_for_question_type', 'fill', false),
					}),
				)
				continue
			}
			fillable.push(entry as AnsweredQuestion & { answer: StructuredAnswer })
		}
		if (fillable.length === 0) return immediate

		const interrupt = await this.scanInterrupts(run, discovery.frames, selected, signal)
		if (interrupt.blocked || discovery.incompleteFrameIds.length > 0) {
			const code = interrupt.blocked
				? `protected_${interrupt.kind ?? 'interrupt'}`
				: 'interrupt_scan_incomplete'
			return [
				...immediate,
				...fillable.map((entry) =>
					fitOutcome({
						...answeredBase(page, entry),
						status: 'answered_notFilled',
						answer: toWireAnswer(entry.answer),
						evidence: toWireEvidence(entry.answer),
						pageEffect: 'none',
						problem: problem(code, 'interrupt', false),
					}),
				),
			]
		}

		const commands: FillCommand[] = fillable.map((entry) => ({
			locator: entry.question.locator,
			expectedLogicalPageFingerprint: page.readiness.logicalPageFingerprint!,
			expectedBindingFingerprint: page.readiness.bindingFingerprint!,
			answer: entry.answer,
		}))
		return [...immediate, ...(await this.fillTransaction(run, page, fillable, commands, signal))]
	}

	private async resolveQuestion(
		run: QuestionSolverRunClient,
		page: StablePage,
		sourceQuestion: Question,
		ordinal: string,
		signal: AbortSignal,
	): Promise<AnsweredQuestion> {
		const embedded = mapEmbeddedAnswerCandidates(sourceQuestion, page.candidates)
		if (embedded.status === 'accepted') {
			if (!isAnswerRepresentable(embedded.answer)) {
				return {
					question: sourceQuestion,
					review: { code: 'result_too_large', retryable: false, stage: 'model' },
					warnings: sanitizeWarnings([
						...sourceQuestion.extractionWarnings,
						...embedded.warningCodes,
					]),
					ordinal,
				}
			}
			return {
				question: sourceQuestion,
				answer: embedded.answer,
				warnings: sanitizeWarnings([
					...sourceQuestion.extractionWarnings,
					...embedded.warningCodes,
				]),
				ordinal,
			}
		}
		let question = structuredClone(sourceQuestion)
		try {
			try {
				question = await this.resolveQuestionImages(run, page, question, signal)
			} catch {
				return {
					question,
					review: { code: 'required_visual_unavailable', retryable: false, stage: 'image' },
					warnings: sanitizeWarnings([
						...question.extractionWarnings,
						...embedded.warningCodes,
						'image_resolution_failed',
					]),
					ordinal,
				}
			}
			const resolution = await this.answerQuestion(question, {
				models: this.deps.getModels(),
				signal,
				resolveImageAsset: (asset) =>
					Promise.resolve(
						this.imageStore.resolveProviderDataUrl(asset, {
							runId: run.identity.runId,
							questionFingerprint: asset.questionFingerprint,
						}),
					),
				...this.deps.answerModelOptions,
			})
			if (resolution.status === 'review') {
				return {
					question,
					review: { code: resolution.code, retryable: resolution.retryable, stage: 'model' },
					warnings: sanitizeWarnings([...question.extractionWarnings, ...embedded.warningCodes]),
					ordinal,
				}
			}
			if (!isAnswerRepresentable(resolution.answer)) {
				return {
					question,
					review: { code: 'result_too_large', retryable: false, stage: 'model' },
					warnings: sanitizeWarnings([...question.extractionWarnings, ...embedded.warningCodes]),
					ordinal,
				}
			}
			resolution.answer.evidence.warnings = sanitizeWarnings([
				...resolution.answer.evidence.warnings,
				...embedded.warningCodes,
			])
			return {
				question,
				answer: resolution.answer,
				warnings: sanitizeWarnings([...question.extractionWarnings, ...embedded.warningCodes]),
				ordinal,
			}
		} finally {
			releaseQuestionImageTree(this.imageStore, run.identity.runId, question)
		}
	}

	private async resolveQuestionImages(
		run: QuestionSolverRunClient,
		page: StablePage,
		question: Question,
		signal: AbortSignal,
	): Promise<Question> {
		for (const [owner, part] of imageParts(question)) {
			const value = asRecord(
				await run.request(page.selected.frame, 'image_resolve', {
					adapter: page.selected.ref,
					payload: {
						locator: owner.locator as unknown as JsonValue,
						expectedBindingFingerprint: page.readiness.bindingFingerprint!,
						anchorKey: part.anchorKey,
						policy: 'inline_then_bound_crop',
					},
					signal,
				}),
			)
			if (value.kind !== 'resolved' || !isRecord(value.envelope)) {
				if (part.requiredForAnswer) throw new Error('required_visual_unavailable')
				continue
			}
			part.asset = await this.imageStore.admit(value.envelope as unknown as InternalImageEnvelope, {
				runId: run.identity.runId,
				questionFingerprint: owner.locator.fingerprint,
				anchorKey: part.anchorKey,
			})
			part.contentHash = part.asset.sha256
			part.resolution = value.resolution === 'screenshot' ? 'screenshot' : 'inline'
		}
		return question
	}

	private answerOutcome(page: StablePage, entry: AnsweredQuestion): QuestionOutcomeSummary {
		if (!entry.answer) {
			return fitOutcome({
				...answeredBase(page, entry),
				status: 'needsReview_notFilled',
				pageEffect: 'none',
				problem: problem(
					entry.review?.code ?? 'answer_unavailable',
					entry.review?.stage ?? 'model',
					entry.review?.retryable ?? false,
				),
			})
		}
		return fitOutcome({
			...answeredBase(page, entry),
			status: 'answered_notFilled',
			answer: toWireAnswer(entry.answer),
			evidence: toWireEvidence(entry.answer),
			pageEffect: 'none',
		})
	}

	private async fillTransaction(
		run: QuestionSolverRunClient,
		page: StablePage,
		fillable: Array<AnsweredQuestion & { answer: StructuredAnswer }>,
		commands: FillCommand[],
		signal: AbortSignal,
	): Promise<QuestionOutcomeSummary[]> {
		let snapshot: ControlSnapshot | undefined
		let transaction: {
			transactionId: string
			snapshotDigestVersion: 1
			snapshotDigest: string
		} | null = null
		try {
			snapshot = (await run.request(page.selected.frame, 'state_capture', {
				adapter: page.selected.ref,
				payload: { commands: commands as unknown as JsonValue },
				signal,
			})) as unknown as ControlSnapshot
			transaction = {
				transactionId: snapshot.transactionId,
				snapshotDigestVersion: 1,
				snapshotDigest: snapshot.snapshotDigest,
			}
			const attempts = (await run.request(page.selected.frame, 'fill', {
				adapter: page.selected.ref,
				payload: { transaction, commands: commands as unknown as JsonValue },
				signal,
			})) as unknown as FillAttempt[]
			let verification = (await run.request(page.selected.frame, 'verify', {
				adapter: page.selected.ref,
				payload: { transaction, commands: commands as unknown as JsonValue },
				signal,
			})) as unknown as VerificationResult[]
			if (!hasExactVerificationCoverage(commands, verification, false)) {
				return await this.restoreFailedFill(
					run,
					page,
					fillable,
					transaction,
					snapshot,
					'verify_result_mismatch',
				)
			}
			const mismatched = new Set(
				verification
					.filter((result) => result.dom !== 'matched')
					.map((result) => result.questionFingerprint),
			)
			if (mismatched.size > 0) {
				const retryCommands = commands.filter((command) =>
					mismatched.has(command.locator.fingerprint),
				)
				await run.request(page.selected.frame, 'fill', {
					adapter: page.selected.ref,
					payload: { transaction, commands: retryCommands as unknown as JsonValue },
					signal,
					laneKey: `page:${page.readiness.logicalPageFingerprint}:repair`,
				})
				const retried = (await run.request(page.selected.frame, 'verify', {
					adapter: page.selected.ref,
					payload: { transaction, commands: retryCommands as unknown as JsonValue },
					signal,
					laneKey: `page:${page.readiness.logicalPageFingerprint}:verify`,
				})) as unknown as VerificationResult[]
				if (!hasExactVerificationCoverage(retryCommands, retried, false)) {
					return await this.restoreFailedFill(
						run,
						page,
						fillable,
						transaction,
						snapshot,
						'verify_result_mismatch',
					)
				}
				const byFingerprint = new Map(
					verification.map((result) => [result.questionFingerprint, result]),
				)
				for (const result of retried) byFingerprint.set(result.questionFingerprint, result)
				verification = [...byFingerprint.values()]
			}
			if (hasExactVerificationCoverage(commands, verification, true)) {
				const attemptsByQuestion = new Map(
					attempts.map((attempt) => [attempt.questionFingerprint, attempt]),
				)
				return fillable.map((entry) =>
					fitOutcome({
						...answeredBase(page, entry),
						status: 'filled_verified',
						answer: toWireAnswer(entry.answer),
						evidence: toWireEvidence(entry.answer),
						pageEffect:
							attemptsByQuestion.get(entry.question.locator.fingerprint)?.result === 'already_exact'
								? 'already_exact'
								: 'written_and_verified',
					}),
				)
			}
			return await this.restoreFailedFill(
				run,
				page,
				fillable,
				transaction,
				snapshot,
				'verify_mismatch',
			)
		} catch {
			if (snapshot && transaction) {
				return this.restoreFailedFill(
					run,
					page,
					fillable,
					transaction,
					snapshot,
					'fill_operation_failed',
				)
			}
			return fillable.map((entry) =>
				fitOutcome({
					...answeredBase(page, entry),
					status: 'answered_notFilled',
					answer: toWireAnswer(entry.answer),
					evidence: toWireEvidence(entry.answer),
					pageEffect: 'none',
					problem: problem('control_snapshot_failed', 'fill', true),
				}),
			)
		}
	}

	private async restoreFailedFill(
		run: QuestionSolverRunClient,
		page: StablePage,
		fillable: Array<AnsweredQuestion & { answer: StructuredAnswer }>,
		transaction: { transactionId: string; snapshotDigestVersion: 1; snapshotDigest: string },
		snapshot: ControlSnapshot,
		code: string,
	): Promise<QuestionOutcomeSummary[]> {
		let restore: RestoreResult | undefined
		try {
			restore = (await run.request(page.selected.frame, 'state_restore', {
				adapter: page.selected.ref,
				phase: 'cleanup',
				payload: {
					transaction,
					snapshot: snapshot as unknown as JsonValue,
				},
			})) as unknown as RestoreResult
		} catch {
			restore = undefined
		}
		const restored = restore?.restored === true && restore.verified === true
		return fillable.map((entry) =>
			fitOutcome({
				...answeredBase(page, entry),
				status: restored ? 'fill_failed' : 'filled_unverified',
				answer: toWireAnswer(entry.answer),
				evidence: toWireEvidence(entry.answer),
				pageEffect: restored ? 'restored' : 'possibly_modified',
				problem: problem(restored ? code : 'restore_unverified', 'verify', false),
			}),
		)
	}

	private async chooseNavigation(
		run: QuestionSolverRunClient,
		pages: StablePage[],
		action: QuestionSolverAction,
		signal: AbortSignal,
	): Promise<{ page: StablePage; state: NavigationState } | { code: string } | null> {
		const candidates: Array<{ page: StablePage; state: NavigationState }> = []
		for (const page of pages) {
			const state = (await run.request(page.selected.frame, 'navigation', {
				adapter: page.selected.ref,
				signal,
			})) as unknown as NavigationState
			if (state.hasNext) candidates.push({ page, state })
		}
		if (candidates.length === 0) return null
		if (candidates.length > 1) return { code: 'multiple_navigation_owners' }
		const selected = candidates[0]
		const requiredMode = action === 'fill' ? 'after_fill' : 'read_only'
		if (selected.state.mode !== requiredMode) return { code: 'navigation_not_authorized' }
		return selected
	}

	private recordAdapterPage(accumulator: RunAccumulator, ref: AdapterRef): void {
		const key = `${ref.variant}@${ref.version}`
		const current = accumulator.adapterPages.get(key)
		if (current) {
			current.pages++
			return
		}
		const adapter = this.registry.require(ref)
		accumulator.adapterPages.set(key, {
			ref,
			maturity: adapter.manifest.maturity,
			pages: 1,
		})
	}
}

function hasExactVerificationCoverage(
	commands: readonly FillCommand[],
	verification: readonly VerificationResult[],
	requireMatched: boolean,
): boolean {
	if (verification.length !== commands.length) return false
	const expected = new Set(commands.map((command) => command.locator.fingerprint))
	if (expected.size !== commands.length) return false
	const seen = new Set<string>()
	for (const result of verification) {
		if (!expected.has(result.questionFingerprint) || seen.has(result.questionFingerprint))
			return false
		if (requireMatched && result.dom !== 'matched') return false
		seen.add(result.questionFingerprint)
	}
	return seen.size === expected.size
}

function answeredBase(page: StablePage, entry: AnsweredQuestion) {
	return {
		adapter: page.selected.ref,
		questionFingerprint: entry.question.locator.fingerprint,
		pageOrdinal: page.pageOrdinal,
		questionOrdinal: entry.ordinal,
		type: entry.question.type,
		question: toWireQuestion(entry.question),
		warningCodes: entry.warnings,
	}
}

function toWireQuestion(question: Question): WireQuestionView {
	return {
		stem: toWireParts(question.stem),
		material: question.material ? toWireParts(question.material) : undefined,
		options: question.options.slice(0, 32).map((option) => ({
			key: truncate(option.key, 100).text,
			content: toWireParts(option.content),
		})),
		blankKeys: question.blanks?.slice(0, 64).map((blank) => truncate(blank.key, 100).text),
		subQuestionPaths: flattenQuestionPaths(question).slice(0, 64),
	}
}

function toWireParts(parts: Question['stem']): WireContentPart[] {
	return parts.slice(0, 32).map((part) => {
		if (part.type === 'text') {
			const value = truncate(part.text, 1_000)
			return { kind: 'text', text: value.text, truncated: value.truncated }
		}
		return {
			kind: 'image',
			label: truncate(part.label, 300).text,
			resolution: part.resolution,
			requiredForAnswer: part.requiredForAnswer,
		}
	})
}

function toWireAnswer(answer: StructuredAnswer): WireStructuredAnswer {
	const parts: WireAnswerPart[] = []
	appendAnswer(answer, 'root', parts)
	return { parts }
}

function isAnswerRepresentable(answer: StructuredAnswer): boolean {
	return byteLength(toWireAnswer(answer)) <= 6 * 1024
}

function appendAnswer(answer: StructuredAnswer, path: string, parts: WireAnswerPart[]): void {
	if (answer.selectedOptions) {
		parts.push({ kind: 'choice', questionPath: path, selectedOptionKeys: answer.selectedOptions })
	}
	if (answer.blanks) {
		parts.push({
			kind: 'text',
			questionPath: path,
			values: answer.blanks.map((blank) => ({ blankKey: blank.key, value: blank.value })),
		})
	}
	if (answer.dropdowns) {
		parts.push({
			kind: 'dropdown',
			questionPath: path,
			values: answer.dropdowns.map((entry) => ({
				blankKey: entry.key,
				optionKey: entry.optionKey,
			})),
		})
	}
	if (answer.linePairs) {
		parts.push({ kind: 'line', questionPath: path, pairs: answer.linePairs })
	}
	for (const [index, subAnswer] of (answer.subAnswers ?? []).entries()) {
		appendAnswer(subAnswer, path === 'root' ? `sub/${index}` : `${path}/sub/${index}`, parts)
	}
}

function toWireEvidence(answer: StructuredAnswer) {
	return {
		source: answer.evidence.source,
		sourceRefHash: answer.evidence.sourceRefHash,
		mappingConfidence: answer.evidence.mappingConfidence,
		modelConfidence: answer.evidence.modelConfidence,
		warningCodes: sanitizeWarnings(answer.evidence.warnings),
	}
}

function imageParts(
	question: Question,
): Array<[Question, Extract<Question['stem'][number], { type: 'image' }>]> {
	const result: Array<[Question, Extract<Question['stem'][number], { type: 'image' }>]> = []
	visit(question)
	return result

	function visit(owner: Question): void {
		for (const part of [...owner.stem, ...(owner.material ?? [])]) {
			if (part.type === 'image') result.push([owner, part])
		}
		for (const option of owner.options) {
			for (const part of option.content) if (part.type === 'image') result.push([owner, part])
		}
		for (const sub of owner.subQuestions ?? []) visit(sub)
	}
}

function releaseQuestionImageTree(
	store: EphemeralImageStore,
	runId: string,
	question: Question,
): void {
	const fingerprints = new Set(imageParts(question).map(([owner]) => owner.locator.fingerprint))
	for (const fingerprint of fingerprints) store.releaseQuestion(runId, fingerprint)
}

function flattenQuestionPaths(question: Question, path = 'root'): string[] {
	const paths: string[] = []
	for (const [index, sub] of (question.subQuestions ?? []).entries()) {
		const subPath = path === 'root' ? `sub/${index}` : `${path}/sub/${index}`
		paths.push(subPath, ...flattenQuestionPaths(sub, subPath))
	}
	return paths
}

function fitOutcome(outcome: QuestionOutcomeSummary): QuestionOutcomeSummary {
	if (byteLength(outcome) <= 8 * 1024) return outcome
	const compact: QuestionOutcomeSummary = {
		...outcome,
		question: {
			stem: compactParts(outcome.question.stem, 4),
			material: outcome.question.material ? compactParts(outcome.question.material, 2) : undefined,
			options: outcome.question.options.slice(0, 32).map((option) => ({
				key: option.key,
				content: compactParts(option.content, 2),
			})),
			blankKeys: outcome.question.blankKeys,
			subQuestionPaths: outcome.question.subQuestionPaths,
		},
		warningCodes: sanitizeWarnings([...outcome.warningCodes, 'question_view_compacted']),
	}
	if (byteLength(compact) <= 8 * 1024) return compact
	compact.question.options = compact.question.options.map((option) => ({
		key: option.key,
		content: [],
	}))
	compact.question.stem = compactParts(compact.question.stem, 1)
	compact.question.material = undefined
	return compact
}

function compactParts(parts: WireContentPart[], maximum: number): WireContentPart[] {
	return parts
		.slice(0, maximum)
		.map((part) =>
			part.kind === 'text'
				? { ...part, ...truncate(part.text, 160), truncated: true }
				: { ...part, label: truncate(part.label, 120).text },
		)
}

function problem(
	code: string,
	stage: NonNullable<QuestionOutcomeSummary['problem']>['stage'],
	retryable: boolean,
): NonNullable<QuestionOutcomeSummary['problem']> {
	return {
		code,
		stage,
		message: safeProblemMessage(code),
		retryable,
		requiresReview: true,
	}
}

function blocker(code: string, requiresTakeover: boolean) {
	return { code, message: safeProblemMessage(code), requiresTakeover }
}

function safeProblemMessage(code: string): string {
	const messages: Record<string, string> = {
		assessment_not_detected: 'No supported assessment surface was detected in the managed tab.',
		multiple_platforms_detected: 'Multiple assessment platforms were detected in one run.',
		platform_changed_during_navigation: 'The assessment platform changed after navigation.',
		interrupt_scan_incomplete: 'Not every reachable frame could be checked before a page write.',
		page_cycle_detected: 'Navigation returned to a previously processed logical page.',
		stable_question_page_unavailable: 'The question page did not reach a stable readable state.',
		multiple_navigation_owners: 'More than one frame claimed ownership of next-page navigation.',
		navigation_not_authorized:
			'The adapter cannot advance pages without an unauthorized save effect.',
		page_limit_reached: 'The run stopped at the configured page safety limit.',
		result_store_capacity_reached: 'The run reached its safe result capacity.',
		fill_not_supported_for_question_type:
			'This question type can be answered but not safely filled.',
		control_snapshot_failed: 'The pre-write control snapshot could not be established.',
		verify_mismatch: 'The written value did not verify and the original state was restored.',
		fill_operation_failed: 'The page write failed and the original state was restored.',
		restore_unverified: 'The original page state could not be verified after a failed write.',
		required_visual_unavailable: 'A required question image could not be bound to this question.',
		answer_unavailable: 'No sufficiently reliable answer was available.',
		solver_runtime_failed: 'The question solver stopped because an internal invariant failed.',
	}
	if (code.startsWith('protected_')) {
		return 'A protected login or verification interruption requires manual takeover.'
	}
	return messages[code] ?? 'The question requires review before any page change.'
}

function sanitizeWarnings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => truncate(value, 200).text).filter(Boolean))].slice(0, 32)
}

function truncate(value: string, maximum: number): { text: string; truncated: boolean } {
	return value.length <= maximum
		? { text: value, truncated: false }
		: { text: value.slice(0, maximum), truncated: true }
}

function isAdapterRef(value: unknown): value is AdapterRef {
	return (
		isRecord(value) &&
		typeof value.platform === 'string' &&
		typeof value.variant === 'string' &&
		Number.isInteger(value.version)
	)
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function managedLeaseDigest(lease: QuestionSolverTaskLease): Promise<string> {
	return sha256Hex(
		`${lease.taskId}\0${lease.taskEpoch}\0${lease.leaseToken}\0${[...lease.managedTabIds]
			.sort((left, right) => left - right)
			.join(',')}\0${lease.targetTabId}`,
	)
}

function orderedPrefixHash(fingerprints: readonly string[]): Promise<string> {
	return sha256Hex(`wenxue-question-prefix-v1\0${fingerprints.join('\0')}`)
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError'
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return delayWithAbort(ms, signal)
}
