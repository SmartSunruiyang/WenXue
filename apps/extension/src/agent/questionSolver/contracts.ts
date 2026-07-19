import type { LLMConfig } from '@page-agent/llms'

export const QUESTION_SOLVER_ACTIONS = ['inspect', 'answer', 'fill'] as const
export type QuestionSolverAction = (typeof QUESTION_SOLVER_ACTIONS)[number]

export const QUESTION_SOLVER_SCOPES = ['visible', 'current_page', 'all_pages'] as const
export type QuestionSolverScope = (typeof QUESTION_SOLVER_SCOPES)[number]

export const QUESTION_TYPES = [
	'single',
	'multiple',
	'judgement',
	'completion',
	'dropdown',
	'line',
	'fill',
	'reader',
	'translation',
	'unknown',
] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type LogicalPageFingerprint = string
export type BindingFingerprint = string

export type AdapterMaturity = 'implemented' | 'fixture_verified' | 'live_verified'
export type SaveEffect = 'none' | 'draft_reversible' | 'draft_irreversible'
export type TypeSupport = 'inspect_only' | 'inspect_answer' | 'inspect_answer_fill'
export type NavigationProfileId = 'default' | 'chaoxing.modern.preview' | 'chaoxing.modern.serial'

export interface AdapterRef {
	platform: string
	variant: string
	version: number
}

export interface RunIdentity {
	taskId: string
	taskEpoch: number
	runId: string
}

export interface FrameRef {
	tabId: number
	frameId: number
	parentFrameId: number
	documentId?: string
	documentToken: string
	urlFingerprint: string
}

export interface ImageAssetRef {
	assetId: string
	runId: string
	questionFingerprint: string
	sha256: string
	mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
	width: number
	height: number
	byteLength: number
}

export interface InternalImageEnvelope {
	kind: 'question_solver_image_asset'
	assetId: string
	runId: string
	questionFingerprint: string
	anchorKey: string
	mimeType: ImageAssetRef['mimeType']
	base64: string
	sha256: string
	width: number
	height: number
	byteLength: number
}

export interface QuestionImageResolveRequest {
	identity: RunIdentity
	target: FrameRef
	adapter: AdapterRef
	locator: QuestionLocator
	expectedBindingFingerprint: BindingFingerprint
	anchorKey: string
	policy: 'inline_then_bound_crop' | 'bound_crop_only'
}

export type AdapterImageResolveResponse =
	| { kind: 'resolved'; envelope: InternalImageEnvelope; resolution: 'inline' | 'screenshot' }
	| { kind: 'capture_required'; preparation: VisualCapturePreparation }
	| { kind: 'failed'; warningCodes: string[] }

export type ContentPart =
	| { type: 'text'; text: string }
	| {
			type: 'image'
			label: string
			anchorKey: string
			asset?: ImageAssetRef
			contentHash?: string
			requiredForAnswer: boolean
			resolution: 'inline' | 'screenshot' | 'failed'
	  }

export interface QuestionLocator {
	platform: string
	variant: string
	adapterVersion: number
	tabId: number
	frameId: number
	attemptId?: string
	platformQuestionId?: string
	fingerprint: string
}

export interface QuestionOption {
	key: string
	platformId?: string
	content: ContentPart[]
}

export interface Question {
	locator: QuestionLocator
	type: QuestionType
	stem: ContentPart[]
	material?: ContentPart[]
	options: QuestionOption[]
	blanks?: Array<{ key: string }>
	subQuestions?: Question[]
	hasRequiredVisuals: boolean
	visibility: 'fully_visible' | 'partially_visible' | 'offscreen' | 'unknown'
	visualAnchorKeys: string[]
	extractionWarnings: string[]
}

export type AnswerSource = 'embedded_answer' | 'visible_solution' | 'llm_text' | 'llm_vision'

export interface AnswerEvidence {
	source: AnswerSource
	questionFingerprint: string
	attemptId?: string
	sourceRefHash?: string
	mappingConfidence: number
	modelConfidence?: number
	warnings: string[]
}

