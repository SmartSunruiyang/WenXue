import * as z from 'zod/v4'

import type { FrameRef, QuestionSolverAction, QuestionSolverScope, RunIdentity } from './contracts'
import { sha256Hex } from './fingerprints'
import type { FrameHelloRegister, SolverOperation } from './protocol'

export const QUESTION_SOLVER_BACKGROUND_STATE_KEY = 'questionSolverBackgroundState.v1'
const STATE_VERSION = 1 as const
const CHALLENGE_TTL_MS = 5_000
const ACTIVE_TTL_MS = 15 * 60_000

export interface SessionStorageLike {
	get(key: string): Promise<Record<string, unknown>>
	set(values: Record<string, unknown>): Promise<void>
	remove(key: string): Promise<void>
}

export interface TaskLeaseRegistration {
	taskId: string
	taskEpoch: number
	leaseToken: string
	managedTabIds: number[]
	targetTabId: number | null
}

export interface EffectLedgerEntry {
	requestId: string
	parentRequestId?: string
	operation: string
	tabId: number
	documentId: string
	documentTokenHash: string
	transactionId?: string
	snapshotDigest?: string
	questionFingerprint?: string
	dispatched: boolean
	settled: boolean
	settledAs?: 'completed' | 'restored' | 'document_invalidated'
}

export interface QuarantineRecoveryBatch {
	identity: RunIdentity
	effects: EffectLedgerEntry[]
}

type RunLifecycle = 'active' | 'cancelling' | 'cleanup' | 'closed' | 'quarantined'

interface TaskLeaseRecord {
	taskId: string
	taskEpoch: number
	leaseTokenHash: string
	managedTabIds: Set<number>
	targetTabId: number | null
	updatedAt: number
}

interface RunRecord {
	identity: RunIdentity
	leaseKey: string
	tabId: number
	action: QuestionSolverAction
	scope: QuestionSolverScope
	lifecycle: RunLifecycle
	recoveryCapabilityHash: string
	effects: Map<string, EffectLedgerEntry>
	updatedAt: number
}

interface FrameChallenge {
	nonce: string
	leaseKey: string
	tabId: number
	frameId: number
	parentFrameId: number
	documentId?: string
	expiresAt: number
}

interface FrameLease {
	leaseKey: string
	frame: FrameRef
}

interface ParentRequestRecord {
	runId: string
	requestId: string
	operation: SolverOperation
	frame: FrameRef
	adapterVariant: string
	phase: 'business' | 'cleanup'
	transactionId?: string
	snapshotDigest?: string
	questionFingerprints?: string[]
}

interface StoredState {
	version: typeof STATE_VERSION
	salt: string
	leases: Array<{
		taskId: string
		taskEpoch: number
		leaseTokenHash: string
		managedTabIds: number[]
		targetTabId: number | null
		updatedAt: number
	}>
	runs: Array<{
		identity: RunIdentity
		leaseKey: string
		tabId: number
		action: QuestionSolverAction
		scope: QuestionSolverScope
		lifecycle: RunLifecycle
		recoveryCapabilityHash: string
		effects: EffectLedgerEntry[]
		updatedAt: number
	}>
}

export class QuestionSolverBackgroundStateError extends Error {
	constructor(readonly code: string) {
		super(code)
		this.name = 'QuestionSolverBackgroundStateError'
	}
}

export class QuestionSolverBackgroundState {
	private readonly leases = new Map<string, TaskLeaseRecord>()
	private readonly runs = new Map<string, RunRecord>()
	private readonly mutationOwners = new Map<number, string>()
	private readonly challenges = new Map<string, FrameChallenge>()
	private readonly frames = new Map<string, FrameLease>()
	private readonly parents = new Map<string, ParentRequestRecord>()
	private salt = ''
	private persistQueue = Promise.resolve()

	constructor(
		private readonly storage?: SessionStorageLike,
		private readonly now: () => number = Date.now,
	) {}

