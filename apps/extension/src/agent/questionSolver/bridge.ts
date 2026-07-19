import { raceWithAbort } from './asyncControl'
import type {
	AdapterRef,
	FrameRef,
	JsonValue,
	QuestionSolverAction,
	QuestionSolverScope,
	RunIdentity,
} from './contracts'
import {
	QUESTION_SOLVER_PROTOCOL_VERSION,
	type QuestionSolverDiscoverMessage,
	type QuestionSolverDiscoverResult,
	type QuestionSolverRunMessage,
	type SolverCancelRequest,
	type SolverOperation,
	type SolverRequest,
	type SolverResponse,
} from './protocol'

export interface QuestionSolverTaskLease {
	taskId: string
	taskEpoch: number
	leaseToken: string
	managedTabIds: number[]
	targetTabId: number
}

export interface QuestionSolverTransport {
	send(message: unknown): Promise<unknown>
}

export interface SolverRequestOptions {
	adapter?: AdapterRef
	payload?: JsonValue
	phase?: 'business' | 'cleanup'
	laneKey?: string
	signal?: AbortSignal
}

export class QuestionSolverBridgeError extends Error {
	constructor(readonly code: string) {
		super(code)
		this.name = 'QuestionSolverBridgeError'
	}
}

export class QuestionSolverBridge {
	private readonly transport: QuestionSolverTransport

	constructor(
		private readonly lease: QuestionSolverTaskLease,
		transport?: QuestionSolverTransport,
	) {
		this.transport = transport ?? { send: (message) => chrome.runtime.sendMessage(message) }
		if (!lease.managedTabIds.includes(lease.targetTabId)) {
			throw new QuestionSolverBridgeError('target_tab_not_managed')
		}
	}

	async begin(
		action: QuestionSolverAction,
		scope: QuestionSolverScope,
		signal?: AbortSignal,
	): Promise<QuestionSolverRunBridge> {
		const identity: RunIdentity = {
			taskId: this.lease.taskId,
			taskEpoch: this.lease.taskEpoch,
			runId: crypto.randomUUID(),
		}
		const message: QuestionSolverRunMessage = {
			type: 'QUESTION_SOLVER_RUN',
			protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
			operation: 'begin',
			identity,
			leaseToken: this.lease.leaseToken,
			tabId: this.lease.targetTabId,
			action,
			scope,
		}
		const raw = await sendAbortably(this.transport, message, signal)
		const response = requireOkRecord(raw)
		const recoveryCapabilityHash = response.recoveryCapabilityHash
		if (
			typeof recoveryCapabilityHash !== 'string' ||
			!/^[a-f0-9]{64}$/.test(recoveryCapabilityHash)
		) {
			throw new QuestionSolverBridgeError('run_begin_response_invalid')
		}
		return new QuestionSolverRunBridge({
			identity,
			action,
			scope,
			leaseToken: this.lease.leaseToken,
			targetTabId: this.lease.targetTabId,
			recoveryCapabilityHash,
			transport: this.transport,
		})
	}
}

interface RunBridgeInit {
	identity: RunIdentity
	action: QuestionSolverAction
	scope: QuestionSolverScope
	leaseToken: string
	targetTabId: number
	recoveryCapabilityHash: string
	transport: QuestionSolverTransport
}

export class QuestionSolverRunBridge {
	readonly identity: RunIdentity
	readonly action: QuestionSolverAction
	readonly scope: QuestionSolverScope
	readonly targetTabId: number
	private readonly leaseToken: string
	private readonly recoveryCapabilityHash: string
	private readonly transport: QuestionSolverTransport
	private requestSeq = 0
	private readonly laneGenerations = new Map<string, { generation: number; requestId: string }>()
	private readonly pending = new Set<string>()
	private closed = false

	constructor(init: RunBridgeInit) {
		this.identity = init.identity
		this.action = init.action
		this.scope = init.scope
		this.targetTabId = init.targetTabId
		this.leaseToken = init.leaseToken
		this.recoveryCapabilityHash = init.recoveryCapabilityHash
		this.transport = init.transport
	}

	async discoverFrames(signal?: AbortSignal): Promise<QuestionSolverDiscoverResult> {
		this.assertOpen()
		const message: QuestionSolverDiscoverMessage = {
			type: 'QUESTION_SOLVER_DISCOVER',
			protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
			identity: this.identity,
			leaseToken: this.leaseToken,
			tabId: this.targetTabId,
		}
		const raw = requireOkRecord(await sendAbortably(this.transport, message, signal))
		const data = asRecord(raw.data)
		if (!Array.isArray(data.frames) || !Array.isArray(data.incompleteFrameIds)) {
			throw new QuestionSolverBridgeError('frame_discovery_response_invalid')
		}
		return data as unknown as QuestionSolverDiscoverResult
	}

