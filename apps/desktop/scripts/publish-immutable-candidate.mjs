import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { readReleaseArtifactSet } from './release-artifact-set.mjs'

const execFileAsync = promisify(execFile)
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000
const REQUEST_ATTEMPTS = 4
const IMMUTABLE_CACHE_CONTROL = 'Cache-Control:public, max-age=31536000, immutable'

async function main() {
	const options = readOptions(process.argv.slice(2))
	return publishImmutableCandidate(options)
}

export async function publishImmutableCandidate(options, dependencies = {}) {
	const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
	const upload = dependencies.upload ?? ((entry) => uploadMissing(entry, options))
	const requestAttempts = dependencies.requestAttempts ?? REQUEST_ATTEMPTS
	const retryDelay = dependencies.retryDelay ?? delay
	const releaseDir = path.resolve(options.releaseDir)
	const artifactSet = await readReleaseArtifactSet(releaseDir)
	const entries = artifactSet.records.map((record) => ({
		file: record.file,
		key: `${options.prefix}/${record.relativePath}`,
		sha512: record.artifact.sha512,
		size: record.artifact.size,
	}))
	for (const fileName of ['candidate-manifest.sig', 'candidate-manifest.json']) {
		const file = path.join(releaseDir, fileName)
		const integrity = await hashFile(file)
		entries.push({
			file,
			key: `${options.prefix}/${fileName}`,
			sha512: integrity.sha512,
			size: integrity.size,
		})
	}

	const states = []
	for (const entry of entries) {
		states.push(
			await inspectRemote(entry, options.originUrl, fetchImpl, requestAttempts, retryDelay, false),
		)
	}
	for (let index = 0; index < entries.length; index += 1) {
		if (states[index] === 'matching') continue
		let uploadError
		try {
			await upload(entries[index])
		} catch (error) {
			uploadError = error
		}
		const uploadedState = await inspectRemote(
			entries[index],
			options.originUrl,
			fetchImpl,
			requestAttempts,
			retryDelay,
			true,
		)
		if (uploadedState !== 'matching') {
			if (uploadError) throw uploadError
			throw new Error(`COS upload did not become readable: ${entries[index].key}`)
		}
	}
	return entries
}

async function uploadMissing(entry, options) {
	await execFileAsync(
		'coscli',
		[
			'cp',
			entry.file,
			`cos://${options.bucket}/${entry.key}`,
			'--forbid-overwrite',
			'--meta',
			IMMUTABLE_CACHE_CONTROL,
			'--disable-log',
			'--config-path',
			options.configPath,
		],
		{ maxBuffer: 2 * 1024 * 1024 },
	)
}

async function inspectRemote(
	entry,
	originUrl,
	fetchImpl,
	requestAttempts,
	retryDelay,
	retryMissing,
) {
	const url = new URL(
		entry.key
			.split('/')
			.map((segment) => encodeURIComponent(segment))
			.join('/'),
		originUrl,
	)
	return withRetries(
		async () => {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
			try {
				const response = await fetchImpl(url, {
					signal: controller.signal,
					cache: 'no-store',
					redirect: 'error',
					headers: { 'Cache-Control': 'no-cache' },
				})
				if (response.status === 404) {
					if (retryMissing) throw new Error(`COS object is not readable yet: ${entry.key}`)
					return 'missing'
				}
				if (!response.ok) throw new Error(`COS origin returned ${response.status} for ${entry.key}`)
				if (!response.body) throw new Error(`COS origin returned no body for ${entry.key}`)
				const hash = createHash('sha512')
				let size = 0
				for await (const chunk of response.body) {
					const bytes = Buffer.from(chunk)
					size += bytes.byteLength
					if (size > entry.size) throw new Error(`Existing COS object is larger: ${entry.key}`)
					hash.update(bytes)
				}
				if (size !== entry.size || hash.digest('base64') !== entry.sha512) {
					throw new Error(`Existing COS object differs from the candidate: ${entry.key}`)
				}
				return 'matching'
			} finally {
				clearTimeout(timeout)
			}
		},
		requestAttempts,
		retryDelay,
	)
}

async function hashFile(file) {
	const hash = createHash('sha512')
	for await (const chunk of createReadStream(file)) hash.update(chunk)
	return { sha512: hash.digest('base64'), size: (await stat(file)).size }
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

function readOptions(argv) {
	const values = new Map()
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index]
		const value = argv[index + 1]
		if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? ''}`)
		values.set(key.slice(2), value)
	}
	const prefix = requireValue(values.get('prefix'), '--prefix').replace(/^\/+|\/+$/g, '')
	if (!/^electron\/(?:dev|beta|stable)\/[0-9A-Za-z.+-]+$/.test(prefix)) {
		throw new Error('--prefix must be an Electron channel/version path')
	}
	const originUrl = new URL(requireValue(values.get('origin-url'), '--origin-url'))
	const bucket = requireBucket(values.get('bucket'))
	if (
		originUrl.protocol !== 'https:' ||
		originUrl.username ||
		originUrl.password ||
		originUrl.search ||
		originUrl.hash ||
		originUrl.pathname !== '/'
	) {
		throw new Error('--origin-url must be an HTTPS COS origin root')
	}
	if (
		!originUrl.hostname.startsWith(`${bucket}.cos.`) ||
		!originUrl.hostname.endsWith('.myqcloud.com')
	) {
		throw new Error('--origin-url must belong to --bucket')
	}
	return {
		releaseDir: requireValue(values.get('release-dir'), '--release-dir'),
		prefix,
		originUrl: originUrl.toString(),
		bucket,
		configPath: path.resolve(requireValue(values.get('config'), '--config')),
	}
}

function requireBucket(value) {
	const result = requireValue(value, '--bucket')
	if (!/^[a-z0-9][a-z0-9-]{1,61}-[0-9]{5,}$/.test(result)) {
		throw new Error('--bucket must include the numeric app id suffix')
	}
	return result
}

function requireValue(value, name) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} is required`)
	return value.trim()
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main()
		.then((entries) => {
			process.stdout.write(`Published or reused ${entries.length} immutable COS objects.\n`)
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error))
			process.exitCode = 1
		})
}