	async initialize(): Promise<void> {
		if (this.salt) return
		const rawStored = this.storage
			? (await this.storage.get(QUESTION_SOLVER_BACKGROUND_STATE_KEY))[
					QUESTION_SOLVER_BACKGROUND_STATE_KEY
				]
			: undefined
		if (rawStored === undefined) {
			this.salt = randomHex(32)
			await this.persist()
			return
		}
		const stored = this.normalizeStored(rawStored)
		this.salt = stored.salt
		const now = this.now()
		for (const lease of stored.leases) {
			if (now - lease.updatedAt > ACTIVE_TTL_MS) continue
			this.leases.set(leaseKey(lease.taskId, lease.taskEpoch), {
				...lease,
				managedTabIds: new Set(lease.managedTabIds),
			})
		}
		for (const storedRun of stored.runs) {
			const unsettled = storedRun.effects.some((effect) => effect.dispatched && !effect.settled)
			if (!unsettled && now - storedRun.updatedAt > ACTIVE_TTL_MS) continue
			const lifecycle: RunLifecycle = unsettled ? 'quarantined' : storedRun.lifecycle
			const run: RunRecord = {
				...storedRun,
				lifecycle,
				effects: new Map(storedRun.effects.map((effect) => [effect.requestId, effect])),
			}
			this.runs.set(run.identity.runId, run)
			if (lifecycle !== 'closed') this.mutationOwners.set(run.tabId, run.identity.runId)
		}
		await this.persist()
	}

	async registerTaskLease(registration: TaskLeaseRegistration): Promise<void> {
		await this.ensureInitialized()
		assertTaskLeaseRegistration(registration)
		const key = leaseKey(registration.taskId, registration.taskEpoch)
		this.leases.set(key, {
			taskId: registration.taskId,
			taskEpoch: registration.taskEpoch,
			leaseTokenHash: await this.hashToken(registration.leaseToken),
			managedTabIds: new Set(registration.managedTabIds),
			targetTabId: registration.targetTabId,
			updatedAt: this.now(),
		})
		await this.persist()
	}

	async updateTaskLease(
		identity: Pick<RunIdentity, 'taskId' | 'taskEpoch'>,
		leaseToken: string,
		managedTabIds: number[],
		targetTabId: number | null,
	): Promise<void> {
		const lease = await this.requireLease(identity, leaseToken)
		lease.managedTabIds = new Set(managedTabIds)
		lease.targetTabId = targetTabId
		lease.updatedAt = this.now()
		await this.persist()
	}

	async revokeTaskLease(
		identity: Pick<RunIdentity, 'taskId' | 'taskEpoch'>,
		leaseToken: string,
	): Promise<void> {
		const lease = await this.requireLease(identity, leaseToken)
		this.leases.delete(leaseKey(lease.taskId, lease.taskEpoch))
		for (const run of this.runs.values()) {
			if (run.leaseKey !== leaseKey(lease.taskId, lease.taskEpoch) || run.lifecycle === 'closed')
				continue
			if (hasUnsettledEffects(run)) {
				run.lifecycle = 'quarantined'
				this.mutationOwners.set(run.tabId, run.identity.runId)
			} else {
				this.closeRunRecord(run)
			}
		}
		await this.persist()
	}

	async beginRun(args: {
		identity: RunIdentity
		leaseToken: string
		tabId: number
		action: QuestionSolverAction
		scope: QuestionSolverScope
		/** @deprecated Recovery credentials are derived and retained by background only. */
		recoveryCapability?: string
	}): Promise<{ recoveryCapabilityHash: string }> {
		const lease = await this.requireLease(args.identity, args.leaseToken, args.tabId)
		if (this.runs.has(args.identity.runId))
			throw new QuestionSolverBackgroundStateError('run_exists')
		const recoveryCapability = await this.deriveRecoveryCapability(args.identity)
		this.runs.set(args.identity.runId, {
			identity: { ...args.identity },
			leaseKey: leaseKey(lease.taskId, lease.taskEpoch),
			tabId: args.tabId,
			action: args.action,
			scope: args.scope,
			lifecycle: 'active',
			recoveryCapabilityHash: await this.hashToken(recoveryCapability),
			effects: new Map(),
			updatedAt: this.now(),
		})
		await this.persist()
		return { recoveryCapabilityHash: await sha256Hex(recoveryCapability) }
	}

	async validateLease(
		identity: Pick<RunIdentity, 'taskId' | 'taskEpoch'>,
		leaseToken: string,
		tabId?: number,
	): Promise<void> {
		await this.requireLease(identity, leaseToken, tabId)
	}

