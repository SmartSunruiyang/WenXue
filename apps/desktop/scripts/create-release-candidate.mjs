import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { isValidSemver } from '@wenxue/client-operations'

import { readReleaseArtifactSet } from './release-artifact-set.mjs'

const REQUIRED_TARGET_KINDS = {
	darwin: ['dmg'],
	win32: ['nsis'],
}
const REQUIRED_TEST_EVIDENCE = new Set([
	'quality',
	'manual-installer-integrity',
	'manifest-tamper-rejection',
])

async function main() {
	const options = readOptions(process.argv.slice(2))
	const scriptDir = path.dirname(fileURLToPath(import.meta.url))
	const desktopRoot = path.resolve(scriptDir, '..')
	const repoRoot = path.resolve(desktopRoot, '../..')
	const releaseRoot = path.resolve(options.releaseDir)
	const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'))
	const extensionPackage = JSON.parse(
		await readFile(path.join(repoRoot, 'apps/extension/package.json'), 'utf8'),
	)
	const browserLock = JSON.parse(
		await readFile(path.join(desktopRoot, 'browser.lock.json'), 'utf8'),
	)
	const version = requireSemver(options.version ?? desktopPackage.version, 'version')
	if (desktopPackage.version !== version) {
		throw new Error(`package version ${desktopPackage.version} does not match requested ${version}`)
	}

	const artifactSet = await readReleaseArtifactSet(releaseRoot)
	const baseUrl = requireHttpsUrl(options.baseUrl, 'baseUrl').replace(/\/+$/, '')
	const releaseId = `electron:${options.channel}:${version}`
	const publicKey = releasePublicKey(process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY)
	const publicKeyFingerprint = createHash('sha256')
		.update(publicKey.export({ format: 'der', type: 'spki' }))
		.digest('hex')
	const artifactRecords = await Promise.all(
		artifactSet.records.map(async (record) => {
			const { file, relativePath } = record
			return {
				file,
				artifact: {
					...record.artifact,
					url: `${baseUrl}/${relativePath}`,
				},
			}
		}),
	)
	const artifacts = artifactRecords.map((record) => record.artifact)
	assertTargetMatrix(artifactRecords)

	const testEvidenceRaw = options.testEvidenceFile
		? await readFile(path.resolve(options.testEvidenceFile), 'utf8')
		: process.env.WENXUE_RELEASE_TEST_EVIDENCE
	const tests = readTestEvidence(testEvidenceRaw, artifactSet.artifactSetSha512)
	const createdAt = requireIsoDate(
		process.env.WENXUE_RELEASE_CREATED_AT,
		'WENXUE_RELEASE_CREATED_AT',
	)
	const manifest = {
		schemaVersion: 1,
		releaseId,
		runtime: 'electron',
		channel: options.channel,
		version,
		createdAt,
		manifestUrl: `${baseUrl}/candidate-manifest.json`,
		sourceCoordinates: {
			repository: process.env.GITHUB_REPOSITORY ?? 'SmartSunruiyang/WenXue',
			commit: requireValue(process.env.GITHUB_SHA, 'GITHUB_SHA'),
			browserVersion: requireValue(browserLock.version, 'browser version'),
			extensionVersion: requireValue(extensionPackage.version, 'extension version'),
			releasePublicKeyFingerprint: publicKeyFingerprint,
		},
		distribution: {
			mode: 'manual-unsigned',
		},
		tests,
		artifacts: artifacts.sort(compareArtifacts),
	}
	const canonicalManifest = canonicalJson(manifest)
	const privateKey = releasePrivateKey(process.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY)
	const manifestSignature = sign(null, Buffer.from(canonicalManifest), privateKey).toString(
		'base64',
	)
	if (
		!verify(
			null,
			Buffer.from(canonicalManifest),
			publicKey,
			Buffer.from(manifestSignature, 'base64'),
		)
	) {
		throw new Error('Release private key does not match the desktop manifest public key')
	}
	const outputDir = path.resolve(options.outputDir)

	await writeFile(path.join(outputDir, 'candidate-manifest.json'), `${canonicalManifest}\n`, 'utf8')
	await writeFile(path.join(outputDir, 'candidate-manifest.sig'), `${manifestSignature}\n`, 'utf8')
	await writeFile(
		path.join(outputDir, 'candidate-registration.json'),
		`${JSON.stringify(
			{
				manifestUrl: manifest.manifestUrl,
				manifest,
				manifestSignature,
				publicKeyFingerprint,
			},
			null,
			2,
		)}\n`,
		'utf8',
	)
}

