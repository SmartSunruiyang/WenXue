import * as z from 'zod/v4'

import type {
	AdapterRef,
	FrameRef,
	InternalImageEnvelope,
	JsonValue,
	MainWorldOperationId,
	RunIdentity,
} from './contracts'

export const QUESTION_SOLVER_PROTOCOL_VERSION = 1 as const

export const SOLVER_OPERATIONS = [
	'probe',
	'interrupts',
	'extract',
	'image_resolve',
	'embedded_arm',
	'embedded_read',
	'embedded_disarm',
	'visual_prepare',
	'visual_restore',
	'state_capture',
	'fill',
	'verify',
	'state_restore',
	'navigation',
	'next',
	'ready',
] as const
export type SolverOperation = (typeof SOLVER_OPERATIONS)[number]

export const SOLVER_CLEANUP_OPERATIONS = [
	'embedded_disarm',
	'visual_restore',
	'state_restore',
] as const satisfies readonly SolverOperation[]

export const SOLVER_MUTATING_OPERATIONS = [
	'image_resolve',
	'embedded_arm',
	'embedded_disarm',
	'visual_prepare',
	'visual_restore',
	'state_capture',
	'fill',
	'state_restore',
	'next',
] as const satisfies readonly SolverOperation[]

export const MAIN_WORLD_OPERATION_IDS = [
	'common.native_input_set',
	'common.vditor_set',
	'icve.ueditor_set',
	'unipus.controlled_input_set',
	'common.passive_capture_arm',
	'common.passive_capture_disarm',
	'common.network_quiet_snapshot',
	'chaoxing.runtime_read',
	'zhihuishu.gxk_project_exam_response',
	'zhihuishu.runtime_read',
	'icourse.runtime_read',
] as const satisfies readonly MainWorldOperationId[]

export const PARENT_OPERATION_TO_MAIN_WORLD_IDS: Readonly<
	Partial<Record<SolverOperation, readonly MainWorldOperationId[]>>
> = Object.freeze({
	fill: [
		'common.native_input_set',
		'common.vditor_set',
		'icve.ueditor_set',
		'unipus.controlled_input_set',
	],
	embedded_arm: ['common.passive_capture_arm'],
	embedded_disarm: ['common.passive_capture_disarm'],
	embedded_read: [
		'chaoxing.runtime_read',
		'zhihuishu.gxk_project_exam_response',
		'zhihuishu.runtime_read',
		'icourse.runtime_read',
	],
	ready: ['common.network_quiet_snapshot'],
})

export const MAIN_WORLD_SETTER_IDS = [
	'common.native_input_set',
	'common.vditor_set',
	'icve.ueditor_set',
	'unipus.controlled_input_set',
] as const satisfies readonly MainWorldOperationId[]

export interface FrameHelloChallenge {
	type: 'QUESTION_SOLVER_FRAME_HELLO_CHALLENGE'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	nonce: string
	taskId: string
	taskEpoch: number
}

export interface FrameHelloRegister {
	type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	nonce: string
	documentToken: string
	urlFingerprint: string
}

export interface FrameHelloAck {
	ok: true
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	frame: FrameRef
}

export interface SolverRequest {
	type: 'QUESTION_SOLVER_CONTROL'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	kind: 'request'
	identity: RunIdentity
	requestId: string
	requestSeq: number
	laneKey?: string
	generation?: number
	supersedesRequestId?: string
	phase?: 'business' | 'cleanup'
	leaseToken: string
	target: FrameRef
	adapter?: AdapterRef
	operation: SolverOperation
	payload?: JsonValue
}

export interface SolverCancelRequest {
	type: 'QUESTION_SOLVER_CONTROL'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	kind: 'cancel'
	identity: RunIdentity
	leaseToken: string
	reason: 'user' | 'abort_signal' | 'task_replaced' | 'navigation' | 'interrupt'
}

export interface SolverReleaseRequest {
	type: 'QUESTION_SOLVER_RELEASE'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	identity: RunIdentity
	target: FrameRef
	preserveRecovery: boolean
}

