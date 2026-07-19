import { describe, expect, it } from 'vitest'

import type { ControlSnapshot, Question } from './contracts'
import {
	canonicalJson,
	createControlSnapshotDigest,
	createQuestionFingerprint,
	normalizeControlValues,
	verifyControlSnapshotDigest,
} from './fingerprints'

describe('question-solver fingerprints', () => {
	it('canonicalizes object keys and rejects non-finite numbers', () => {
		expect(canonicalJson({ z: 1, a: ['x', { b: true, a: null }] })).toBe(
			'{"a":["x",{"a":null,"b":true}],"z":1}',
		)
		expect(() => canonicalJson(Number.NaN)).toThrow('non-finite')
	})

	it('keeps question fingerprints stable while ignoring transient asset ids', async () => {
		const question = makeQuestion()
		const first = await createQuestionFingerprint(question)
		question.stem[1] = {
			type: 'image',
			label: 'diagram',
			anchorKey: 'new-anchor',
			contentHash: 'image-hash',
			asset: {
				assetId: 'another-asset',
				runId: 'another-run',
				questionFingerprint: '0'.repeat(64),
				sha256: '1'.repeat(64),
				mimeType: 'image/png',
				width: 10,
				height: 10,
				byteLength: 100,
			},
			requiredForAnswer: true,
			resolution: 'inline',
		}
		const second = await createQuestionFingerprint(question)
		expect(second).toBe(first)
		expect(first).toMatch(/^[a-f0-9]{64}$/)
	})

	it('canonicalizes control value ordering into the v1 snapshot digest', async () => {
		const values: ControlSnapshot['values'] = [
			{ kind: 'choice', questionFingerprint: 'b', selectedOptionKeys: ['D', 'A'] },
			{
				kind: 'text',
				questionFingerprint: 'a',
				values: [
					{ blankKey: '2', value: 'second' },
					{ blankKey: '1', value: 'first' },
				],
			},
		]
		const base = {
			transactionId: 'transaction-1',
			logicalPageFingerprint: 'page',
			bindingFingerprint: 'binding',
			values,
			restoreCapability: 'exact' as const,
		}
		const digest = await createControlSnapshotDigest(base)
		const reordered = await createControlSnapshotDigest({
			...base,
			values: normalizeControlValues(values).reverse().reverse(),
		})
		expect(reordered).toBe(digest)
		expect(digest).toBe('bc4477173467ec763769fe67562ea5ae5f21702d9413a7e930b965802ae69be2')

		const snapshot: ControlSnapshot = {
			...base,
			snapshotDigestVersion: 1,
			snapshotDigest: digest,
		}
		expect(await verifyControlSnapshotDigest(snapshot)).toBe(true)
		expect(await verifyControlSnapshotDigest({ ...snapshot, snapshotDigest: '0'.repeat(64) })).toBe(
			false,
		)
	})
})

function makeQuestion(): Question {
	return {
		locator: {
			platform: 'chaoxing',
			variant: 'chaoxing.modern_work_exam',
			adapterVersion: 1,
			tabId: 1,
			frameId: 0,
			fingerprint: '',
		},
		type: 'single',
		stem: [
			{ type: 'text', text: '  Which   shape? ' },
			{
				type: 'image',
				label: 'diagram',
				anchorKey: 'anchor',
				contentHash: 'image-hash',
				requiredForAnswer: true,
				resolution: 'screenshot',
			},
		],
		options: [
			{ key: 'A', content: [{ type: 'text', text: 'Circle' }] },
			{ key: 'B', content: [{ type: 'text', text: 'Square' }] },
		],
		hasRequiredVisuals: true,
		visibility: 'fully_visible',
		visualAnchorKeys: ['anchor'],
		extractionWarnings: [],
	}
}
