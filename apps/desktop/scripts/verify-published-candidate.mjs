import { createHash, createPublicKey, verify } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { assertReleaseTargetMatrix } from './release-artifact-set.mjs'

const SMALL_REQUEST_TIMEOUT_MS = 30_000
const ARTIFACT_REQUEST_TIMEOUT_MS = 20 * 60 * 1000
const REQUEST_ATTEMPTS = 4
const MAX_CONTROL_FILE_BYTES = 5 * 1024 * 1024
const REQUIRED_TEST_EVIDENCE = new Set([
	'quality',
	'manual-installer-integrity',
	'manifest-tamper-rejection',
])

async function main() {
	const options = readOptions(process.argv.slice(2))
	await verifyPublishedCandidate(options)
}

export async function verifyPublishedCandidate(options, dependencies = {}) {
	const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
	const requestAttempts = dependencies.requestAttempts ?? REQUEST_ATTEMPTS
	const retryDelay = dependencies.retryDelay ?? delay
	const manifestUrl = requireHttpsUrl(options.manifestUrl, '--manifest-url', false)
	const signatureUrl = new URL('candidate-manifest.sig', manifestUrl).toString()
	const [manifestBytes, signatureBytes] = await Promise.all([
		fetchSmallBytes(manifestUrl, fetchImpl, requestAttempts, retryDelay),
		fetchSmallBytes(signatureUrl, fetchImpl, requestAttempts, retryDelay),
	])
	const manifest = JSON.parse(manifestBytes.toString('utf8'))
	if (!isRecord(manifest) || manifest.manifestUrl !== manifestUrl) {
		throw new Error('Published manifest URL does not match its signed contents')
	}
	const publicKey = releasePublicKey(process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY)
	const publicKeyFingerprint = createHash('sha256')
		.update(publicKey.export({ format: 'der', type: 'spki' }))
		.digest('hex')
	const signatureText = signatureBytes.toString('utf8').trim()
	const signature = Buffer.from(signatureText, 'base64')
	if (!verify(null, Buffer.from(canonicalJson(manifest)), publicKey, signature)) {
		throw new Error('Published candidate signature is invalid')
	}
	assertExpectedManifest(manifest, options, publicKeyFingerprint)
	assertReleaseTests(manifest.tests)
	assertReleaseTargetMatrix(manifest.artifacts)

	const baseUrl = new URL('./', manifestUrl)
	for (const value of manifest.artifacts) {
		if (!isRecord(value)) throw new Error('Published candidate contains an invalid artifact')
		const artifactUrl = requireHttpsUrl(value.url, 'artifact URL', false)
		assertInsideCandidatePath(artifactUrl, baseUrl)
		if (typeof value.sha512 !== 'string' || !Number.isSafeInteger(value.size) || value.size <= 0) {
			throw new Error(`Artifact integrity metadata is invalid: ${artifactUrl}`)
		}
		await verifyRemoteArtifact(
			artifactUrl,
			value.sha512,
			value.size,
			fetchImpl,
			requestAttempts,
			retryDelay,
		)
	}

	if (options.registrationOutput) {
		const output = path.resolve(options.registrationOutput)
		await mkdir(path.dirname(output), { recursive: true })
		await writeFile(
			output,
			`${JSON.stringify(
				{
					manifestUrl,
					manifest,
					manifestSignature: signatureText,
					publicKeyFingerprint,
				},
				null,
				2,
			)}\n`,
			'utf8',
		)
	}
	process.stdout.write(`Verified ${manifest.artifacts.length} published candidate artifacts.\n`)
	return { manifestUrl, manifest, signatureText, publicKeyFingerprint }
}

function assertExpectedManifest(manifest, options, publicKeyFingerprint) {
	if (
		manifest.schemaVersion !== 1 ||
		manifest.runtime !== 'electron' ||
		!isRecord(manifest.distribution) ||
		manifest.distribution.mode !== 'manual-unsigned' ||
		manifest.version !== options.expectedVersion ||
		manifest.channel !== options.expectedChannel ||
		manifest.releaseId !== `electron:${options.expectedChannel}:${options.expectedVersion}`
	) {
		throw new Error('Published candidate does not match the requested runtime, channel, or version')
	}
	if (
		!isRecord(manifest.sourceCoordinates) ||
		manifest.sourceCoordinates.commit !== options.expectedCommit ||
		manifest.sourceCoordinates.releasePublicKeyFingerprint !== publicKeyFingerprint
	) {
		throw new Error('Published candidate does not match the requested commit or release key')
	}
}