export interface MainWorldRequest {
	type: 'QUESTION_SOLVER_MAIN_WORLD'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	kind: 'request'
	identity: RunIdentity
	requestId: string
	parentRequestId: string
	phase: 'business' | 'cleanup'
	leaseToken: string
	target: FrameRef
	adapter: AdapterRef
	operationId: MainWorldOperationId
	transactionId?: string
	snapshotDigestVersion?: 1
	snapshotDigest?: string
	questionFingerprint?: string
	args: JsonValue
}

export interface SolverRecoveryRequest {
	type: 'QUESTION_SOLVER_RECOVERY'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	recoveryId: string
	runId: string
	operation: 'inventory' | 'state_restore' | 'verify' | 'visual_restore' | 'embedded_disarm'
	recoveryCapability: string
	target: FrameRef
	transactionId?: string
	snapshotDigestVersion?: 1
	snapshotDigest?: string
}

export type QuestionSolverLeaseMessage =
	| {
			type: 'QUESTION_SOLVER_LEASE'
			protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
			operation: 'register'
			taskId: string
			taskEpoch: number
			leaseToken: string
			managedTabIds: number[]
			targetTabId: number | null
	  }
	| {
			type: 'QUESTION_SOLVER_LEASE'
			protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
			operation: 'update' | 'revoke'
			taskId: string
			taskEpoch: number
			leaseToken: string
			managedTabIds?: number[]
			targetTabId?: number | null
	  }

export type QuestionSolverRunMessage =
	| {
			type: 'QUESTION_SOLVER_RUN'
			protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
			operation: 'begin'
			identity: RunIdentity
			leaseToken: string
			tabId: number
			action: 'inspect' | 'answer' | 'fill'
			scope: 'visible' | 'current_page' | 'all_pages'
	  }
	| {
			type: 'QUESTION_SOLVER_RUN'
			protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
			operation: 'cancel' | 'enter_cleanup' | 'finish'
			identity: RunIdentity
			leaseToken: string
			cleanupVerified?: boolean
	  }

export interface QuestionSolverDiscoverMessage {
	type: 'QUESTION_SOLVER_DISCOVER'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	identity: RunIdentity
	leaseToken: string
	tabId: number
}

export interface QuestionSolverDiscoverResult {
	frames: FrameRef[]
	incompleteFrameIds: number[]
}

export interface QuestionSolverFrameGeometryRequest {
	type: 'QUESTION_SOLVER_FRAME_GEOMETRY'
	protocolVersion: typeof QUESTION_SOLVER_PROTOCOL_VERSION
	nonce: string
}

export interface QuestionSolverFrameGeometryResult {
	contentLeftCssPx: number
	contentTopCssPx: number
	scaleX: number
	scaleY: number
	parentViewportCssPx: { width: number; height: number }
	fullyVisibleInParent: boolean
	occluded: boolean
}

export interface SolverWireError {
	domain:
		| 'protocol'
		| 'detect'
		| 'extract'
		| 'embedded'
		| 'image'
		| 'fill'
		| 'verify'
		| 'navigation'
		| 'interrupt'
		| 'privacy'
	code: string
	message: string
	retryable: boolean
	requiresTakeover: boolean
}

export type SolverResponse<T extends JsonValue = JsonValue> =
	| {
			ok: true
			identity: RunIdentity
			requestId: string
			requestSeq: number
			laneKey?: string
			generation?: number
			targetDocumentToken: string
			data: T
	  }
	| {
			ok: false
			identity: RunIdentity
			requestId: string
			requestSeq: number
			laneKey?: string
			generation?: number
			targetDocumentToken?: string
			error: SolverWireError
	  }

export type MainWorldResponse<T extends JsonValue = JsonValue> =
	| {
			ok: true
			identity: RunIdentity
			requestId: string
			parentRequestId: string
			targetDocumentToken: string
			data: T
	  }
	| {
			ok: false
			identity: RunIdentity
			requestId: string
			parentRequestId: string
			targetDocumentToken?: string
			error: Omit<SolverWireError, 'requiresTakeover'> & { requiresTakeover: false }
	  }

