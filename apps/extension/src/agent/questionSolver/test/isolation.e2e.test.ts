import { describe, expect, it, vi } from 'vitest'

import { QuestionSolverAdapterHost } from '../adapterHost.content'
import type { AnswerModelResolution } from '../answerModel'
import { QuestionSolverBackgroundState, type SessionStorageLike } from '../backgroundState'
import {
	QuestionSolverBridge,
	type QuestionSolverTaskLease,
	type QuestionSolverTransport,
	type SolverRequestOptions,
} from '../bridge'
import {
	QuestionSolverBackgroundBridge,
	type QuestionSolverBackgroundApi,
} from '../bridge.background'
import type {
	FrameRef,
	JsonValue,
	Question,
	QuestionOutcomeSummary,
	QuestionPlatformAdapter,
	QuestionSolverAction,
	QuestionSolverResult,
	QuestionSolverScope,
	ReadinessResult,
	RunIdentity,
	StructuredAnswer,
} from '../contracts'
import { sha256Hex } from '../fingerprints'
import { QuestionSolverOrchestrator, type QuestionSolverRunClient } from '../orchestrator'
import { createGenericQuestionAdapter } from '../platforms/generic'
import type { SolverOperation, SolverRequest } from '../protocol'
import { QuestionAdapterRegistry } from '../registry'
import { ResultStore, ResumeCursorStore, type QuestionSolverResultBase } from '../resultStore'
import { summarizeQuestionOutcomes } from '../stateMachine'

const LEASE_A = 'lease-token-a-that-is-at-least-thirty-two-characters'
const LEASE_B = 'lease-token-b-that-is-at-least-thirty-two-characters'
const IDENTITY_A: RunIdentity = { taskId: 'task-a', taskEpoch: 1, runId: 'run-a' }
const IDENTITY_B: RunIdentity = { taskId: 'task-b', taskEpoch: 1, runId: 'run-b' }
const REF = { platform: 'chaoxing', variant: 'chaoxing.modern_work_exam', version: 1 }
const GENERIC_REF = { platform: 'generic', variant: 'generic.standard_html', version: 1 }
const TOP_FRAME: FrameRef = {
	tabId: 1,
	frameId: 0,
	parentFrameId: -1,
	documentId: 'top-document',
	documentToken: 'top-document-token',
	urlFingerprint: 'a'.repeat(64),
}
const CHILD_FRAME: FrameRef = {
	tabId: 1,
	frameId: 1,
	parentFrameId: 0,
	documentId: 'question-document',
	documentToken: 'question-document-token',
	urlFingerprint: 'b'.repeat(64),
}
const READY: ReadinessResult = {
	ready: true,
	logicalPageFingerprint: 'c'.repeat(64),
	bindingFingerprint: 'd'.repeat(64),
	networkQuietObserved: true,
	warningCodes: [],
}
const CONTENT_SENDER = {
	id: 'extension-id',
	tab: { id: 1 } as chrome.tabs.Tab,
	frameId: 0,
	documentId: 'top-document',
	url: 'https://example.test/assessment',
} as chrome.runtime.MessageSender

