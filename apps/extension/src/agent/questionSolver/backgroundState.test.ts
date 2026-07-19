import { describe, expect, it } from 'vitest'

import {
	QUESTION_SOLVER_BACKGROUND_STATE_KEY,
	QuestionSolverBackgroundState,
	QuestionSolverBackgroundStateError,
	type SessionStorageLike,
} from './backgroundState'
import type { RunIdentity } from './contracts'

const LEASE = 'lease-token-that-is-at-least-thirty-two-characters'
const RECOVERY = 'recovery-capability-that-never-leaves-background'
const IDENTITY: RunIdentity = { taskId: 'task', taskEpoch: 1, runId: 'run-1' }

describe('QuestionSolverBackgroundState', () => {
	it('hashes task leases and validates managed tabs without persisting raw secrets', async () => {
		const storage = new MemorySessionStorage()
		const state = new QuestionSolverBackgroundState(storage, () => 1_000)
		await state.registerTaskLease({
			taskId: 'task',
			taskEpoch: 1,
			leaseToken: LEASE,
			managedTabIds: [1, 2],
			targetTabId: 1,
		})
		await expect(state.validateLease(IDENTITY, LEASE, 2)).resolves.toBeUndefined()
		await expect(state.validateLease(IDENTITY, `${LEASE}-forged`, 1)).rejects.toMatchObject({
			code: 'task_lease_mismatch',
		})
		await expect(state.validateLease(IDENTITY, LEASE, 3)).rejects.toMatchObject({
			code: 'tab_not_managed',
		})
		const persisted = JSON.stringify(storage.values[QUESTION_SOLVER_BACKGROUND_STATE_KEY])
		expect(persisted).not.toContain(LEASE)
		expect(persisted).not.toContain(RECOVERY)
	})

	it('derives a fixed 256-bit recovery capability retained by background only', async () => {
		const state = new QuestionSolverBackgroundState()
		await registerLease(state)
		const admission = await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'fill',
			scope: 'current_page',
		})
		const capability = await state.getRecoveryCapability(IDENTITY)

		expect(capability).toMatch(/^[a-f0-9]{64}$/)
		expect(admission.recoveryCapabilityHash).toMatch(/^[a-f0-9]{64}$/)
		expect(capability).not.toContain(IDENTITY.taskId)
		expect(capability).not.toContain(IDENTITY.runId)
	})

	it('fails closed without overwriting malformed nested session state', async () => {
		const storage = new MemorySessionStorage()
		const malformed = {
			version: 1,
			salt: 'a'.repeat(64),
			leases: [{ taskId: 'task', taskEpoch: 'forged' }],
			runs: [],
		}
		storage.values[QUESTION_SOLVER_BACKGROUND_STATE_KEY] = malformed
		const state = new QuestionSolverBackgroundState(storage)

		await expect(state.initialize()).rejects.toMatchObject({
			code: 'stored_state_invalid',
		})
		expect(storage.values[QUESTION_SOLVER_BACKGROUND_STATE_KEY]).toEqual(malformed)
	})

	it('binds one-shot frame challenges to the actual sender and exact document', async () => {
		let now = 1_000
		const state = new QuestionSolverBackgroundState(undefined, () => now)
		await registerLease(state)
		const nonce = await state.createFrameChallenge({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			frameId: 7,
			parentFrameId: 0,
			documentId: 'document-7',
		})
		const register = {
			type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER' as const,
			protocolVersion: 1 as const,
			nonce,
			documentToken: 'document-token-7',
			urlFingerprint: 'a'.repeat(64),
		}
		expect(() =>
			state.consumeFrameChallenge(register, {
				tab: { id: 2 } as chrome.tabs.Tab,
				frameId: 7,
				documentId: 'document-7',
			}),
		).toThrowError('frame_challenge_sender_mismatch')
		expect(() =>
			state.consumeFrameChallenge(register, {
				tab: { id: 1 } as chrome.tabs.Tab,
				frameId: 7,
				documentId: 'document-7',
			}),
		).toThrowError('frame_challenge_expired')

		const validNonce = await state.createFrameChallenge({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			frameId: 7,
			parentFrameId: 0,
			documentId: 'document-7',
		})
		const frame = state.consumeFrameChallenge(
			{ ...register, nonce: validNonce },
			{
				tab: { id: 1 } as chrome.tabs.Tab,
				frameId: 7,
				documentId: 'document-7',
			},
		)
		expect(frame).toMatchObject({ tabId: 1, frameId: 7, parentFrameId: 0 })
		expect(() => state.validateFrame(frame, IDENTITY)).not.toThrow()
		now += 6_000
		const expired = await state.createFrameChallenge({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			frameId: 8,
			parentFrameId: 0,
		})
		now += 6_000
		expect(() =>
			state.consumeFrameChallenge(
				{ ...register, nonce: expired },
				{ tab: { id: 1 } as chrome.tabs.Tab, frameId: 8 },
			),
		).toThrowError('frame_challenge_expired')
	})

	it('keeps mutation ownership through a late effect quarantine', async () => {
		const state = new QuestionSolverBackgroundState()
		await registerLease(state)
		await begin(state, IDENTITY)
		await state.acquireMutationOwner(IDENTITY)
		await state.recordEffectDispatch(IDENTITY, {
			requestId: 'effect-1',
			parentRequestId: 'parent-1',
			operation: 'common.native_input_set',
			tabId: 1,
			documentId: 'document-1',
			documentToken: 'token-1',
			transactionId: 'tx-1',
			snapshotDigest: 'a'.repeat(64),
			questionFingerprint: 'b'.repeat(64),
		})
		expect(await state.finishRun(IDENTITY, false)).toBe('quarantined')
		expect(state.getMutationOwner(1)).toBe('run-1')

		const second = { ...IDENTITY, runId: 'run-2' }
		await begin(state, second)
		await expect(state.acquireMutationOwner(second)).rejects.toMatchObject({
			code: 'tab_owned_by_other_run',
		})
		await state.settleEffect(IDENTITY, 'effect-1')
		await state.completeQuarantineRecovery(IDENTITY, true)
		expect(state.getMutationOwner(1)).toBeUndefined()
		await expect(state.acquireMutationOwner(second)).resolves.toBeUndefined()
	})

	it('rehydrates unsettled effects fail-closed and releases only on authoritative invalidation', async () => {
		const storage = new MemorySessionStorage()
		const first = new QuestionSolverBackgroundState(storage, () => 1_000)
		await registerLease(first)
		await begin(first, IDENTITY)
		await first.acquireMutationOwner(IDENTITY)
		await first.recordEffectDispatch(IDENTITY, {
			requestId: 'effect-1',
			operation: 'fill',
			tabId: 1,
			documentId: 'document-1',
			documentToken: 'token-1',
		})
		expect(JSON.stringify(storage.values[QUESTION_SOLVER_BACKGROUND_STATE_KEY])).not.toContain(
			'"documentToken":"token-1"',
		)

		const rehydrated = new QuestionSolverBackgroundState(storage, () => 2_000)
		await rehydrated.initialize()
		expect(rehydrated.getRunLifecycle('run-1')).toBe('quarantined')
		expect(rehydrated.getMutationOwner(1)).toBe('run-1')
		await rehydrated.invalidateDocument(1, 'document-1')
		expect(rehydrated.getRunLifecycle('run-1')).toBe('closed')
		expect(rehydrated.getMutationOwner(1)).toBeUndefined()
	})

	it('rejects effect dispatch without mutation ownership', async () => {
		const state = new QuestionSolverBackgroundState()
		await registerLease(state)
		await begin(state, IDENTITY)
		await expect(
			state.recordEffectDispatch(IDENTITY, {
				requestId: 'effect-1',
				operation: 'fill',
				tabId: 1,
				documentId: 'document-1',
				documentToken: 'token-1',
			}),
		).rejects.toBeInstanceOf(QuestionSolverBackgroundStateError)
	})
})

async function registerLease(state: QuestionSolverBackgroundState): Promise<void> {
	await state.registerTaskLease({
		taskId: 'task',
		taskEpoch: 1,
		leaseToken: LEASE,
		managedTabIds: [1],
		targetTabId: 1,
	})
}

async function begin(state: QuestionSolverBackgroundState, identity: RunIdentity): Promise<void> {
	await state.beginRun({
		identity,
		leaseToken: LEASE,
		tabId: 1,
		action: 'fill',
		scope: 'current_page',
		recoveryCapability: RECOVERY,
	})
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
