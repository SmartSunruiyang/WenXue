import type { ImageAssetRef, InternalImageEnvelope } from './contracts'
import { sha256Hex } from './fingerprints'

export const IMAGE_ASSET_MAX_BYTES = 2 * 1024 * 1024
export const IMAGE_ASSET_RUN_MAX_BYTES = 16 * 1024 * 1024
export const IMAGE_ASSET_MAX_COUNT = 64

interface StoredImageAsset {
	ref: ImageAssetRef
	anchorKey: string
	base64: string
}

export class ImageAssetError extends Error {
	constructor(readonly code: string) {
		super(code)
		this.name = 'ImageAssetError'
	}
}

export class EphemeralImageStore {
	private readonly assets = new Map<string, StoredImageAsset>()
	private readonly runBytes = new Map<string, number>()

	async admit(
		envelope: InternalImageEnvelope,
		expected: { runId: string; questionFingerprint: string; anchorKey: string },
	): Promise<ImageAssetRef> {
		assertEnvelopeShape(envelope)
		if (
			envelope.runId !== expected.runId ||
			envelope.questionFingerprint !== expected.questionFingerprint ||
			envelope.anchorKey !== expected.anchorKey
		) {
			throw new ImageAssetError('image_asset_owner_mismatch')
		}
		if (this.assets.has(envelope.assetId)) {
			throw new ImageAssetError('image_asset_id_reused')
		}
		if (this.assets.size >= IMAGE_ASSET_MAX_COUNT) {
			throw new ImageAssetError('image_asset_store_capacity_exceeded')
		}

		const bytes = decodeRawBase64(envelope.base64)
		if (bytes.byteLength !== envelope.byteLength || bytes.byteLength > IMAGE_ASSET_MAX_BYTES) {
			throw new ImageAssetError('image_asset_size_mismatch')
		}
		const digest = await sha256Hex(bytes)
		if (!constantTimeHexEqual(digest, envelope.sha256)) {
			throw new ImageAssetError('image_asset_hash_mismatch')
		}
		const dimensions = readImageDimensions(bytes, envelope.mimeType)
		if (
			!dimensions ||
			dimensions.width !== envelope.width ||
			dimensions.height !== envelope.height
		) {
			throw new ImageAssetError('image_asset_dimensions_mismatch')
		}

		const nextRunBytes = (this.runBytes.get(envelope.runId) ?? 0) + bytes.byteLength
		if (nextRunBytes > IMAGE_ASSET_RUN_MAX_BYTES) {
			throw new ImageAssetError('image_asset_run_capacity_exceeded')
		}
		const ref: ImageAssetRef = {
			assetId: envelope.assetId,
			runId: envelope.runId,
			questionFingerprint: envelope.questionFingerprint,
			sha256: envelope.sha256,
			mimeType: envelope.mimeType,
			width: envelope.width,
			height: envelope.height,
			byteLength: envelope.byteLength,
		}
		this.assets.set(envelope.assetId, {
			ref,
			anchorKey: envelope.anchorKey,
			base64: envelope.base64,
		})
		this.runBytes.set(envelope.runId, nextRunBytes)
		return { ...ref }
	}

	resolveProviderDataUrl(
		ref: ImageAssetRef,
		expected: { runId: string; questionFingerprint: string },
	): string {
		const stored = this.assets.get(ref.assetId)
		if (
			!stored ||
			stored.ref.runId !== expected.runId ||
			stored.ref.questionFingerprint !== expected.questionFingerprint ||
			stored.ref.runId !== ref.runId ||
			stored.ref.questionFingerprint !== ref.questionFingerprint ||
			stored.ref.sha256 !== ref.sha256 ||
			stored.ref.mimeType !== ref.mimeType ||
			stored.ref.byteLength !== ref.byteLength
		) {
			throw new ImageAssetError('image_asset_ref_mismatch')
		}
		return `data:${stored.ref.mimeType};base64,${stored.base64}`
	}