export class QuestionSolverProtocolError extends Error {
	constructor(readonly code: string) {
		super(code)
		this.name = 'QuestionSolverProtocolError'
	}
}

const boundedString = z.string().min(1).max(256)
const identitySchema = z
	.object({
		taskId: boundedString,
		taskEpoch: z.number().int().nonnegative(),
		runId: boundedString,
	})
	.strict()
const frameSchema = z
	.object({
		tabId: z.number().int().nonnegative(),
		frameId: z.number().int(),
		parentFrameId: z.number().int(),
		documentId: boundedString.optional(),
		documentToken: boundedString,
		urlFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict()
const adapterSchema = z
	.object({ platform: boundedString, variant: boundedString, version: z.number().int().positive() })
	.strict()

const solverRequestSchema = z
	.object({
		type: z.literal('QUESTION_SOLVER_CONTROL'),
		protocolVersion: z.literal(QUESTION_SOLVER_PROTOCOL_VERSION),
		kind: z.literal('request'),
		identity: identitySchema,
		requestId: boundedString,
		requestSeq: z.number().int().nonnegative(),
		laneKey: boundedString.optional(),
		generation: z.number().int().nonnegative().optional(),
		supersedesRequestId: boundedString.optional(),
		phase: z.enum(['business', 'cleanup']).optional(),
		leaseToken: z.string().min(32).max(512),
		target: frameSchema,
		adapter: adapterSchema.optional(),
		operation: z.enum(SOLVER_OPERATIONS),
		payload: z.unknown().optional(),
	})
	.strict()

const cancelSchema = z
	.object({
		type: z.literal('QUESTION_SOLVER_CONTROL'),
		protocolVersion: z.literal(QUESTION_SOLVER_PROTOCOL_VERSION),
		kind: z.literal('cancel'),
		identity: identitySchema,
		leaseToken: z.string().min(32).max(512),
		reason: z.enum(['user', 'abort_signal', 'task_replaced', 'navigation', 'interrupt']),
	})
	.strict()

const releaseSchema = z
	.object({
		type: z.literal('QUESTION_SOLVER_RELEASE'),
		protocolVersion: z.literal(QUESTION_SOLVER_PROTOCOL_VERSION),
		identity: identitySchema,
		target: frameSchema,
		preserveRecovery: z.boolean(),
	})
	.strict()

const mainWorldRequestSchema = z
	.object({
		type: z.literal('QUESTION_SOLVER_MAIN_WORLD'),
		protocolVersion: z.literal(QUESTION_SOLVER_PROTOCOL_VERSION),
		kind: z.literal('request'),
		identity: identitySchema,
		requestId: boundedString,
		parentRequestId: boundedString,
		phase: z.enum(['business', 'cleanup']),
		leaseToken: z.string().min(32).max(512),
		target: frameSchema,
		adapter: adapterSchema,
		operationId: z.enum(MAIN_WORLD_OPERATION_IDS),
		transactionId: boundedString.optional(),
		snapshotDigestVersion: z.literal(1).optional(),
		snapshotDigest: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		questionFingerprint: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		args: z.unknown(),
	})
	.strict()

export function parseSolverControlRequest(value: unknown): SolverRequest | SolverCancelRequest {
	const kind = isRecord(value) ? value.kind : undefined
	const result =
		kind === 'cancel' ? cancelSchema.safeParse(value) : solverRequestSchema.safeParse(value)
	if (!result.success) throw new QuestionSolverProtocolError('invalid_solver_request')
	if (kind === 'cancel') return result.data as SolverCancelRequest
	const request = result.data as SolverRequest
	assertJsonValue(request.payload ?? null, false)
	const phase = request.phase ?? 'business'
	if (phase === 'cleanup' && !isCleanupOperation(request.operation)) {
		throw new QuestionSolverProtocolError('cleanup_operation_forbidden')
	}
	if (!request.target.documentId && isMutatingOperation(request.operation)) {
		throw new QuestionSolverProtocolError('document_identity_unavailable')
	}
	return request
}

export function parseSolverReleaseRequest(value: unknown): SolverReleaseRequest {
	const result = releaseSchema.safeParse(value)
	if (!result.success) throw new QuestionSolverProtocolError('invalid_solver_release')
	return result.data as SolverReleaseRequest
}

export function parseMainWorldRequest(value: unknown): MainWorldRequest {
	const result = mainWorldRequestSchema.safeParse(value)
	if (!result.success) throw new QuestionSolverProtocolError('invalid_main_world_request')
	const request = result.data as MainWorldRequest
	assertJsonValue(request.args, false)
	assertNoExecutablePayload(request.args)
	if (isSetterOperation(request.operationId)) {
		if (
			!request.target.documentId ||
			!request.transactionId ||
			request.snapshotDigestVersion !== 1 ||
			!request.snapshotDigest ||
			!request.questionFingerprint
		) {
			throw new QuestionSolverProtocolError('setter_effect_metadata_required')
		}
	}
	return request
}

export function assertMainWorldParentAllows(
	parentOperation: SolverOperation,
	operationId: MainWorldOperationId,
): void {
	if (!(PARENT_OPERATION_TO_MAIN_WORLD_IDS[parentOperation] ?? []).includes(operationId)) {
		throw new QuestionSolverProtocolError('main_world_parent_operation_mismatch')
	}
}

export function isCleanupOperation(operation: SolverOperation): boolean {
	return (SOLVER_CLEANUP_OPERATIONS as readonly string[]).includes(operation)
}

export function isMutatingOperation(operation: SolverOperation): boolean {
	return (SOLVER_MUTATING_OPERATIONS as readonly string[]).includes(operation)
}

export function isSetterOperation(
	operationId: MainWorldOperationId,
): operationId is (typeof MAIN_WORLD_SETTER_IDS)[number] {
	return (MAIN_WORLD_SETTER_IDS as readonly string[]).includes(operationId)
}

export function assertJsonValue(
	value: unknown,
	allowImageEnvelope: boolean,
): asserts value is JsonValue {
	let serializedBytes = 0
	walk(value, 0)
	if (serializedBytes > 256 * 1024) {
		throw new QuestionSolverProtocolError('wire_payload_too_large')
	}

	function walk(candidate: unknown, depth: number): void {
		if (depth > 32) throw new QuestionSolverProtocolError('wire_payload_too_deep')
		if (
			candidate === null ||
			typeof candidate === 'boolean' ||
			(typeof candidate === 'number' && Number.isFinite(candidate))
		) {
			serializedBytes += 16
			return
		}
		if (typeof candidate === 'string') {
			serializedBytes += new TextEncoder().encode(candidate).byteLength
			if (!allowImageEnvelope && /data:image\/[^;]+;base64,/i.test(candidate)) {
				throw new QuestionSolverProtocolError('embedded_image_payload_forbidden')
			}
			return
		}
		if (Array.isArray(candidate)) {
			for (const entry of candidate) walk(entry, depth + 1)
			return
		}
		if (!isRecord(candidate)) throw new QuestionSolverProtocolError('wire_payload_not_json')
		if (candidate.kind === 'question_solver_image_asset' && !allowImageEnvelope) {
			throw new QuestionSolverProtocolError('image_envelope_channel_forbidden')
		}
		for (const [key, entry] of Object.entries(candidate)) {
			if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
				throw new QuestionSolverProtocolError('wire_payload_key_forbidden')
			}
			serializedBytes += key.length
			walk(entry, depth + 1)
		}
	}
}

export function isInternalImageEnvelope(value: unknown): value is InternalImageEnvelope {
	return isRecord(value) && value.kind === 'question_solver_image_asset'
}

function assertNoExecutablePayload(value: unknown): void {
	if (Array.isArray(value)) {
		for (const entry of value) assertNoExecutablePayload(entry)
		return
	}
	if (!isRecord(value)) return
	for (const [key, entry] of Object.entries(value)) {
		if (/^(?:script|javascript|function|functionSource|code|sourceText)$/i.test(key)) {
			throw new QuestionSolverProtocolError('executable_payload_forbidden')
		}
		assertNoExecutablePayload(entry)
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