export interface StructuredAnswer {
	questionFingerprint: string
	type: QuestionType
	selectedOptions?: string[]
	blanks?: Array<{ key: string; value: string }>
	dropdowns?: Array<{ key: string; optionKey: string }>
	linePairs?: Array<{ leftKey: string; rightKey: string }>
	subAnswers?: StructuredAnswer[]
	evidence: AnswerEvidence
}

export interface EmbeddedAnswerCandidate {
	source: 'dom' | 'runtime' | 'passive_response' | 'visible_solution'
	attemptRefHash?: string
	paperVersionRefHash?: string
	platformQuestionId?: string
	questionFingerprint?: string
	type: QuestionType
	selectedPlatformOptionIds?: string[]
	selectedStableKeys?: string[]
	blankValues?: Array<{ blankKey?: string; value: string }>
	linePairs?: Array<{ leftPlatformId: string; rightPlatformId: string }>
	sourceRefHash: string
}

export const QUESTION_OUTCOME_STATUSES = [
	'inspected',
	'answered_notFilled',
	'needsReview_notFilled',
	'filled_verified',
	'fill_failed',
	'filled_unverified',
	'skipped',
] as const
export type QuestionOutcomeStatus = (typeof QUESTION_OUTCOME_STATUSES)[number]

export type QuestionProcessingState =
	| 'discovered'
	| 'resolving'
	| 'answer_resolved'
	| 'fill_ready'
	| 'verifying'
	| QuestionOutcomeStatus

export type WireContentPart =
	| { kind: 'text'; text: string; truncated: boolean }
	| {
			kind: 'image'
			label: string
			resolution: 'inline' | 'screenshot' | 'failed'
			requiredForAnswer: boolean
	  }

export interface WireQuestionView {
	stem: WireContentPart[]
	material?: WireContentPart[]
	options: Array<{ key: string; content: WireContentPart[] }>
	blankKeys?: string[]
	subQuestionPaths?: string[]
}

export type WireAnswerPart =
	| { kind: 'choice'; questionPath: string; selectedOptionKeys: string[] }
	| {
			kind: 'text'
			questionPath: string
			values: Array<{ blankKey: string; value: string }>
	  }
	| {
			kind: 'dropdown'
			questionPath: string
			values: Array<{ blankKey: string; optionKey: string }>
	  }
	| {
			kind: 'line'
			questionPath: string
			pairs: Array<{ leftKey: string; rightKey: string }>
	  }

export interface WireStructuredAnswer {
	parts: WireAnswerPart[]
}

export interface WireAnswerEvidence {
	source: AnswerSource
	sourceRefHash?: string
	mappingConfidence: number
	modelConfidence?: number
	warningCodes: string[]
}

export type WirePageEffect =
	| 'none'
	| 'already_exact'
	| 'written_and_verified'
	| 'restored'
	| 'possibly_modified'

export interface WireOutcomeProblem {
	code: string
	stage:
		| 'detect'
		| 'extract'
		| 'embedded'
		| 'image'
		| 'model'
		| 'fill'
		| 'verify'
		| 'navigation'
		| 'interrupt'
		| 'privacy'
	message: string
	retryable: boolean
	requiresReview: boolean
}

export interface QuestionOutcomeSummary {
	adapter: AdapterRef
	questionFingerprint: string
	pageOrdinal: number
	questionOrdinal: string
	type: QuestionType
	status: QuestionOutcomeStatus
	question: WireQuestionView
	answer?: WireStructuredAnswer
	evidence?: WireAnswerEvidence
	pageEffect: WirePageEffect
	problem?: WireOutcomeProblem
	warningCodes: string[]
}

export type SolverExecutionStatus = 'completed' | 'partial' | 'blocked' | 'failed'

export interface QuestionSolverCounts {
	pages: number
	discovered: number
	inspected: number
	answered: number
	answeredNotFilled: number
	filledVerified: number
	needsReviewNotFilled: number
	fillFailed: number
	filledUnverified: number
	skipped: number
}

export interface QuestionSolverResult {
	mode: 'capability'
	capability: 'question_solver'
	action: QuestionSolverAction
	scope: QuestionSolverScope
	status: SolverExecutionStatus
	executionStatus: SolverExecutionStatus
	platform: string
	adapters: Array<{ ref: AdapterRef; maturity: AdapterMaturity; pages: number }>
	counts: QuestionSolverCounts
	questions: QuestionOutcomeSummary[]
	delivery: {
		chunkIndex: number
		hasMore: boolean
		remainingQuestionCount: number
		continuationToken?: string
	}
	resumeToken?: string
	blocker?: { code: string; message: string; requiresTakeover: boolean }
	finalSubmissionPerformed: false
}