	requireRun(identity: RunIdentity, allowed: RunLifecycle[] = ['active']): RunRecord {
		const run = this.runs.get(identity.runId)
		if (
			!run ||
			run.identity.taskId !== identity.taskId ||
			run.identity.taskEpoch !== identity.taskEpoch
		) {
			throw new QuestionSolverBackgroundStateError('run_identity_mismatch')
		}
		if (!allowed.includes(run.lifecycle)) {
			throw new QuestionSolverBackgroundStateError('run_lifecycle_mismatch')
		}
		return run
	}

	async acquireMutationOwner(identity: RunIdentity): Promise<void> {
		const run = this.requireRun(identity, ['active', 'cleanup'])
		const owner = this.mutationOwners.get(run.tabId)
		if (owner && owner !== identity.runId) {
			throw new QuestionSolverBackgroundStateError('tab_owned_by_other_run')
		}
		if (owner === identity.runId) return
		this.mutationOwners.set(run.tabId, identity.runId)
		run.updatedAt = this.now()
		await this.persist()
	}

	async cancelRun(identity: RunIdentity): Promise<void> {
		const run = this.requireRun(identity, ['active', 'cancelling'])
		run.lifecycle = 'cancelling'
		run.updatedAt = this.now()
		await this.persist()
	}

	async enterCleanup(identity: RunIdentity): Promise<void> {
		const run = this.requireRun(identity, ['active', 'cancelling', 'cleanup'])
		run.lifecycle = 'cleanup'
		run.updatedAt = this.now()
		await this.persist()
	}

	async finishRun(identity: RunIdentity, cleanupVerified: boolean): Promise<RunLifecycle> {
		const run = this.requireRun(identity, ['active', 'cancelling', 'cleanup', 'quarantined'])
		if (hasUnsettledEffects(run) || !cleanupVerified) {
			run.lifecycle = 'quarantined'
			this.mutationOwners.set(run.tabId, run.identity.runId)
		} else {
			this.closeRunRecord(run)
		}
		run.updatedAt = this.now()
		await this.persist()
		return run.lifecycle
	}

	async recordEffectDispatch(
		identity: RunIdentity,
		effect: Omit<EffectLedgerEntry, 'documentTokenHash' | 'dispatched' | 'settled'> & {
			documentToken: string
		},
	): Promise<void> {
		const run = this.requireRun(identity, ['active', 'cleanup'])
		if (this.mutationOwners.get(run.tabId) !== identity.runId) {
			throw new QuestionSolverBackgroundStateError('mutation_owner_required')
		}
		if (effect.tabId !== run.tabId || !effect.documentId) {
			throw new QuestionSolverBackgroundStateError('effect_document_mismatch')
		}
		if (run.effects.has(effect.requestId)) {
			throw new QuestionSolverBackgroundStateError('effect_request_reused')
		}
		const { documentToken, ...persistedEffect } = effect
		run.effects.set(effect.requestId, {
			...persistedEffect,
			documentTokenHash: await sha256Hex(documentToken),
			dispatched: true,
			settled: false,
		})
		run.updatedAt = this.now()
		await this.persist()
	}

	async settleEffect(identity: RunIdentity, requestId: string): Promise<void> {
		const run = this.requireRun(identity, ['active', 'cancelling', 'cleanup', 'quarantined'])
		const effect = run.effects.get(requestId)
		if (!effect) throw new QuestionSolverBackgroundStateError('effect_unknown')
		run.effects.delete(requestId)
		run.updatedAt = this.now()
		await this.persist()
	}

	async settleEffectsByOperation(
		identity: RunIdentity,
		operation: string,
		target: FrameRef,
	): Promise<number> {
		const run = this.requireRun(identity, ['active', 'cancelling', 'cleanup', 'quarantined'])
		if (!target.documentId || target.tabId !== run.tabId) {
			throw new QuestionSolverBackgroundStateError('effect_document_mismatch')
		}
		const documentTokenHash = await sha256Hex(target.documentToken)
		let settled = 0
		for (const [requestId, effect] of run.effects) {
			if (
				effect.operation !== operation ||
				effect.documentId !== target.documentId ||
				!constantTimeEqual(effect.documentTokenHash, documentTokenHash)
			) {
				continue
			}
			run.effects.delete(requestId)
			settled++
		}
		if (settled > 0) {
			run.updatedAt = this.now()
			await this.persist()
		}
		return settled
	}