describe('question solver isolation integration', () => {
	it('isolates frame registrations and mutation ownership across two task/run identities', async () => {
		const state = new QuestionSolverBackgroundState()
		await state.registerTaskLease({
			taskId: IDENTITY_A.taskId,
			taskEpoch: IDENTITY_A.taskEpoch,
			leaseToken: LEASE_A,
			managedTabIds: [1],
			targetTabId: 1,
		})
		await state.registerTaskLease({
			taskId: IDENTITY_B.taskId,
			taskEpoch: IDENTITY_B.taskEpoch,
			leaseToken: LEASE_B,
			managedTabIds: [1],
			targetTabId: 1,
		})
		await state.beginRun({
			identity: IDENTITY_A,
			leaseToken: LEASE_A,
			tabId: 1,
			action: 'fill',
			scope: 'current_page',
		})
		await state.beginRun({
			identity: IDENTITY_B,
			leaseToken: LEASE_B,
			tabId: 1,
			action: 'fill',
			scope: 'current_page',
		})

		const nonce = await state.createFrameChallenge({
			identity: IDENTITY_A,
			leaseToken: LEASE_A,
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'top-document',
		})
		const frame = state.consumeFrameChallenge(
			{
				type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
				protocolVersion: 1,
				nonce,
				documentToken: TOP_FRAME.documentToken,
				urlFingerprint: TOP_FRAME.urlFingerprint,
			},
			CONTENT_SENDER,
		)

		expect(() => state.validateFrame(frame, IDENTITY_A)).not.toThrow()
		expect(() => state.validateFrame(frame, IDENTITY_B)).toThrow()
		await state.acquireMutationOwner(IDENTITY_A)
		await expect(state.acquireMutationOwner(IDENTITY_B)).rejects.toMatchObject({
			code: 'tab_owned_by_other_run',
		})
	})

	it('supersedes an in-flight lane request and rejects its late adapter response', async () => {
		const firstEntered = deferred()
		const releaseFirst = deferred()
		let readinessCall = 0
		const adapter: QuestionPlatformAdapter = createGenericQuestionAdapter({
			getUrl: () => 'https://example.test/assessment',
		})
		adapter.waitReady = vi.fn(async () => {
			readinessCall++
			if (readinessCall === 1) {
				firstEntered.resolve()
				await releaseFirst.promise
			}
			return READY
		})
		const host = new QuestionSolverAdapterHost({
			registry: new QuestionAdapterRegistry([adapter]),
		})
		host.activate(TOP_FRAME, { taskId: IDENTITY_A.taskId, taskEpoch: IDENTITY_A.taskEpoch })
		const transport: QuestionSolverTransport = {
			send: vi.fn(async (message) => {
				const record = message as Record<string, unknown>
				if (record.type === 'QUESTION_SOLVER_RUN' && record.operation === 'begin') {
					return { ok: true, recoveryCapabilityHash: 'e'.repeat(64) }
				}
				if (record.type === 'QUESTION_SOLVER_CONTROL' && record.kind === 'request') {
					return host.handleRequest(message as SolverRequest)
				}
				throw new Error('unexpected_transport_message')
			}),
		}
		const run = await new QuestionSolverBridge(
			{
				taskId: IDENTITY_A.taskId,
				taskEpoch: IDENTITY_A.taskEpoch,
				leaseToken: LEASE_A,
				managedTabIds: [1],
				targetTabId: 1,
			},
			transport,
		).begin('answer', 'current_page')

		const first = run.request(TOP_FRAME, 'ready', {
			adapter: GENERIC_REF,
			laneKey: 'page-readiness',
		})
		const firstRejection = expect(first).rejects.toMatchObject({ code: 'request_superseded' })
		await firstEntered.promise
		const second = run.request(TOP_FRAME, 'ready', {
			adapter: GENERIC_REF,
			laneKey: 'page-readiness',
		})

		await expect(second).resolves.toEqual(READY)
		releaseFirst.resolve()
		await firstRejection
		expect(adapter.waitReady).toHaveBeenCalledTimes(2)
	})

	it('blocks a child-frame fill when the top frame reports a protected overlay', async () => {
		const run = new SyntheticRun('fill', 'current_page', [question(1)], {
			topFrameBlocked: true,
		})
		const answerQuestion = vi.fn()
		const result = await solver(run, answerQuestion).execute({
			action: 'fill',
			scope: 'current_page',
		})

		expect(result.blocker).toMatchObject({
			code: 'protected_captcha',
			requiresTakeover: true,
		})
		expect(answerQuestion).not.toHaveBeenCalled()
		expect(run.operations).not.toContain('state_capture')
		expect(run.operations).not.toContain('fill')
	})

	it('does not accept an unchanged old DOM as a newly navigated page', async () => {
		const run = new SyntheticRun('answer', 'all_pages', [question(2)], { hasNext: true })
		const answerQuestion = vi.fn(answerResolution)
		const result = await solver(run, answerQuestion).execute({
			action: 'answer',
			scope: 'all_pages',
		})

		expect(result.blocker).toMatchObject({ code: 'page_cycle_detected' })
		expect(answerQuestion).toHaveBeenCalledOnce()
		expect(run.nextCalls).toBe(1)
		expect(run.operations.filter((operation) => operation === 'ready')).toHaveLength(2)
	})

	it('drains continuation chunks without work and resumes only the unprocessed question', async () => {
		const lease = integrationLease()
		const questions = Array.from({ length: 49 }, (_, index) => question(index + 10))
		const processed = questions.slice(0, 48)
		const outcomes = processed.map((item, index) => outcome(item, index, 2_800))
		const managedTabLeaseId = await managedLeaseDigest(lease)
		const resumeStore = new ResumeCursorStore({ tokenFactory: tokenFactory() })
		const resumeToken = resumeStore.create({
			identity: { taskId: lease.taskId, taskEpoch: lease.taskEpoch, runId: 'source-run' },
			action: 'answer',
			scope: 'all_pages',
			targetTabId: lease.targetTabId,
			managedTabLeaseId,
			platform: REF.platform,
			variant: REF.variant,
			navigationProfileId: 'chaoxing.modern.preview',
			logicalPageFingerprint: READY.logicalPageFingerprint!,
			lastTerminalQuestionFingerprint: processed.at(-1)!.locator.fingerprint,
			orderedPrefixHash: await orderedPrefixHash(processed.map((item) => item.locator.fingerprint)),
			processedQuestionCount: processed.length,
		})
		const resultStore = new ResultStore(resumeStore, { tokenFactory: tokenFactory() })
		const first = resultStore.publish({
			identity: { taskId: lease.taskId, taskEpoch: lease.taskEpoch, runId: 'source-run' },
			base: resultBase(outcomes, resumeToken),
			questions: outcomes,
		})
		const run = new SyntheticRun('answer', 'all_pages', questions, { hasNext: false })
		const answerQuestion = vi.fn(answerResolution)
		const beginRun = vi.fn(async () => run)
		const orchestrator = new QuestionSolverOrchestrator({
			getLease: () => lease,
			getModels: () => ({ text: { baseURL: 'https://model.test/v1', model: 'text' } }),
			beginRun,
			answerQuestion: answerQuestion as any,
			resumeStore,
			resultStore,
		})

		expect(() =>
			resumeStore.claim({
				resumeToken,
				identity: { taskId: lease.taskId, taskEpoch: lease.taskEpoch, runId: 'too-early' },
				action: 'answer',
				scope: 'all_pages',
				targetTabId: lease.targetTabId,
				managedTabLeaseId,
			}),
		).toThrowError(expect.objectContaining({ code: 'resume_delivery_pending' }))

		const chunks: QuestionSolverResult[] = [first]
		let current = first
		while (current.delivery.hasMore) {
			current = await orchestrator.execute({
				action: 'answer',
				scope: 'all_pages',
				continuationToken: current.delivery.continuationToken!,
			})
			chunks.push(current)
		}
		expect(chunks.length).toBeGreaterThan(1)
		expect(beginRun).not.toHaveBeenCalled()
		expect(answerQuestion).not.toHaveBeenCalled()
		expect(run.discoverCalls).toBe(0)
		expect(run.operations).toEqual([])

		const resumed = await orchestrator.execute({
			action: 'answer',
			scope: 'all_pages',
			resumeToken,
		})

		expect(beginRun).toHaveBeenCalledOnce()
		expect(answerQuestion).toHaveBeenCalledOnce()
		expect(answerQuestion.mock.calls[0][0].locator.fingerprint).toBe(
			questions.at(-1)!.locator.fingerprint,
		)
		expect(resumed.questions).toHaveLength(1)
		expect(resumed.questions[0].questionFingerprint).toBe(questions.at(-1)!.locator.fingerprint)
		expect(run.operations).not.toContain('fill')
		expect(resumeStore.has(resumeToken)).toBe(false)
	})

	it('rehydrates a quarantined setter and restores it after background worker recovery', async () => {
		const storage = new MemorySessionStorage()
		const first = new QuestionSolverBackgroundState(storage)
		await first.registerTaskLease({
			taskId: IDENTITY_A.taskId,
			taskEpoch: IDENTITY_A.taskEpoch,
			leaseToken: LEASE_A,
			managedTabIds: [1],
			targetTabId: 1,
		})
		await first.beginRun({
			identity: IDENTITY_A,
			leaseToken: LEASE_A,
			tabId: 1,
			action: 'fill',
			scope: 'current_page',
		})
		await first.acquireMutationOwner(IDENTITY_A)
		await first.recordEffectDispatch(IDENTITY_A, {
			requestId: 'uncertain-setter',
			operation: 'common.native_input_set',
			tabId: 1,
			documentId: TOP_FRAME.documentId!,
			documentToken: TOP_FRAME.documentToken,
			transactionId: 'transaction-1',
			snapshotDigest: 'f'.repeat(64),
		})
		expect(await first.finishRun(IDENTITY_A, false)).toBe('quarantined')

		const recovered = new QuestionSolverBackgroundState(storage)
		const api = backgroundApi()
		vi.mocked(api.sendTabMessage).mockImplementation(async (_tabId, message) => {
			if ((message as { type?: string }).type === 'QUESTION_SOLVER_RELEASE') return { ok: true }
			return (message as { operation?: string }).operation === 'inventory'
				? { ok: true, data: { available: true } }
				: { ok: true, data: { restored: true, verified: true } }
		})
		const bridge = new QuestionSolverBackgroundBridge(recovered, api)
		await bridge.initialize()
		const nonce = await recovered.createFrameChallenge({
			identity: IDENTITY_A,
			leaseToken: LEASE_A,
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: TOP_FRAME.documentId,
		})

		await bridge.handleMessage(
			{
				type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
				protocolVersion: 1,
				nonce,
				documentToken: TOP_FRAME.documentToken,
				urlFingerprint: TOP_FRAME.urlFingerprint,
			},
			CONTENT_SENDER,
		)

		expect(recovered.getRunLifecycle(IDENTITY_A.runId)).toBe('closed')
		expect(recovered.getMutationOwner(1)).toBeUndefined()
		expect(
			vi
				.mocked(api.sendTabMessage)
				.mock.calls.map(([, message]) =>
					(message as { type?: string }).type === 'QUESTION_SOLVER_RELEASE'
						? 'release'
						: (message as { operation?: string }).operation,
				),
		).toEqual(['inventory', 'state_restore', 'release'])
	})
})

