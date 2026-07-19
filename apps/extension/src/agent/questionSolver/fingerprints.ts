import type {
	BindingFingerprint,
	ContentPart,
	ControlSnapshot,
	ControlValue,
	LogicalPageFingerprint,
	Question,
} from './contracts'

const SNAPSHOT_DIGEST_PREFIX = 'wenxue-control-snapshot-v1\0'

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
	const source = typeof value === 'string' ? new TextEncoder().encode(value) : value
	const bytes = new ArrayBuffer(source.byteLength)
	new Uint8Array(bytes).set(source)
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** RFC 8785-compatible canonical JSON for the JSON-only values used by solver contracts. */
export function canonicalJson(value: unknown): string {
	if (value === null) return 'null'
	if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers')
		return JSON.stringify(Object.is(value, -0) ? 0 : value)
	}
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
	if (isRecord(value)) {
		const entries = Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort(compareUnicodeCodeUnits)
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
		return `{${entries.join(',')}}`
	}
	throw new TypeError(`Canonical JSON rejects ${typeof value}`)
}

export function normalizeQuestionText(value: string): string {
	return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export async function createQuestionFingerprint(
	question: Pick<Question, 'type' | 'stem' | 'material' | 'options' | 'blanks' | 'subQuestions'>,
): Promise<string> {
	return sha256Hex(
		canonicalJson({
			type: question.type,
			stem: normalizeParts(question.stem),
			material: normalizeParts(question.material ?? []),
			options: question.options.map((option) => ({
				key: option.key,
				platformId: option.platformId ?? null,
				content: normalizeParts(option.content),
			})),
			blanks: (question.blanks ?? []).map((blank) => blank.key),
			subQuestions: await Promise.all(
				(question.subQuestions ?? []).map((subQuestion) => createQuestionFingerprint(subQuestion)),
			),
		}),
	)
}

export async function createLogicalPageFingerprint(args: {
	platform: string
	variant: string
	attemptId?: string
	pageCursor?: string
	questionFingerprints: string[]
}): Promise<LogicalPageFingerprint> {
	return sha256Hex(
		canonicalJson({
			platform: args.platform,
			variant: args.variant,
			attemptId: args.attemptId ?? null,
			pageCursor: args.pageCursor ?? null,
			questionFingerprints: args.questionFingerprints,
		}),
	)
}

export async function createBindingFingerprint(args: {
	tabId: number
	frameId: number
	documentId?: string
	documentToken: string
	urlFingerprint: string
	logicalPageFingerprint: LogicalPageFingerprint
}): Promise<BindingFingerprint> {
	return sha256Hex(canonicalJson(args))
}

export async function createControlSnapshotDigest(
	snapshot: Omit<ControlSnapshot, 'snapshotDigest' | 'snapshotDigestVersion'>,
): Promise<string> {
	const normalized = {
		transactionId: snapshot.transactionId,
		logicalPageFingerprint: snapshot.logicalPageFingerprint,
		bindingFingerprint: snapshot.bindingFingerprint,
		restoreCapability: snapshot.restoreCapability,
		values: normalizeControlValues(snapshot.values),
	}
	return sha256Hex(`${SNAPSHOT_DIGEST_PREFIX}${canonicalJson(normalized)}`)
}

export async function verifyControlSnapshotDigest(snapshot: ControlSnapshot): Promise<boolean> {
	if (snapshot.snapshotDigestVersion !== 1) return false
	const digest = await createControlSnapshotDigest(snapshot)
	return timingSafeHexEqual(digest, snapshot.snapshotDigest)
}

export function normalizeControlValues(values: ControlValue[]): ControlValue[] {
	return values
		.map((value): ControlValue => {
			switch (value.kind) {
				case 'choice':
					return {
						...value,
						selectedOptionKeys: [...value.selectedOptionKeys].sort(compareUnicodeCodeUnits),
					}
				case 'text':
					return {
						...value,
						values: [...value.values].sort((a, b) =>
							compareUnicodeCodeUnits(a.blankKey, b.blankKey),
						),
					}
				case 'dropdown':
					return {
						...value,
						values: [...value.values].sort((a, b) =>
							compareUnicodeCodeUnits(a.blankKey, b.blankKey),
						),
					}
				case 'line':
					return {
						...value,
						pairs: [...value.pairs].sort((a, b) => compareUnicodeCodeUnits(a.leftKey, b.leftKey)),
					}
			}
		})
		.sort((a, b) => compareUnicodeCodeUnits(a.questionFingerprint, b.questionFingerprint))
}

function normalizeParts(parts: ContentPart[]): unknown[] {
	return parts.map((part) =>
		part.type === 'text'
			? { type: 'text', text: normalizeQuestionText(part.text) }
			: {
					type: 'image',
					label: normalizeQuestionText(part.label),
					contentHash: part.contentHash ?? part.asset?.sha256 ?? null,
					requiredForAnswer: part.requiredForAnswer,
				},
	)
}

function timingSafeHexEqual(left: string, right: string): boolean {
	if (left.length !== right.length) return false
	let difference = 0
	for (let index = 0; index < left.length; index++) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
	}
	return difference === 0
}

function compareUnicodeCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