export type MainWorldSetterOperationId =
	| 'common.native_input_set'
	| 'common.vditor_set'
	| 'icve.ueditor_set'
	| 'unipus.controlled_input_set'

export type MainWorldLifecycleOperationId =
	| 'common.passive_capture_arm'
	| 'common.passive_capture_disarm'

export type MainWorldReadOperationId =
	| 'common.network_quiet_snapshot'
	| 'chaoxing.runtime_read'
	| 'zhihuishu.gxk_project_exam_response'
	| 'zhihuishu.runtime_read'
	| 'icourse.runtime_read'

export type MainWorldOperationId =
	| MainWorldSetterOperationId
	| MainWorldLifecycleOperationId
	| MainWorldReadOperationId

export interface FixedMainWorldRuntime {
	execute<T extends JsonValue>(operationId: MainWorldReadOperationId, args: JsonValue): Promise<T>
	execute<T extends JsonValue>(
		operationId: MainWorldLifecycleOperationId,
		args: JsonValue,
		effect: { transactionId: string },
	): Promise<T>
	execute<T extends JsonValue>(
		operationId: MainWorldSetterOperationId,
		args: JsonValue,
		effect: {
			transactionId: string
			snapshotDigestVersion: 1
			snapshotDigest: string
			questionFingerprint: string
		},
	): Promise<T>
}

export interface ContentAnchorRegistry {
	registerImage(args: {
		questionFingerprint: string
		role: 'stem' | 'material' | 'option'
		optionKey?: string
		element: Element
	}): string
}

export interface AdapterContext {
	identity: RunIdentity
	frame: FrameRef
	action: QuestionSolverAction
	scope: QuestionSolverScope
	navigationProfileId?: NavigationProfileId
	signal: AbortSignal
	mainWorld: FixedMainWorldRuntime
	anchors: ContentAnchorRegistry
}

export interface AdapterMatch {
	matched: boolean
	score: number
	ref: AdapterRef
	navigationProfileId: NavigationProfileId
	surfaceFingerprint: string
	localRootRectCssPx: { x: number; y: number; width: number; height: number }
	questionRootCount: number
	evidenceCodes: string[]
}

export interface InterruptResult {
	blocked: boolean
	kind?: 'login' | 'captcha' | 'slider' | 'face' | '2fa' | 'permission' | 'anti_abuse'
	evidenceCodes: string[]
}

export interface NavigationProfile {
	id: NavigationProfileId
	readOnly: 'none' | 'next'
	afterFill: 'none' | 'next'
	advanceEffect: SaveEffect
	nextSelectorId?: string
	allowedNextVariants: string[]
}

export interface AdapterManifest {
	ref: AdapterRef
	maturity: AdapterMaturity
	sourceAttribution: Array<{ license: 'MIT'; path: string; symbols: string[] }>
	probe: {
		hosts: string[]
		routePatternIds: string[]
		requiredDomSignatures: string[]
		minimumScore: number
	}
	typeSupport: Partial<Record<QuestionType, TypeSupport>>
	maxModelConcurrency: number
	questionDelayMs: number
	readiness: {
		timeoutMs: number
		pollMs: number
		quietWindowMs: number
		requireNetworkQuiet: boolean
	}
	navigationProfiles: NavigationProfile[]
	fill: {
		exactState: true
		snapshot: 'required'
		saveEffect: SaveEffect
		visualControlVerification: boolean
	}
	embedded: {
		domProjectionIds: string[]
		runtimeOperationIds: MainWorldOperationId[]
		passive?: {
			endpointAllowlist: Array<{ method: 'GET' | 'POST'; routePatternId: string }>
			projectionOperationId: MainWorldOperationId
			maxCandidates: number
			maxSerializedBytes: number
			ttlMs: number
		}
	}
}