class SyntheticRun implements QuestionSolverRunClient {
	readonly targetTabId = 1
	readonly identity = { taskId: 'integration-task', taskEpoch: 7, runId: 'integration-run' }
	readonly operations: SolverOperation[] = []
	discoverCalls = 0
	nextCalls = 0

	constructor(
		readonly action: QuestionSolverAction,
		readonly scope: QuestionSolverScope,
		private readonly questions: Question[],
		private readonly options: { topFrameBlocked?: boolean; hasNext?: boolean } = {},
	) {}

	async discoverFrames() {
		this.discoverCalls++
		return { frames: [TOP_FRAME, CHILD_FRAME], incompleteFrameIds: [] }
	}

	async request<T extends JsonValue = JsonValue>(
		target: FrameRef,
		operation: SolverOperation,
		_options: SolverRequestOptions = {},
	): Promise<T> {
		this.operations.push(operation)
		let value: unknown
		switch (operation) {
			case 'probe':
				value =
					target.frameId === CHILD_FRAME.frameId
						? {
								ambiguous: false,
								selected: {
									matched: true,
									score: 1,
									ref: REF,
									navigationProfileId: 'chaoxing.modern.preview',
									surfaceFingerprint: 'question-surface',
									localRootRectCssPx: { x: 0, y: 0, width: 100, height: 100 },
									questionRootCount: this.questions.length,
									evidenceCodes: [],
								},
							}
						: { ambiguous: false, matches: [] }
				break
			case 'interrupts':
				value =
					this.options.topFrameBlocked && target.frameId === TOP_FRAME.frameId
						? { blocked: true, kind: 'captcha', evidenceCodes: ['top-overlay'] }
						: { blocked: false, evidenceCodes: [] }
				break
			case 'extract':
				value = this.questions
				break
			case 'ready':
				value = READY
				break
			case 'embedded_arm':
				value = { armed: true }
				break
			case 'embedded_read':
				value = []
				break
			case 'embedded_disarm':
				value = { disarmed: true }
				break
			case 'navigation':
				value = {
					profileId: 'chaoxing.modern.preview',
					hasNext: this.options.hasNext === true,
					mode: 'read_only',
					advanceEffect: 'none',
				}
				break
			case 'next':
				this.nextCalls++
				value = { initiated: true, oldDocumentExpectedToUnload: false, warningCodes: [] }
				break
			default:
				throw new Error(`unexpected_synthetic_operation:${operation}`)
		}
		return value as T
	}

