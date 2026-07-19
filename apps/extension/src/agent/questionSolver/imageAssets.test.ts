import { describe, expect, it } from 'vitest'

import type { InternalImageEnvelope } from './contracts'
import { sha256Hex } from './fingerprints'
import { EphemeralImageStore, ImageAssetError } from './imageAssets'

const PNG_1X1 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('EphemeralImageStore', () => {
	it('admits a bound raw envelope and assembles a provider data URL only on demand', async () => {
		const store = new EphemeralImageStore()
		const envelope = await validEnvelope()
		const ref = await store.admit(envelope, {
			runId: 'run-1',
			questionFingerprint: 'q-1',
			anchorKey: 'anchor-1',
		})
		expect(ref).not.toHaveProperty('base64')
		expect(store.resolveProviderDataUrl(ref, { runId: 'run-1', questionFingerprint: 'q-1' })).toBe(
			`data:image/png;base64,${PNG_1X1}`,
		)
		expect(JSON.stringify(ref)).not.toContain('data:image')
	})

	it('rejects cross-run ownership, data URLs, hashes and dimensions', async () => {
		const store = new EphemeralImageStore()
		const envelope = await validEnvelope()
		await expect(
			store.admit(envelope, {
				runId: 'other',
				questionFingerprint: 'q-1',
				anchorKey: 'anchor-1',
			}),
		).rejects.toMatchObject({ code: 'image_asset_owner_mismatch' })
		await expect(
			store.admit(
				{ ...envelope, assetId: 'asset-url', base64: `data:image/png;base64,${PNG_1X1}` },
				{
					runId: 'run-1',
					questionFingerprint: 'q-1',
					anchorKey: 'anchor-1',
				},
			),
		).rejects.toBeInstanceOf(ImageAssetError)
		await expect(
			store.admit(
				{ ...envelope, assetId: 'asset-hash', sha256: '0'.repeat(64) },
				{
					runId: 'run-1',
					questionFingerprint: 'q-1',
					anchorKey: 'anchor-1',
				},
			),
		).rejects.toMatchObject({ code: 'image_asset_hash_mismatch' })
		await expect(
			store.admit(
				{ ...envelope, assetId: 'asset-size', width: 2 },
				{
					runId: 'run-1',
					questionFingerprint: 'q-1',
					anchorKey: 'anchor-1',
				},
			),
		).rejects.toMatchObject({ code: 'image_asset_dimensions_mismatch' })
	})

	it('releases question and run ownership without retaining bytes', async () => {
		const store = new EphemeralImageStore()
		const first = await validEnvelope()
		const second = { ...first, assetId: 'asset-second', questionFingerprint: 'q-2' }
		await store.admit(first, {
			runId: 'run-1',
			questionFingerprint: 'q-1',
			anchorKey: 'anchor-1',
		})
		await store.admit(second, {
			runId: 'run-1',
			questionFingerprint: 'q-2',
			anchorKey: 'anchor-1',
		})
		store.releaseQuestion('run-1', 'q-1')
		expect(store.stats().assets).toBe(1)
		store.releaseRun('run-1')
		expect(store.stats()).toEqual({ assets: 0, bytesByRun: {} })
	})
})

async function validEnvelope(): Promise<InternalImageEnvelope> {
	const bytes = Uint8Array.from(atob(PNG_1X1), (char) => char.charCodeAt(0))
	return {
		kind: 'question_solver_image_asset',
		assetId: 'asset-first',
		runId: 'run-1',
		questionFingerprint: 'q-1',
		anchorKey: 'anchor-1',
		mimeType: 'image/png',
		base64: PNG_1X1,
		sha256: await sha256Hex(bytes),
		width: 1,
		height: 1,
		byteLength: bytes.byteLength,
	}
}