function assertReleaseTests(tests) {
	if (!Array.isArray(tests) || tests.length !== REQUIRED_TEST_EVIDENCE.size) {
		throw new Error('Published candidate tests must contain exactly the three required checks')
	}
	const names = new Set()
	for (const test of tests) {
		if (!isRecord(test)) throw new Error('Published candidate contains invalid test evidence')
		if (Object.keys(test).some((key) => !['name', 'status', 'url'].includes(key))) {
			throw new Error('Published candidate test evidence contains unsupported fields')
		}
		if (
			!REQUIRED_TEST_EVIDENCE.has(test.name) ||
			test.status !== 'passed' ||
			typeof test.url !== 'string' ||
			test.url.length === 0 ||
			test.url.length > 2_048
		) {
			throw new Error('Published candidate contains invalid test evidence')
		}
		let url
		try {
			url = new URL(test.url)
		} catch {
			throw new Error('Published candidate test evidence URL is invalid')
		}
		if (url.protocol !== 'https:' || url.username || url.password) {
			throw new Error('Published candidate test evidence URL must use HTTPS')
		}
		if (names.has(test.name)) {
			throw new Error('Published candidate test evidence names must be unique')
		}
		names.add(test.name)
	}
	for (const required of REQUIRED_TEST_EVIDENCE) {
		if (!names.has(required)) {
			throw new Error(`Published candidate is missing required test evidence: ${required}`)
		}
	}
}

function assertInsideCandidatePath(artifactUrl, baseUrl) {
	const parsed = new URL(artifactUrl)
	if (parsed.origin !== baseUrl.origin || !parsed.pathname.startsWith(baseUrl.pathname)) {
		throw new Error(`Artifact is outside the immutable candidate path: ${artifactUrl}`)
	}
}

function readOptions(argv) {
	const values = new Map()
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index]
		const value = argv[index + 1]
		if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? ''}`)
		values.set(key.slice(2), value)
	}
	return {
		manifestUrl: requireValue(values.get('manifest-url'), '--manifest-url'),
		expectedVersion: requireValue(values.get('expected-version'), '--expected-version'),
		expectedChannel: requireChannel(values.get('expected-channel')),
		expectedCommit: requireValue(values.get('expected-commit'), '--expected-commit'),
		registrationOutput: values.get('registration-output'),
	}
}

async function fetchSmallBytes(url, fetchImpl, requestAttempts, retryDelay) {
	return withRetries(
		async () => {
			const request = await fetchWithTimeout(url, SMALL_REQUEST_TIMEOUT_MS, fetchImpl)
			try {
				const contentLength = Number(request.response.headers.get('content-length'))
				if (Number.isFinite(contentLength) && contentLength > MAX_CONTROL_FILE_BYTES) {
					throw new Error(`Published control file is too large: ${url}`)
				}
				const bytes = Buffer.from(await request.response.arrayBuffer())
				if (bytes.byteLength > MAX_CONTROL_FILE_BYTES) {
					throw new Error(`Published control file is too large: ${url}`)
				}
				return bytes
			} finally {
				request.finish()
			}
		},
		requestAttempts,
		retryDelay,
	)
}

async function verifyRemoteArtifact(
	url,
	expectedSha512,
	expectedSize,
	fetchImpl,
	requestAttempts,
	retryDelay,
) {
	await withRetries(
		async () => {
			const request = await fetchWithTimeout(url, ARTIFACT_REQUEST_TIMEOUT_MS, fetchImpl)
			try {
				const contentLength = Number(request.response.headers.get('content-length'))
				if (Number.isFinite(contentLength) && contentLength !== expectedSize) {
					throw new Error(`Published artifact size header is invalid: ${url}`)
				}
				if (!request.response.body)
					throw new Error(`Published artifact has no response body: ${url}`)
				const hash = createHash('sha512')
				let size = 0
				for await (const chunk of request.response.body) {
					const bytes = Buffer.from(chunk)
					size += bytes.byteLength
					if (size > expectedSize) throw new Error(`Published artifact exceeds signed size: ${url}`)
					hash.update(bytes)
				}
				if (size !== expectedSize || hash.digest('base64') !== expectedSha512) {
					throw new Error(`Published artifact failed integrity verification: ${url}`)
				}
			} finally {
				request.finish()
			}
		},
		requestAttempts,
		retryDelay,
	)
}

async function fetchWithTimeout(url, timeoutMs, fetchImpl) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetchImpl(url, {
			signal: controller.signal,
			cache: 'no-store',
			redirect: 'error',
		})
		if (!response.ok)
			throw new Error(`Public candidate request failed (${response.status}): ${url}`)
		return { response, finish: () => clearTimeout(timeout) }
	} catch (error) {
		clearTimeout(timeout)
		throw error
	}
}

async function withRetries(operation, attempts, retryDelay) {
	let lastError
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await operation()
		} catch (error) {
			lastError = error
			if (attempt < attempts) await retryDelay(500 * 2 ** (attempt - 1))
		}
	}
	throw lastError
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function releasePublicKey(raw) {
	const value = requireValue(raw, 'WENXUE_RELEASE_ED25519_PUBLIC_KEY').split('\\n').join('\n')
	return value.includes('BEGIN PUBLIC KEY')
		? createPublicKey(value)
		: createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' })
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`
	}
	return JSON.stringify(value)
}

function requireHttpsUrl(value, name, allowQuery) {
	const result = requireValue(value, name)
	const parsed = new URL(result)
	if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS`)
	if (parsed.username || parsed.password || parsed.hash || (!allowQuery && parsed.search)) {
		throw new Error(`${name} contains unsupported URL components`)
	}
	return parsed.toString()
}

function requireChannel(value) {
	const result = requireValue(value, '--expected-channel')
	if (!['dev', 'beta', 'stable'].includes(result)) throw new Error('Expected channel is invalid')
	return result
}

function requireValue(value, name) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} is required`)
	return value.trim()
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
