// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { AnchorRegistry, PendingControlJournal } from './contentState'
import type { ControlSnapshot } from './contracts'
import { createControlSnapshotDigest, sha256Hex } from './fingerprints'

describe('AnchorRegistry', () => {
	it('binds DOM handles to run, document and question ownership', () => {
		document.body.innerHTML = '<img id="diagram">'
		const registry = new AnchorRegistry(
			() => 0,
			() => 'anchor-1',
		)
		const anchors = registry.forRun('run-1', 'document-1')
		const anchorKey = anchors.registerImage({
			questionFingerprint: 'question-1',
			role: 'stem',
			element: document.querySelector('#diagram')!,
		})
		expect(
			registry.resolve({
				runId: 'run-1',
				documentToken: 'document-1',
				questionFingerprint: 'question-1',
				anchorKey,
			}),
		).toBe(document.querySelector('#diagram'))
		expect(() =>
			registry.resolve({
				runId: 'run-2',
				documentToken: 'document-1',
				questionFingerprint: 'question-1',
				anchorKey,
			}),
		).toThrowError('image_anchor_mismatch')
	})

	it('expires anchors and drops detached elements', () => {
		let now = 0
		document.body.innerHTML = '<img id="diagram">'
		const registry = new AnchorRegistry(
			() => now,
			() => 'anchor-1',
		)
		registry.forRun('run', 'doc').registerImage({
			questionFingerprint: 'q',
			role: 'option',
			optionKey: 'A',
			element: document.querySelector('#diagram')!,
		})
		expect(registry.size()).toBe(1)
		document.querySelector('#diagram')?.remove()
		expect(registry.size()).toBe(0)
		document.body.innerHTML = '<img id="diagram">'
		registry.forRun('run', 'doc').registerImage({
			questionFingerprint: 'q',
			role: 'stem',
			element: document.querySelector('#diagram')!,
		})
		now = 60_001
		expect(registry.size()).toBe(0)
	})
})

describe('PendingControlJournal', () => {
	it('admits only digest-valid snapshots and returns isolated clones', async () => {
		const journal = new PendingControlJournal(() => 0)
		const snapshot = await createSnapshot()
		await journal.admit({ runId: 'run', documentToken: 'doc', snapshot })
		const restored = journal.require({
			runId: 'run',
			documentToken: 'doc',
			transactionId: snapshot.transactionId,
			snapshotDigest: snapshot.snapshotDigest,
		})
		restored.values.length = 0
		expect(
			journal.require({
				runId: 'run',
				documentToken: 'doc',
				transactionId: snapshot.transactionId,
				snapshotDigest: snapshot.snapshotDigest,
			}).values,
		).toHaveLength(1)
		await expect(
			journal.admit({
				runId: 'run',
				documentToken: 'doc',
				snapshot: { ...snapshot, snapshotDigest: '0'.repeat(64) },
			}),
		).rejects.toMatchObject({ code: 'control_snapshot_digest_mismatch' })
	})

	it('authorizes recovery by capability hash and retains quarantined entries past TTL', async () => {
		let now = 0
		const journal = new PendingControlJournal(() => now)
		const snapshot = await createSnapshot()
		const recoveryCapability = 'recovery-secret'
		await journal.admit({
			runId: 'run',
			documentToken: 'doc',
			snapshot,
			recoveryCapabilityHash: await sha256Hex(recoveryCapability),
		})
		await expect(
			journal.requireRecovery({
				runId: 'run',
				documentToken: 'doc',
				transactionId: snapshot.transactionId,
				snapshotDigest: snapshot.snapshotDigest,
				recoveryCapability: 'forged',
			}),
		).rejects.toMatchObject({ code: 'recovery_capability_mismatch' })
		journal.markQuarantined('run', snapshot.transactionId, snapshot.snapshotDigest)
		now = 20 * 60_000
		expect(journal.stats().entries).toBe(1)
		await expect(
			journal.requireRecovery({
				runId: 'run',
				documentToken: 'doc',
				transactionId: snapshot.transactionId,
				snapshotDigest: snapshot.snapshotDigest,
				recoveryCapability,
			}),
		).resolves.toMatchObject({ transactionId: snapshot.transactionId })
		journal.invalidateDocument('doc')
		expect(journal.stats()).toEqual({ entries: 0, bytes: 0 })
	})
})

async function createSnapshot(): Promise<ControlSnapshot> {
	const base = {
		transactionId: 'transaction-1',
		logicalPageFingerprint: 'logical',
		bindingFingerprint: 'binding',
		values: [
			{
				kind: 'choice' as const,
				questionFingerprint: 'question-1',
				selectedOptionKeys: ['A'],
			},
		],
		restoreCapability: 'exact' as const,
	}
	return {
		...base,
		snapshotDigestVersion: 1,
		snapshotDigest: await createControlSnapshotDigest(base),
	}
}