	async completeQuarantineRecovery(identity: RunIdentity, verified: boolean): Promise<void> {
		const run = this.requireRun(identity, ['quarantined'])
		if (!verified || hasUnsettledEffects(run)) {
			throw new QuestionSolverBackgroundStateError('quarantine_recovery_incomplete')
		}
		this.closeRunRecord(run)
		await this.persist()
	}

	async invalidateDocument(tabId: number, documentId?: string): Promise<void> {
		for (const run of this.runs.values()) {
			if (run.tabId !== tabId || run.lifecycle === 'closed') continue
			for (const effect of run.effects.values()) {
				if (!effect.settled && (!documentId || effect.documentId === documentId)) {
					effect.settled = true
					effect.settledAs = 'document_invalidated'
				}
			}
			if (run.lifecycle === 'quarantined' && !hasUnsettledEffects(run)) this.closeRunRecord(run)
		}
		for (const [key, lease] of this.frames) {
			if (lease.frame.tabId === tabId && (!documentId || lease.frame.documentId === documentId)) {
				this.frames.delete(key)
			}
		}
		await this.persist()
	}

	async createFrameChallenge(args: {
		identity: Pick<RunIdentity, 'taskId' | 'taskEpoch'>
		leaseToken: string
		tabId: number
		frameId: number
		parentFrameId: number
		documentId?: string
	}): Promise<string> {
		const lease = await this.requireLease(args.identity, args.leaseToken, args.tabId)
		const nonce = randomHex(24)
		this.challenges.set(nonce, {
			nonce,
			leaseKey: leaseKey(lease.taskId, lease.taskEpoch),
			tabId: args.tabId,
			frameId: args.frameId,
			parentFrameId: args.parentFrameId,
			documentId: args.documentId,
			expiresAt: this.now() + CHALLENGE_TTL_MS,
		})
		return nonce
	}

	consumeFrameChallenge(
		register: FrameHelloRegister,
		sender: Pick<chrome.runtime.MessageSender, 'tab' | 'frameId' | 'documentId'>,
	): FrameRef {
		const challenge = this.challenges.get(register.nonce)
		this.challenges.delete(register.nonce)
		if (!challenge || challenge.expiresAt < this.now()) {
			throw new QuestionSolverBackgroundStateError('frame_challenge_expired')
		}
		const tabId = sender.tab?.id
		const frameId = sender.frameId
		if (
			tabId !== challenge.tabId ||
			frameId !== challenge.frameId ||
			(challenge.documentId && sender.documentId !== challenge.documentId) ||
			!this.leases.has(challenge.leaseKey) ||
			!/^[a-f0-9]{64}$/.test(register.urlFingerprint)
		) {
			throw new QuestionSolverBackgroundStateError('frame_challenge_sender_mismatch')
		}
		const frame: FrameRef = {
			tabId,
			frameId,
			parentFrameId: challenge.parentFrameId,
			documentId: sender.documentId,
			documentToken: register.documentToken,
			urlFingerprint: register.urlFingerprint,
		}
		this.frames.set(frameKey(frame), { leaseKey: challenge.leaseKey, frame })
		return frame
	}

	validateFrame(target: FrameRef, identity: Pick<RunIdentity, 'taskId' | 'taskEpoch'>): void {
		const lease = this.frames.get(frameKey(target))
		if (!lease || lease.leaseKey !== leaseKey(identity.taskId, identity.taskEpoch)) {
			throw new QuestionSolverBackgroundStateError('frame_lease_mismatch')
		}
		if (!sameFrame(lease.frame, target)) {
			throw new QuestionSolverBackgroundStateError('frame_identity_mismatch')
		}
	}

	listFrames(identity: Pick<RunIdentity, 'taskId' | 'taskEpoch'>, tabId?: number): FrameRef[] {
		const key = leaseKey(identity.taskId, identity.taskEpoch)
		return [...this.frames.values()]
			.filter(
				(entry) => entry.leaseKey === key && (tabId === undefined || entry.frame.tabId === tabId),
			)
			.map((entry) => ({ ...entry.frame }))
			.sort((left, right) => left.frameId - right.frameId)
	}

	registerParentRequest(record: ParentRequestRecord): void {
		const key = parentKey(record.runId, record.requestId)
		if (this.parents.has(key)) throw new QuestionSolverBackgroundStateError('parent_request_reused')
		this.parents.set(key, record)
	}

