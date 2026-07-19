import type { ContentAnchorRegistry, ControlSnapshot } from './contracts'
import { sha256Hex, verifyControlSnapshotDigest } from './fingerprints'

export const ANCHOR_TTL_MS = 60_000
export const ANCHOR_MAX_ENTRIES = 512
export const CONTROL_JOURNAL_TTL_MS = 15 * 60_000
export const CONTROL_JOURNAL_MAX_ENTRIES = 64
export const CONTROL_JOURNAL_MAX_BYTES = 512 * 1024

interface AnchorEntry {
	anchorKey: string
	runId: string
	documentToken: string
	questionFingerprint: string
	role: 'stem' | 'material' | 'option'
	optionKey?: string
	element: Element
	expiresAt: number
}

interface JournalEntry {
	runId: string
	documentToken: string
	snapshot: ControlSnapshot
	recoveryCapabilityHash?: string
	serializedBytes: number
	expiresAt: number
	retainUntilInvalidated: boolean
}

export class QuestionSolverContentStateError extends Error {
	constructor(readonly code: string) {
		super(code)
		this.name = 'QuestionSolverContentStateError'
	}
}

export class AnchorRegistry {
	private readonly entries = new Map<string, AnchorEntry>()

	constructor(
		private readonly now: () => number = Date.now,
		private readonly randomId: () => string = () => crypto.randomUUID(),
	) {}

	forRun(runId: string, documentToken: string): ContentAnchorRegistry {
		return {
			registerImage: (args) => {
				this.sweep()
				if (this.entries.size >= ANCHOR_MAX_ENTRIES) {
					throw new QuestionSolverContentStateError('anchor_registry_capacity_exceeded')
				}
				const anchorKey = this.randomId()
				if (this.entries.has(anchorKey)) {
					throw new QuestionSolverContentStateError('anchor_key_collision')
				}
				this.entries.set(anchorKey, {
					anchorKey,
					runId,
					documentToken,
					questionFingerprint: args.questionFingerprint,
					role: args.role,
					optionKey: args.optionKey,
					element: args.element,
					expiresAt: this.now() + ANCHOR_TTL_MS,
				})
				return anchorKey
			},
		}
	}

	resolve(args: {
		runId: string
		documentToken: string
		questionFingerprint: string
		anchorKey: string
	}): Element {
		this.sweep()
		const entry = this.entries.get(args.anchorKey)
		if (
			!entry ||
			entry.runId !== args.runId ||
			entry.documentToken !== args.documentToken ||
			entry.questionFingerprint !== args.questionFingerprint ||
			!entry.element.isConnected
		) {
			throw new QuestionSolverContentStateError('image_anchor_mismatch')
		}
		return entry.element
	}

	releaseQuestion(runId: string, questionFingerprint: string): void {
		for (const [key, entry] of this.entries) {
			if (entry.runId === runId && entry.questionFingerprint === questionFingerprint) {
				this.entries.delete(key)
			}
		}
	}

	releaseRun(runId: string): void {
		for (const [key, entry] of this.entries) {
			if (entry.runId === runId) this.entries.delete(key)
		}
	}

	invalidateDocument(documentToken: string): void {
		for (const [key, entry] of this.entries) {
			if (entry.documentToken === documentToken) this.entries.delete(key)
		}
	}

	size(): number {
		this.sweep()
		return this.entries.size
	}

	private sweep(): void {
		const now = this.now()
		for (const [key, entry] of this.entries) {
			if (entry.expiresAt <= now || !entry.element.isConnected) this.entries.delete(key)
		}
	}
}

export class PendingControlJournal {
	private readonly entries = new Map<string, JournalEntry>()
	private totalBytes = 0

	constructor(private readonly now: () => number = Date.now) {}