	async cancel() {}
	async enterCleanup() {}
	async finish(): Promise<'closed'> {
		return 'closed'
	}
}

function solver(run: SyntheticRun, answerQuestion: ReturnType<typeof vi.fn>) {
	return new QuestionSolverOrchestrator({
		getLease: integrationLease,
		getModels: () => ({ text: { baseURL: 'https://model.test/v1', model: 'text' } }),
		beginRun: async () => run,
		answerQuestion: answerQuestion as any,
	})
}

function integrationLease(): QuestionSolverTaskLease {
	return {
		taskId: 'integration-task',
		taskEpoch: 7,
		leaseToken: 'integration-lease-token-that-is-long-enough',
		managedTabIds: [1],
		targetTabId: 1,
	}
}

function question(index: number): Question {
	const fingerprint = index.toString(16).padStart(64, '0')
	return {
		locator: {
			platform: REF.platform,
			variant: REF.variant,
			adapterVersion: REF.version,
			tabId: CHILD_FRAME.tabId,
			frameId: CHILD_FRAME.frameId,
			platformQuestionId: `question-${index}`,
			fingerprint,
		},
		type: 'single',
		stem: [{ type: 'text', text: `Question ${index}` }],
		options: [
			{ key: 'A', content: [{ type: 'text', text: 'First' }] },
			{ key: 'B', content: [{ type: 'text', text: 'Second' }] },
		],
		hasRequiredVisuals: false,
		visibility: 'fully_visible',
		visualAnchorKeys: [],
		extractionWarnings: [],
	}
}

