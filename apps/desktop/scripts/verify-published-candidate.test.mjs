import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'

import { canonicalJson } from '@wenxue/client-operations'

import { verifyPublishedCandidate } from './verify-published-candidate.mjs'

const commit = '0123456789abcdef0123456789abcdef01234567'
const version = '0.1.1'
const manifestUrl = `https://updates.wenxue.example/electron/beta/${version}/candidate-manifest.json`

test('verifies the signed public manifest and every published artifact byte', async () => {
	const fixture = createFixture()
	await withReleasePublicKey(fixture.publicKeyPem, async () => {
		const result = await verifyPublishedCandidate(readOptions(), {
			fetchImpl: fixture.fetchImpl,
			requestAttempts: 1,
		})
		assert.equal(result.manifest.releaseId, `electron:beta:${version}`)
		assert.equal(result.manifest.artifacts.length, 3)
	})
})

test('rejects a public artifact whose bytes differ from the signed manifest', async () => {
	const fixture = createFixture()
	const artifactUrl = fixture.manifest.artifacts[0].url
	fixture.responses.set(artifactUrl, Buffer.alloc(fixture.manifest.artifacts[0].size, 0))
	await withReleasePublicKey(fixture.publicKeyPem, async () => {
		await assert.rejects(
			verifyPublishedCandidate(readOptions(), {
				fetchImpl: fixture.fetchImpl,
				requestAttempts: 1,
			}),
			/integrity verification/i,
		)
	})
})

test('rejects a signature that is not valid for the public manifest', async () => {
	const fixture = createFixture()
	fixture.responses.set(
		new URL('candidate-manifest.sig', manifestUrl).toString(),
		Buffer.alloc(64).toString('base64'),
	)
	await withReleasePublicKey(fixture.publicKeyPem, async () => {
		await assert.rejects(
			verifyPublishedCandidate(readOptions(), {
				fetchImpl: fixture.fetchImpl,
				requestAttempts: 1,
			}),
			/signature is invalid/i,
		)
	})
})

test('rejects missing, duplicate, or extended public release test evidence', async () => {
	const invalidTests = [
		[],
		[releaseTests()[0], releaseTests()[1], { ...releaseTests()[1] }],
		[{ ...releaseTests()[0], unexpected: true }, releaseTests()[1], releaseTests()[2]],
	]
	for (const tests of invalidTests) {
		const fixture = createFixture({ tests })
		await withReleasePublicKey(fixture.publicKeyPem, async () => {
			await assert.rejects(
				verifyPublishedCandidate(readOptions(), {
					fetchImpl: fixture.fetchImpl,
					requestAttempts: 1,
				}),
				/(three required checks|names must be unique|unsupported fields)/i,
			)
		})
	}
})

function createFixture(options = {}) {
	const { privateKey, publicKey } = generateKeyPairSync('ed25519')
	const responses = new Map()
	const artifacts = [
		artifact('darwin', 'arm64', 'dmg', 'WenXue-arm64.dmg', 'mac-arm64-dmg'),
		artifact('darwin', 'x64', 'dmg', 'WenXue-x64.dmg', 'mac-x64-dmg'),
		artifact('win32', 'x64', 'nsis', 'WenXue.exe', 'win-installer'),
	]
	for (const value of artifacts) responses.set(value.url, value.bytes)
	const publicKeyFingerprint = createHash('sha256')
		.update(publicKey.export({ format: 'der', type: 'spki' }))
		.digest('hex')
	const manifest = {
		schemaVersion: 1,
		releaseId: `electron:beta:${version}`,
		runtime: 'electron',
		channel: 'beta',
		version,
		createdAt: '2026-07-17T10:00:00.000Z',
		manifestUrl,
		sourceCoordinates: {
			repository: 'SmartSunruiyang/WenXue',
			commit,
			browserVersion: '149.0.7827.55',
			extensionVersion: '0.1.0',
			releasePublicKeyFingerprint: publicKeyFingerprint,
		},
		distribution: { mode: 'manual-unsigned' },
		tests: options.tests ?? releaseTests(),
		artifacts: artifacts.map(({ platform, arch, kind, fileName, url, sha512, size }) => ({
			platform,
			arch,
			kind,
			fileName,
			url,
			sha512,
			size,
		})),
	}
	const signature = sign(null, Buffer.from(canonicalJson(manifest)), privateKey).toString('base64')
	responses.set(manifestUrl, Buffer.from(canonicalJson(manifest)))
	responses.set(new URL('candidate-manifest.sig', manifestUrl).toString(), Buffer.from(signature))
	return {
		manifest,
		responses,
		publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
		fetchImpl: async (url) => {
			const bytes = responses.get(String(url))
			if (!bytes) return new Response('', { status: 404 })
			return new Response(bytes, {
				status: 200,
				headers: { 'content-length': String(bytes.byteLength) },
			})
		},
	}
}

function releaseTests() {
	return ['quality', 'manual-installer-integrity', 'manifest-tamper-rejection'].map((name) => ({
		name,
		status: 'passed',
		url: `https://github.com/SmartSunruiyang/WenXue/actions/runs/123456789#${name}`,
	}))
}

function artifact(platform, arch, kind, fileName, contents) {
	const bytes = Buffer.from(contents)
	const artifactBaseUrl = `https://updates.wenxue.example/electron/beta/${version}/${platform}/${arch}`
	return {
		platform,
		arch,
		kind,
		fileName,
		url: `${artifactBaseUrl}/${fileName}`,
		sha512: createHash('sha512').update(bytes).digest('base64'),
		size: bytes.byteLength,
		bytes,
	}
}

function readOptions() {
	return {
		manifestUrl,
		expectedVersion: version,
		expectedChannel: 'beta',
		expectedCommit: commit,
	}
}

async function withReleasePublicKey(publicKey, operation) {
	const previous = process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
	process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = publicKey
	try {
		await operation()
	} finally {
		if (previous === undefined) delete process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
		else process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = previous
	}
}