	releaseAsset(assetId: string): void {
		const stored = this.assets.get(assetId)
		if (!stored) return
		this.assets.delete(assetId)
		const remaining = Math.max(
			0,
			(this.runBytes.get(stored.ref.runId) ?? 0) - stored.ref.byteLength,
		)
		if (remaining === 0) this.runBytes.delete(stored.ref.runId)
		else this.runBytes.set(stored.ref.runId, remaining)
	}

	releaseQuestion(runId: string, questionFingerprint: string): void {
		for (const [assetId, stored] of this.assets) {
			if (stored.ref.runId === runId && stored.ref.questionFingerprint === questionFingerprint) {
				this.releaseAsset(assetId)
			}
		}
	}

	releaseRun(runId: string): void {
		for (const [assetId, stored] of this.assets) {
			if (stored.ref.runId === runId) this.releaseAsset(assetId)
		}
	}

	stats(): { assets: number; bytesByRun: Readonly<Record<string, number>> } {
		return { assets: this.assets.size, bytesByRun: Object.fromEntries(this.runBytes) }
	}
}

function assertEnvelopeShape(envelope: InternalImageEnvelope): void {
	if (
		envelope.kind !== 'question_solver_image_asset' ||
		!/^[A-Za-z0-9_-]{8,128}$/.test(envelope.assetId) ||
		!envelope.runId ||
		!envelope.questionFingerprint ||
		!envelope.anchorKey ||
		!/^[a-f0-9]{64}$/.test(envelope.sha256) ||
		!Number.isInteger(envelope.width) ||
		!Number.isInteger(envelope.height) ||
		envelope.width < 1 ||
		envelope.height < 1 ||
		envelope.width > 16_384 ||
		envelope.height > 16_384 ||
		!Number.isInteger(envelope.byteLength) ||
		envelope.byteLength < 1 ||
		envelope.base64.startsWith('data:') ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.base64)
	) {
		throw new ImageAssetError('image_asset_invalid')
	}
}

function decodeRawBase64(base64: string): Uint8Array {
	try {
		const binary = atob(base64)
		const bytes = new Uint8Array(binary.length)
		for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
		return bytes
	} catch {
		throw new ImageAssetError('image_asset_base64_invalid')
	}
}

function readImageDimensions(
	bytes: Uint8Array,
	mimeType: InternalImageEnvelope['mimeType'],
): { width: number; height: number } | null {
	if (mimeType === 'image/png') return readPngDimensions(bytes)
	if (mimeType === 'image/jpeg') return readJpegDimensions(bytes)
	return readWebpDimensions(bytes)
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (
		bytes.length < 24 ||
		bytes[0] !== 0x89 ||
		bytes[1] !== 0x50 ||
		bytes[2] !== 0x4e ||
		bytes[3] !== 0x47
	)
		return null
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	return { width: view.getUint32(16), height: view.getUint32(20) }
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
	let offset = 2
	while (offset + 8 < bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset++
			continue
		}
		const marker = bytes[offset + 1]
		if (marker === undefined) return null
		if (marker === 0xd8 || marker === 0xd9) {
			offset += 2
			continue
		}
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
		if (length < 2 || offset + length + 2 > bytes.length) return null
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
			return {
				height: (bytes[offset + 5] << 8) | bytes[offset + 6],
				width: (bytes[offset + 7] << 8) | bytes[offset + 8],
			}
		}
		offset += length + 2
	}
	return null
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
		return null
	}
	const chunk = ascii(bytes, 12, 4)
	if (chunk === 'VP8X') {
		return {
			width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
			height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
		}
	}
	if (chunk === 'VP8L' && bytes[20] === 0x2f) {
		const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
	}
	return null
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function constantTimeHexEqual(left: string, right: string): boolean {
	if (left.length !== right.length) return false
	let difference = 0
	for (let index = 0; index < left.length; index++) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
	}
	return difference === 0
}