function readOptions(argv) {
	const values = new Map()
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index]
		const value = argv[index + 1]
		if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? ''}`)
		values.set(key.slice(2), value)
	}
	const channel = values.get('channel') ?? 'stable'
	if (!['dev', 'beta', 'stable'].includes(channel))
		throw new Error(`Unsupported channel ${channel}`)
	return {
		channel,
		version: values.get('version'),
		baseUrl: requireValue(values.get('base-url'), '--base-url'),
		releaseDir: requireValue(values.get('release-dir'), '--release-dir'),
		outputDir: requireValue(values.get('output-dir'), '--output-dir'),
		testEvidenceFile: values.get('test-evidence'),
	}
}

function assertTargetMatrix(records) {
	const artifacts = records.map((record) => record.artifact)
	const targets = [
		{ platform: 'darwin', arch: 'arm64' },
		{ platform: 'darwin', arch: 'x64' },
		{ platform: 'win32', arch: 'x64' },
	]
	for (const target of targets) {
		const targetArtifacts = artifacts.filter(
			(artifact) => artifact.platform === target.platform && artifact.arch === target.arch,
		)
		const actualKinds = targetArtifacts.map((artifact) => artifact.kind).sort()
		const requiredKinds = REQUIRED_TARGET_KINDS[target.platform]
		if (
			actualKinds.length !== requiredKinds.length ||
			actualKinds.some((kind, index) => kind !== requiredKinds[index])
		) {
			throw new Error(
				`Expected exactly ${requiredKinds.join(', ')} for ${target.platform}/${target.arch}`,
			)
		}
	}
}

function readTestEvidence(raw, artifactSetSha512) {
	if (!raw) throw new Error('WENXUE_RELEASE_TEST_EVIDENCE is required')
	const tests = JSON.parse(raw)
	if (!Array.isArray(tests) || tests.length !== REQUIRED_TEST_EVIDENCE.size) {
		throw new Error('Release test evidence must contain exactly the three required checks')
	}
	const names = new Set()
	for (const test of tests) {
		if (
			!isRecord(test) ||
			!REQUIRED_TEST_EVIDENCE.has(test.name) ||
			test.status !== 'passed' ||
			typeof test.url !== 'string'
		) {
			throw new Error('Every release test evidence item must be a required passed check')
		}
		const allowedKeys =
			test.name === 'quality'
				? new Set(['name', 'status', 'url'])
				: new Set(['name', 'status', 'url', 'artifactSetSha512'])
		if (Object.keys(test).some((key) => !allowedKeys.has(key))) {
			throw new Error(`${test.name} evidence contains unsupported fields`)
		}
		if (names.has(test.name)) throw new Error('Release test evidence names must be unique')
		names.add(test.name)
		requireHttpsUrl(test.url, `${test.name} evidence URL`)
	}
	for (const required of REQUIRED_TEST_EVIDENCE) {
		if (!names.has(required)) throw new Error(`Missing required release evidence: ${required}`)
	}
	for (const test of tests) {
		if (test.name !== 'quality' && test.artifactSetSha512 !== artifactSetSha512) {
			throw new Error(`${test.name} evidence does not match the release artifact set`)
		}
	}
	return tests.map((test) => ({
		name: test.name,
		status: 'passed',
		url: requireHttpsUrl(test.url, `${test.name} evidence URL`),
	}))
}

function releasePrivateKey(raw) {
	const value = requireValue(raw, 'WENXUE_RELEASE_ED25519_PRIVATE_KEY').split('\\n').join('\n')
	return value.includes('BEGIN PRIVATE KEY')
		? createPrivateKey(value)
		: createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' })
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

function compareArtifacts(left, right) {
	return `${left.platform}:${left.arch}:${left.fileName}`.localeCompare(
		`${right.platform}:${right.arch}:${right.fileName}`,
	)
}

function requireSemver(value, name) {
	const result = requireValue(value, name)
	if (!isValidSemver(result)) {
		throw new Error(`${name} is not semver`)
	}
	return result
}

function requireHttpsUrl(value, name) {
	const result = requireValue(value, name)
	const parsed = new URL(result)
	if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS`)
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error(`${name} must not contain credentials, a query, or a fragment`)
	}
	return parsed.toString()
}

function requireIsoDate(value, name) {
	const result = requireValue(value, name)
	const milliseconds = Date.parse(result)
	if (!Number.isFinite(milliseconds)) throw new Error(`${name} must be an ISO timestamp`)
	return new Date(milliseconds).toISOString()
}

function requireValue(value, name) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} is required`)
	return value.trim()
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