async function answerResolution(resolved: Question): Promise<AnswerModelResolution> {
	return {
		status: 'accepted',
		route: 'text',
		answer: answer(resolved),
		rechecked: false,
	}
}

function answer(resolved: Question): StructuredAnswer {
	return {
		questionFingerprint: resolved.locator.fingerprint,
		type: 'single',
		selectedOptions: ['B'],
		evidence: {
			source: 'llm_text',
			questionFingerprint: resolved.locator.fingerprint,
			mappingConfidence: 1,
			modelConfidence: 0.9,
			warnings: [],
		},
	}
}

function outcome(source: Question, index: number, payloadLength: number): QuestionOutcomeSummary {
	const payload = 'x'.repeat(payloadLength)
	return {
		adapter: REF,
		questionFingerprint: source.locator.fingerprint,
		pageOrdinal: 1,
		questionOrdinal: String(index + 1),
		type: 'single',
		status: 'answered_notFilled',
		question: {
			stem: Array.from({ length: Math.ceil(payload.length / 1_000) }, (_, part) => ({
				kind: 'text' as const,
				text: payload.slice(part * 1_000, (part + 1) * 1_000),
				truncated: false,
			})),
			options: [{ key: 'B', content: [{ kind: 'text', text: 'Second', truncated: false }] }],
		},
		answer: { parts: [{ kind: 'choice', questionPath: 'root', selectedOptionKeys: ['B'] }] },
		evidence: {
			source: 'llm_text',
			mappingConfidence: 1,
			modelConfidence: 0.9,
			warningCodes: [],
		},
		pageEffect: 'none',
		warningCodes: [],
	}
}

function resultBase(
	outcomes: readonly QuestionOutcomeSummary[],
	resumeToken: string,
): QuestionSolverResultBase {
	return {
		mode: 'capability',
		capability: 'question_solver',
		action: 'answer',
		scope: 'all_pages',
		executionStatus: 'partial',
		platform: REF.platform,
		adapters: [{ ref: REF, maturity: 'fixture_verified', pages: 1 }],
		counts: summarizeQuestionOutcomes(outcomes, 1),
		resumeToken,
		finalSubmissionPerformed: false,
	}
}

async function managedLeaseDigest(lease: QuestionSolverTaskLease): Promise<string> {
	return sha256Hex(
		`${lease.taskId}\0${lease.taskEpoch}\0${lease.leaseToken}\0${[...lease.managedTabIds]
			.sort((left, right) => left - right)
			.join(',')}\0${lease.targetTabId}`,
	)
}

function orderedPrefixHash(fingerprints: readonly string[]): Promise<string> {
	return sha256Hex(`wenxue-question-prefix-v1\0${fingerprints.join('\0')}`)
}

function tokenFactory(): () => string {
	let next = 0
	return () => `isolation-e2e-token-${String(++next).padStart(16, '0')}`
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function backgroundApi(): QuestionSolverBackgroundApi {
	return {
		runtimeId: 'extension-id',
		extensionBaseUrl: 'chrome-extension://extension-id/',
		getAllFrames: vi.fn(async () => []),
		sendTabMessage: vi.fn(async () => undefined),
		executeMainWorld: vi.fn(async () => ({ updated: 1 })),
		captureVisiblePng: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AA==' })),
		cropAsset: vi.fn(async (args) => ({
			kind: 'question_solver_image_asset' as const,
			assetId: 'asset-1',
			runId: args.runId,
			questionFingerprint: args.questionFingerprint,
			anchorKey: args.anchorKey,
			mimeType: 'image/png' as const,
			base64: 'AA==',
			sha256: 'a'.repeat(64),
			width: 1,
			height: 1,
			byteLength: 1,
		})),
	}
}

class MemorySessionStorage implements SessionStorageLike {
	readonly values: Record<string, unknown> = {}

	async get(key: string): Promise<Record<string, unknown>> {
		return { [key]: this.values[key] }
	}

	async set(values: Record<string, unknown>): Promise<void> {
		Object.assign(this.values, structuredClone(values))
	}

	async remove(key: string): Promise<void> {
		delete this.values[key]
	}
}