	async request<T extends JsonValue = JsonValue>(
		target: FrameRef,
		operation: SolverOperation,
		options: SolverRequestOptions = {},
	): Promise<T> {
		this.assertOpen()
		if (target.tabId !== this.targetTabId)
			throw new QuestionSolverBridgeError('target_tab_mismatch')
		const requestId = crypto.randomUUID()
		const lane = options.laneKey ? this.nextLane(options.laneKey, requestId) : undefined
		const payload: Record<string, JsonValue> = {
			solverAction: this.action,
			solverScope: this.scope,
			...asRecord(options.payload),
		}
		if (operation === 'state_capture') {
			payload.recoveryCapabilityHash = this.recoveryCapabilityHash
		}
		const request: SolverRequest = {
			type: 'QUESTION_SOLVER_CONTROL',
			protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
			kind: 'request',
			identity: this.identity,
			requestId,
			requestSeq: ++this.requestSeq,
			leaseToken: this.leaseToken,
			target,
			operation,
			payload,
			adapter: options.adapter,
			phase: options.phase,
			laneKey: options.laneKey,
			generation: lane?.generation,
			supersedesRequestId: lane?.supersedesRequestId,
		}
		this.pending.add(requestId)
		try {
			const raw = await sendAbortably(this.transport, request, options.signal)
			if (!this.pending.has(requestId)) throw new QuestionSolverBridgeError('request_not_pending')
			const response = requireSolverResponse(raw)
			if (
				response.requestId !== requestId ||
				response.identity.runId !== this.identity.runId ||
				response.identity.taskId !== this.identity.taskId ||
				response.identity.taskEpoch !== this.identity.taskEpoch ||
				response.targetDocumentToken !== target.documentToken ||
				(options.laneKey &&
					(response.laneKey !== options.laneKey || response.generation !== lane?.generation))
			) {
				throw new QuestionSolverBridgeError('stale_solver_response')
			}
			if (!response.ok) throw new QuestionSolverBridgeError(response.error.code)
			return response.data as T
		} finally {
			this.pending.delete(requestId)
		}
	}

	async cancel(
		reason: SolverCancelRequest['reason'] = 'user',
		signal?: AbortSignal,
	): Promise<void> {
		if (this.closed) return
		const message: SolverCancelRequest = {
			type: 'QUESTION_SOLVER_CONTROL',
			protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
			kind: 'cancel',
			identity: this.identity,
			leaseToken: this.leaseToken,
			reason,
		}
		this.pending.clear()
		requireOkRecord(await sendAbortably(this.transport, message, signal))
	}

	async enterCleanup(signal?: AbortSignal): Promise<void> {
		await this.sendRunLifecycle('enter_cleanup', signal)
	}

	async finish(cleanupVerified: boolean, signal?: AbortSignal): Promise<'closed' | 'quarantined'> {
		if (this.closed) return 'closed'
		const raw = await this.sendRunLifecycle('finish', signal, cleanupVerified)
		const lifecycle = asRecord(raw).lifecycle
		if (lifecycle !== 'closed' && lifecycle !== 'quarantined') {
			throw new QuestionSolverBridgeError('run_finish_response_invalid')
		}
		this.closed = true
		this.pending.clear()
		return lifecycle
	}

	private async sendRunLifecycle(
		operation: 'enter_cleanup' | 'finish',
		signal?: AbortSignal,
		cleanupVerified?: boolean,
	): Promise<Record<string, unknown>> {
		const message: QuestionSolverRunMessage = {
			type: 'QUESTION_SOLVER_RUN',
			protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
			operation,
			identity: this.identity,
			leaseToken: this.leaseToken,
			cleanupVerified,
		}
		return requireOkRecord(await sendAbortably(this.transport, message, signal))
	}

	private nextLane(
		laneKey: string,
		requestId: string,
	): { generation: number; supersedesRequestId?: string } {
		const previous = this.laneGenerations.get(laneKey)
		const generation = (previous?.generation ?? 0) + 1
		this.laneGenerations.set(laneKey, { generation, requestId })
		return { generation, supersedesRequestId: previous?.requestId }
	}

	private assertOpen(): void {
		if (this.closed) throw new QuestionSolverBridgeError('run_closed')
	}
}

async function sendAbortably(
	transport: QuestionSolverTransport,
	message: unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	signal?.throwIfAborted()
	return raceWithAbort(transport.send(message), signal)
}

function requireOkRecord(value: unknown): Record<string, unknown> {
	const record = asRecord(value)
	if (record.ok !== true) {
		const error = asRecord(record.error)
		throw new QuestionSolverBridgeError(
			typeof error.code === 'string' ? error.code : 'question_solver_transport_failed',
		)
	}
	return record
}

function requireSolverResponse(value: unknown): SolverResponse {
	const response = asRecord(value)
	if (
		typeof response.ok !== 'boolean' ||
		!isRecord(response.identity) ||
		typeof response.requestId !== 'string' ||
		typeof response.requestSeq !== 'number'
	) {
		throw new QuestionSolverBridgeError('solver_response_invalid')
	}
	return response as unknown as SolverResponse
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