	async admit(args: {
		runId: string
		documentToken: string
		snapshot: ControlSnapshot
		recoveryCapabilityHash?: string
	}): Promise<void> {
		this.sweep()
		if (!(await verifyControlSnapshotDigest(args.snapshot))) {
			throw new QuestionSolverContentStateError('control_snapshot_digest_mismatch')
		}
		if (args.recoveryCapabilityHash && !/^[a-f0-9]{64}$/.test(args.recoveryCapabilityHash)) {
			throw new QuestionSolverContentStateError('recovery_capability_hash_invalid')
		}
		const key = journalKey(args.runId, args.snapshot.transactionId, args.snapshot.snapshotDigest)
		if (this.entries.has(key)) return
		const serializedBytes = new TextEncoder().encode(JSON.stringify(args.snapshot)).byteLength
		if (
			this.entries.size >= CONTROL_JOURNAL_MAX_ENTRIES ||
			this.totalBytes + serializedBytes > CONTROL_JOURNAL_MAX_BYTES
		) {
			throw new QuestionSolverContentStateError('control_journal_capacity_exceeded')
		}
		this.entries.set(key, {
			runId: args.runId,
			documentToken: args.documentToken,
			snapshot: structuredClone(args.snapshot),
			recoveryCapabilityHash: args.recoveryCapabilityHash,
			serializedBytes,
			expiresAt: this.now() + CONTROL_JOURNAL_TTL_MS,
			retainUntilInvalidated: false,
		})
		this.totalBytes += serializedBytes
	}

	require(args: {
		runId: string
		documentToken: string
		transactionId: string
		snapshotDigest: string
	}): ControlSnapshot {
		this.sweep()
		const entry = this.entries.get(journalKey(args.runId, args.transactionId, args.snapshotDigest))
		if (!entry || entry.documentToken !== args.documentToken) {
			throw new QuestionSolverContentStateError('control_journal_mismatch')
		}
		return structuredClone(entry.snapshot)
	}

	async requireRecovery(args: {
		runId: string
		documentToken: string
		transactionId: string
		snapshotDigest: string
		recoveryCapability: string
	}): Promise<ControlSnapshot> {
		const snapshot = this.require(args)
		const entry = this.entries.get(journalKey(args.runId, args.transactionId, args.snapshotDigest))
		const actual = await sha256Hex(args.recoveryCapability)
		if (
			!entry?.recoveryCapabilityHash ||
			!constantTimeEqual(entry.recoveryCapabilityHash, actual)
		) {
			throw new QuestionSolverContentStateError('recovery_capability_mismatch')
		}
		return snapshot
	}

	markQuarantined(runId: string, transactionId: string, snapshotDigest: string): void {
		const entry = this.entries.get(journalKey(runId, transactionId, snapshotDigest))
		if (entry) entry.retainUntilInvalidated = true
	}

	delete(runId: string, transactionId: string, snapshotDigest: string): void {
		const key = journalKey(runId, transactionId, snapshotDigest)
		const entry = this.entries.get(key)
		if (!entry) return
		this.entries.delete(key)
		this.totalBytes -= entry.serializedBytes
	}

	releaseRun(runId: string, includeQuarantined = false): void {
		for (const [key, entry] of this.entries) {
			if (entry.runId === runId && (includeQuarantined || !entry.retainUntilInvalidated)) {
				this.entries.delete(key)
				this.totalBytes -= entry.serializedBytes
			}
		}
	}

	invalidateDocument(documentToken: string): void {
		for (const [key, entry] of this.entries) {
			if (entry.documentToken === documentToken) {
				this.entries.delete(key)
				this.totalBytes -= entry.serializedBytes
			}
		}
	}

	stats(): { entries: number; bytes: number } {
		this.sweep()
		return { entries: this.entries.size, bytes: this.totalBytes }
	}

	private sweep(): void {
		const now = this.now()
		for (const [key, entry] of this.entries) {
			if (!entry.retainUntilInvalidated && entry.expiresAt <= now) {
				this.entries.delete(key)
				this.totalBytes -= entry.serializedBytes
			}
		}
	}
}

function journalKey(runId: string, transactionId: string, snapshotDigest: string): string {
	return `${runId}\0${transactionId}\0${snapshotDigest}`
}

function constantTimeEqual(left: string, right: string): boolean {
	if (left.length !== right.length) return false
	let difference = 0
	for (let index = 0; index < left.length; index++) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
	}
	return difference === 0
}
