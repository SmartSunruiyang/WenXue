import { createHash, createPublicKey } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { isValidSemver } from '@wenxue/client-operations'

import { readReleaseArtifactSet } from './release-artifact-set.mjs'

const EMBEDDED_RELEASE_KEY_PROOF_NAME = 'release-public-key-fingerprint.txt'
const REQUIRED_RELEASE_TARGETS = ['darwin/arm64', 'darwin/x64', 'win32/x64']

async function main() {
	const [command, ...argv] = process.argv.slice(2)
	if (command === 'create') return createBuildSeal(readOptions(argv))
	if (command === 'verify') return verifyBuildSeal(readOptions(argv))
	throw new Error('Usage: release-build-seal.mjs <create|verify> [options]')
}

async function createBuildSeal(options) {
	const releaseDir = requireOption(options, 'release-dir')
	const artifactSet = await readReleaseArtifactSet(releaseDir)
	const embeddedReleasePublicKeyFingerprint = await readEmbeddedReleaseKeyFingerprint(releaseDir)
	const configuredReleasePublicKeyFingerprint = releasePublicKeyFingerprint(
		process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY,
	)
	if (embeddedReleasePublicKeyFingerprint !== configuredReleasePublicKeyFingerprint) {
		throw new Error('Built desktop bundles do not contain the configured release public key')
	}
	const output = path.resolve(requireOption(options, 'output'))
	const seal = {
		schemaVersion: 2,
		runtime: 'electron',
		repository: requireValue(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY'),
		commit: requireCommit(process.env.GITHUB_SHA, 'GITHUB_SHA'),
		version: requireSemver(process.env.RELEASE_VERSION, 'RELEASE_VERSION'),
		channel: requireChannel(process.env.RELEASE_CHANNEL, 'RELEASE_CHANNEL'),
		buildRunUrl: requireHttpsUrl(process.env.WENXUE_RELEASE_RUN_URL, 'WENXUE_RELEASE_RUN_URL'),
		createdAt: requireIsoDate(process.env.WENXUE_RELEASE_CREATED_AT, 'WENXUE_RELEASE_CREATED_AT'),
		releasePublicKeyFingerprint: embeddedReleasePublicKeyFingerprint,
		artifactSetSha512: artifactSet.artifactSetSha512,
		artifacts: artifactSet.entries,
	}
	await mkdir(path.dirname(output), { recursive: true })
	await writeFile(output, `${JSON.stringify(seal, null, 2)}\n`, 'utf8')
	process.stdout.write(`${seal.artifactSetSha512}\n`)
}

async function verifyBuildSeal(options) {
	const releaseDir = requireOption(options, 'release-dir')
	const artifactSet = await readReleaseArtifactSet(releaseDir)
	const embeddedReleasePublicKeyFingerprint = await readEmbeddedReleaseKeyFingerprint(releaseDir)
	const configuredReleasePublicKeyFingerprint = releasePublicKeyFingerprint(
		process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY,
	)
	const seal = JSON.parse(await readFile(path.resolve(requireOption(options, 'seal')), 'utf8'))
	if (!isRecord(seal)) throw new Error('Release build seal must be an object')
	assertOnlyKeys(seal, [
		'schemaVersion',
		'runtime',
		'repository',
		'commit',
		'version',
		'channel',
		'buildRunUrl',
		'createdAt',
		'releasePublicKeyFingerprint',
		'artifactSetSha512',
		'artifacts',
	])
	const expected = {
		repository: requireOption(options, 'expected-repository'),
		commit: requireCommit(requireOption(options, 'expected-commit'), '--expected-commit'),
		version: requireSemver(requireOption(options, 'expected-version'), '--expected-version'),
		channel: requireChannel(requireOption(options, 'expected-channel'), '--expected-channel'),
		buildRunUrl: requireHttpsUrl(requireOption(options, 'expected-run-url'), '--expected-run-url'),
	}
	if (
		seal.schemaVersion !== 2 ||
		seal.runtime !== 'electron' ||
		seal.repository !== expected.repository ||
		seal.commit !== expected.commit ||
		seal.version !== expected.version ||
		seal.channel !== expected.channel ||
		seal.buildRunUrl !== expected.buildRunUrl
	) {
		throw new Error('Release build seal does not match the trusted source run')
	}
	if (
		!isPublicKeyFingerprint(seal.releasePublicKeyFingerprint) ||
		seal.releasePublicKeyFingerprint !== embeddedReleasePublicKeyFingerprint ||
		seal.releasePublicKeyFingerprint !== configuredReleasePublicKeyFingerprint
	) {
		throw new Error(
			'Release build seal does not match the embedded or configured release public key',
		)
	}
	const createdAt = requireIsoDate(seal.createdAt, 'release build createdAt')
	if (
		seal.artifactSetSha512 !== artifactSet.artifactSetSha512 ||
		canonicalJson(seal.artifacts) !== canonicalJson(artifactSet.entries)
	) {
		throw new Error('Release build seal does not match the downloaded artifact bytes')
	}
	const githubEnv = options.get('github-env')
	if (githubEnv) {
		await appendFile(
			path.resolve(githubEnv),
			[
				`WENXUE_RELEASE_CREATED_AT=${createdAt}`,
				`WENXUE_RELEASE_PUBLIC_KEY_FINGERPRINT=${seal.releasePublicKeyFingerprint}`,
				`WENXUE_ARTIFACT_SET_SHA512=${artifactSet.artifactSetSha512}`,
				'',
			].join('\n'),
			'utf8',
		)
	}
	process.stdout.write(`Verified release build seal ${artifactSet.artifactSetSha512}.\n`)
}

async function readEmbeddedReleaseKeyFingerprint(releaseDirValue) {
	const releaseDir = path.resolve(releaseDirValue)
	const fingerprints = await Promise.all(
		REQUIRED_RELEASE_TARGETS.map(async (target) => {
			const proof = await readFile(
				path.join(releaseDir, target, EMBEDDED_RELEASE_KEY_PROOF_NAME),
				'utf8',
			)
			const fingerprint = proof.trim()
			if (!isPublicKeyFingerprint(fingerprint)) {
				throw new Error(`Embedded release key proof is invalid for ${target}`)
			}
			return fingerprint
		}),
	)
	if (fingerprints.some((fingerprint) => fingerprint !== fingerprints[0])) {
		throw new Error('Built desktop bundles do not contain the same release public key')
	}
	return fingerprints[0]
}

function releasePublicKeyFingerprint(raw) {
	const value = requireValue(raw, 'WENXUE_RELEASE_ED25519_PUBLIC_KEY').split('\\n').join('\n')
	const publicKey = value.includes('BEGIN PUBLIC KEY')
		? createPublicKey(value)
		: createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' })
	return createHash('sha256')
		.update(publicKey.export({ format: 'der', type: 'spki' }))
		.digest('hex')
}

function isPublicKeyFingerprint(value) {
	return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function readOptions(argv) {
	const values = new Map()
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index]
		const value = argv[index + 1]
		if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? ''}`)
		values.set(key.slice(2), value)
	}
	return values
}

function assertOnlyKeys(value, allowed) {
	const allowedSet = new Set(allowed)
	if (Object.keys(value).some((key) => !allowedSet.has(key))) {
		throw new Error('Release build seal contains unsupported fields')
	}
}

function requireOption(options, name) {
	return requireValue(options.get(name), `--${name}`)
}

function requireChannel(value, name) {
	const result = requireValue(value, name)
	if (!['dev', 'beta', 'stable'].includes(result)) throw new Error(`${name} is invalid`)
	return result
}

function requireCommit(value, name) {
	const result = requireValue(value, name).toLowerCase()
	if (!/^[a-f0-9]{40}$/.test(result)) throw new Error(`${name} must be a 40 character commit`)
	return result
}

function requireSemver(value, name) {
	const result = requireValue(value, name)
	if (!isValidSemver(result)) {
		throw new Error(`${name} must be semver`)
	}
	return result
}

function requireIsoDate(value, name) {
	const result = requireValue(value, name)
	const milliseconds = Date.parse(result)
	if (!Number.isFinite(milliseconds)) throw new Error(`${name} must be an ISO timestamp`)
	return new Date(milliseconds).toISOString()
}

function requireHttpsUrl(value, name) {
	const parsed = new URL(requireValue(value, name))
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
		throw new Error(`${name} must be a safe HTTPS URL`)
	}
	return parsed.toString()
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