	requireParentRequest(runId: string, requestId: string): ParentRequestRecord {
		const parent = this.parents.get(parentKey(runId, requestId))
		if (!parent) throw new QuestionSolverBackgroundStateError('parent_request_inactive')
		return parent
	}

	closeParentRequest(runId: string, requestId: string): void {
		this.parents.delete(parentKey(runId, requestId))
	}

	getRunLifecycle(runId: string): RunLifecycle | undefined {
		return this.runs.get(runId)?.lifecycle
	}

	getMutationOwner(tabId: number): string | undefined {
		return this.mutationOwners.get(tabId)
	}

	getEffect(runId: string, requestId: string): EffectLedgerEntry | undefined {
		const effect = this.runs.get(runId)?.effects.get(requestId)
		return effect ? { ...effect } : undefined
	}

	async listQuarantineRecoveries(frame: FrameRef): Promise<QuarantineRecoveryBatch[]> {
		await this.ensureInitialized()
		const documentTokenHash = await sha256Hex(frame.documentToken)
		const batches: QuarantineRecoveryBatch[] = []
		for (const run of this.runs.values()) {
			if (run.lifecycle !== 'quarantined' || run.tabId !== frame.tabId) continue
			const effects = [...run.effects.values()].filter(
				(effect) =>
					!effect.settled &&
					effect.documentId === frame.documentId &&
					constantTimeEqual(effect.documentTokenHash, documentTokenHash),
			)
			if (effects.length > 0) batches.push({ identity: { ...run.identity }, effects })
		}
		return batches
	}

	getRunBinding(runId: string):
		| {
				identity: RunIdentity
				tabId: number
				action: QuestionSolverAction
				scope: QuestionSolverScope
				lifecycle: RunLifecycle
		  }
		| undefined {
		const run = this.runs.get(runId)
		return run
			? {
					identity: { ...run.identity },
					tabId: run.tabId,
					action: run.action,
					scope: run.scope,
					lifecycle: run.lifecycle,
				}
			: undefined
	}

	async getRecoveryCapability(identity: RunIdentity): Promise<string> {
		await this.ensureInitialized()
		const run = this.requireRun(identity, ['active', 'cancelling', 'cleanup', 'quarantined'])
		const capability = await this.deriveRecoveryCapability(identity)
		if (!constantTimeEqual(run.recoveryCapabilityHash, await this.hashToken(capability))) {
			throw new QuestionSolverBackgroundStateError('recovery_capability_unavailable')
		}
		return capability
	}

	private async requireLease(
		identity: Pick<RunIdentity, 'taskId' | 'taskEpoch'>,
		leaseToken: string,
		tabId?: number,
	): Promise<TaskLeaseRecord> {
		await this.ensureInitialized()
		const lease = this.leases.get(leaseKey(identity.taskId, identity.taskEpoch))
		const hash = await this.hashToken(leaseToken)
		if (!lease || !constantTimeEqual(lease.leaseTokenHash, hash)) {
			throw new QuestionSolverBackgroundStateError('task_lease_mismatch')
		}
		if (tabId !== undefined && !lease.managedTabIds.has(tabId)) {
			throw new QuestionSolverBackgroundStateError('tab_not_managed')
		}
		return lease
	}

	private closeRunRecord(run: RunRecord): void {
		run.lifecycle = 'closed'
		if (this.mutationOwners.get(run.tabId) === run.identity.runId) {
			this.mutationOwners.delete(run.tabId)
		}
	}

	private async ensureInitialized(): Promise<void> {
		if (!this.salt) await this.initialize()
	}

	private hashToken(token: string): Promise<string> {
		return sha256Hex(`${this.salt}\0${token}`)
	}

	private deriveRecoveryCapability(identity: RunIdentity): Promise<string> {
		if (!this.salt) throw new QuestionSolverBackgroundStateError('background_not_initialized')
		return sha256Hex(
			`${this.salt}\0${identity.taskId}\0${identity.taskEpoch}\0${identity.runId}\0question-solver-recovery-v1`,
		)
	}