export interface FillCommand {
	locator: QuestionLocator
	expectedLogicalPageFingerprint: LogicalPageFingerprint
	expectedBindingFingerprint: BindingFingerprint
	answer: StructuredAnswer
}

export type ControlValue =
	| { kind: 'choice'; questionFingerprint: string; selectedOptionKeys: string[] }
	| {
			kind: 'text'
			questionFingerprint: string
			values: Array<{ blankKey: string; value: string }>
	  }
	| {
			kind: 'dropdown'
			questionFingerprint: string
			values: Array<{ blankKey: string; optionKey: string }>
	  }
	| {
			kind: 'line'
			questionFingerprint: string
			pairs: Array<{ leftKey: string; rightKey: string }>
	  }

export interface ControlSnapshot {
	transactionId: string
	snapshotDigestVersion: 1
	snapshotDigest: string
	logicalPageFingerprint: LogicalPageFingerprint
	bindingFingerprint: BindingFingerprint
	values: ControlValue[]
	restoreCapability: 'exact' | 'dom_only' | 'none'
}

export interface ControlTransactionRef {
	transactionId: string
	snapshotDigestVersion: 1
	snapshotDigest: string
}

export interface FillAttempt {
	questionFingerprint: string
	result: 'already_exact' | 'written' | 'not_written'
	changed: boolean
	warningCodes: string[]
}

export interface VerificationResult {
	questionFingerprint: string
	dom: 'matched' | 'mismatch' | 'unavailable'
	runtime: 'matched' | 'mismatch' | 'unavailable'
	observed?: ControlValue
	warningCodes: string[]
}

export interface RestoreResult {
	restored: boolean
	verified: boolean
	pageMayRemainModified: boolean
	warningCodes: string[]
}

export interface VisualCapturePreparation {
	transactionId: string
	anchorKey: string
	localRectCssPx: { x: number; y: number; width: number; height: number }
	viewportCssPx: { width: number; height: number }
	fullyVisibleInFrame: boolean
	scrollWasChanged: boolean
}

export interface NavigationState {
	profileId: NavigationProfileId
	hasNext: boolean
	mode: 'none' | 'read_only' | 'after_fill'
	advanceEffect: SaveEffect
	nextControlFingerprint?: string
}

export interface NavigationResult {
	initiated: boolean
	oldDocumentExpectedToUnload: boolean
	warningCodes: string[]
}

export interface ReadinessResult {
	ready: boolean
	logicalPageFingerprint?: LogicalPageFingerprint
	bindingFingerprint?: BindingFingerprint
	networkQuietObserved: boolean
	warningCodes: string[]
}

export interface QuestionPlatformAdapter {
	readonly manifest: AdapterManifest
	releaseRun?(runId: string): void
	probe(ctx: AdapterContext): Promise<AdapterMatch>
	probeInterrupts(ctx: AdapterContext): Promise<InterruptResult>
	extract(ctx: AdapterContext): Promise<Question[]>
	readEmbeddedAnswers(
		ctx: AdapterContext,
		questions: Question[],
	): Promise<EmbeddedAnswerCandidate[]>
	prepareVisualCapture(
		ctx: AdapterContext,
		locator: QuestionLocator,
		anchorKey: string,
		allowScroll: boolean,
	): Promise<VisualCapturePreparation>
	restoreVisualCapture(ctx: AdapterContext, transactionId: string): Promise<void>
	captureControlState(ctx: AdapterContext, commands: FillCommand[]): Promise<ControlSnapshot>
	setExactAnswers(
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
		commands: FillCommand[],
	): Promise<FillAttempt[]>
	verify(ctx: AdapterContext, commands: FillCommand[]): Promise<VerificationResult[]>
	restoreControlState(
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
		snapshot: ControlSnapshot,
	): Promise<RestoreResult>
	getNavigation(ctx: AdapterContext): Promise<NavigationState>
	gotoNext(
		ctx: AdapterContext,
		authorization: 'read_only' | 'after_fill',
		before: LogicalPageFingerprint,
	): Promise<NavigationResult>
	waitReady(ctx: AdapterContext, before?: LogicalPageFingerprint): Promise<ReadinessResult>
}

export interface QuestionSolverModels {
	text: LLMConfig
	vision?: LLMConfig
}