	private persist(): Promise<void> {
		if (!this.storage) return Promise.resolve()
		const snapshot: StoredState = {
			version: STATE_VERSION,
			salt: this.salt,
			leases: [...this.leases.values()].map((lease) => ({
				...lease,
				managedTabIds: [...lease.managedTabIds],
			})),
			runs: [...this.runs.values()]
				.filter((run) => run.lifecycle !== 'closed')
				.map((run) => ({ ...run, effects: [...run.effects.values()] })),
		}
		const write = this.persistQueue.then(() =>
			this.storage!.set({ [QUESTION_SOLVER_BACKGROUND_STATE_KEY]: snapshot }),
		)
		this.persistQueue = write.catch(() => undefined)
		return write
	}

	private normalizeStored(value: unknown): StoredState {
		const parsed = storedStateSchema.safeParse(value)
		if (!parsed.success) {
			throw new QuestionSolverBackgroundStateError('stored_state_invalid')
		}
		return parsed.data as StoredState
	}
}

const runIdentitySchema = z
	.object({
		taskId: z.string().min(1),
		taskEpoch: z.number().int().nonnegative(),
		runId: z.string().min(1),
	})
	.strict()

const effectLedgerEntrySchema = z
	.object({
		requestId: z.string().min(1),
		parentRequestId: z.string().min(1).optional(),
		operation: z.string().min(1),
		tabId: z.number().int().nonnegative(),
		documentId: z.string().min(1),
		documentTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
		transactionId: z.string().min(1).optional(),
		snapshotDigest: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		questionFingerprint: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		dispatched: z.boolean(),
		settled: z.boolean(),
		settledAs: z.enum(['completed', 'restored', 'document_invalidated']).optional(),
	})
	.strict()

const storedStateSchema = z
	.object({
		version: z.literal(STATE_VERSION),
		salt: z.string().regex(/^[a-f0-9]{64}$/),
		leases: z.array(
			z
				.object({
					taskId: z.string().min(1),
					taskEpoch: z.number().int().nonnegative(),
					leaseTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
					managedTabIds: z.array(z.number().int().nonnegative()),
					targetTabId: z.number().int().nonnegative().nullable(),
					updatedAt: z.number().finite(),
				})
				.strict(),
		),
		runs: z.array(
			z
				.object({
					identity: runIdentitySchema,
					leaseKey: z.string().min(1),
					tabId: z.number().int().nonnegative(),
					action: z.enum(['inspect', 'answer', 'fill']),
					scope: z.enum(['visible', 'current_page', 'all_pages']),
					lifecycle: z.enum(['active', 'cancelling', 'cleanup', 'closed', 'quarantined']),
					recoveryCapabilityHash: z.string().regex(/^[a-f0-9]{64}$/),
					effects: z.array(effectLedgerEntrySchema),
					updatedAt: z.number().finite(),
				})
				.strict(),
		),
	})
	.strict()

function assertTaskLeaseRegistration(value: TaskLeaseRegistration): void {
	if (
		!value.taskId ||
		!Number.isInteger(value.taskEpoch) ||
		value.taskEpoch < 0 ||
		value.leaseToken.length < 32 ||
		value.managedTabIds.some((tabId) => !Number.isInteger(tabId) || tabId < 0) ||
		(value.targetTabId !== null && !value.managedTabIds.includes(value.targetTabId))
	) {
		throw new QuestionSolverBackgroundStateError('invalid_task_lease')
	}
}

function hasUnsettledEffects(run: RunRecord): boolean {
	return [...run.effects.values()].some((effect) => effect.dispatched && !effect.settled)
}

function sameFrame(left: FrameRef, right: FrameRef): boolean {
	return (
		left.tabId === right.tabId &&
		left.frameId === right.frameId &&
		left.parentFrameId === right.parentFrameId &&
		left.documentId === right.documentId &&
		left.documentToken === right.documentToken &&
		left.urlFingerprint === right.urlFingerprint
	)
}

function frameKey(frame: Pick<FrameRef, 'tabId' | 'frameId' | 'documentId'>): string {
	return `${frame.tabId}\0${frame.frameId}\0${frame.documentId ?? ''}`
}

function leaseKey(taskId: string, taskEpoch: number): string {
	return `${taskId}\0${taskEpoch}`
}

function parentKey(runId: string, requestId: string): string {
	return `${runId}\0${requestId}`
}

function randomHex(bytes: number): string {
	const value = new Uint8Array(bytes)
	crypto.getRandomValues(value)
	return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string): boolean {
	if (left.length !== right.length) return false
	let difference = 0
	for (let index = 0; index < left.length; index++) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
	}
	return difference === 0
}
