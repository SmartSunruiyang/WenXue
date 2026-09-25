import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(new URL('./release-build-seal.mjs', import.meta.url))
const commit = '0123456789abcdef0123456789abcdef01234567'
const repository = 'SmartSunruiyang/WenXue'
const runUrl = `https://github.com/${repository}/actions/runs/123`
const { publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
const publicKeyFingerprint = createHash('sha256')
	.update(publicKey.export({ format: 'der', type: 'spki' }))
	.digest('hex')

test('seals exact release bytes and rejects a changed artifact', async () => {
	const root = await createReleaseDirectory()
	const seal = path.join(root, 'release-build.json')
	const githubEnv = path.join(root, 'github-env')
	try {
		await writeFile(githubEnv, '')
		await execFileAsync(
			process.execPath,
			[scriptPath, 'create', '--release-dir', root, '--output', seal],
			{ env: createEnvironment() },
		)
		await execFileAsync(process.execPath, verifyArguments(root, seal, githubEnv), {
			env: createEnvironment(),
		})
		const sealContents = JSON.parse(await readFile(seal, 'utf8'))
		assert.equal(sealContents.schemaVersion, 2)
		assert.equal(sealContents.artifacts.length, 2)
		assert.equal(sealContents.releasePublicKeyFingerprint, publicKeyFingerprint)
		const githubEnvContents = await readFile(githubEnv, 'utf8')
		assert.match(githubEnvContents, /WENXUE_RELEASE_CREATED_AT=2026-07-17T10:00:00.000Z/)
		assert.match(githubEnvContents, /WENXUE_ARTIFACT_SET_SHA512=/)
		assert.match(
			githubEnvContents,
			new RegExp(`WENXUE_RELEASE_PUBLIC_KEY_FINGERPRINT=${publicKeyFingerprint}`),
		)

		const { publicKey: differentPublicKey } = generateKeyPairSync('ed25519')
		await assert.rejects(
			execFileAsync(process.execPath, verifyArguments(root, seal, githubEnv), {
				env: {
					...createEnvironment(),
					WENXUE_RELEASE_ED25519_PUBLIC_KEY: differentPublicKey
						.export({ format: 'pem', type: 'spki' })
						.toString(),
				},
			}),
			/embedded or configured release public key/i,
		)

		await writeArtifact(root, 'win32/x64/WenXue.exe', 'changed-installer')
		await assert.rejects(
			execFileAsync(process.execPath, verifyArguments(root, seal, githubEnv), {
				env: createEnvironment(),
			}),
			/downloaded artifact bytes/i,
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('rejects leading zeros in release versions', async () => {
	const root = await createReleaseDirectory()
	const seal = path.join(root, 'release-build.json')
	try {
		for (const version of ['00.1.1', '0.1.1-01']) {
			await assert.rejects(
				execFileAsync(
					process.execPath,
					[scriptPath, 'create', '--release-dir', root, '--output', seal],
					{
						env: { ...createEnvironment(), RELEASE_VERSION: version },
					},
				),
				/semver/i,
			)
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('rejects installer artifacts built with different release keys', async () => {
	const root = await createReleaseDirectory()
	const seal = path.join(root, 'release-build.json')
	try {
		const { publicKey: differentPublicKey } = generateKeyPairSync('ed25519')
		const differentFingerprint = createHash('sha256')
			.update(differentPublicKey.export({ format: 'der', type: 'spki' }))
			.digest('hex')
		await writeArtifact(
			root,
			'win32/x64/release-public-key-fingerprint.txt',
			`${differentFingerprint}\n`,
		)
		await assert.rejects(
			execFileAsync(
				process.execPath,
				[scriptPath, 'create', '--release-dir', root, '--output', seal],
				{ env: createEnvironment() },
			),
			/do not contain the same release public key/i,
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('requires both target public-key proofs and rejects an extra installer', async () => {
	const root = await createReleaseDirectory()
	const seal = path.join(root, 'release-build.json')
	try {
		await rm(path.join(root, 'win32/x64/release-public-key-fingerprint.txt'))
		await assert.rejects(
			execFileAsync(
				process.execPath,
				[scriptPath, 'create', '--release-dir', root, '--output', seal],
				{
					env: createEnvironment(),
				},
			),
			/ENOENT/i,
		)
		await writeArtifact(
			root,
			'win32/x64/release-public-key-fingerprint.txt',
			`${publicKeyFingerprint}\n`,
		)
		await writeArtifact(root, 'darwin/x64/WenXue.dmg', 'extra-intel-installer')
		await assert.rejects(
			execFileAsync(
				process.execPath,
				[scriptPath, 'create', '--release-dir', root, '--output', seal],
				{
					env: createEnvironment(),
				},
			),
			/exactly two target installers/i,
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

function createEnvironment() {
	return {
		...process.env,
		GITHUB_REPOSITORY: repository,
		GITHUB_SHA: commit,
		RELEASE_VERSION: '0.1.1',
		RELEASE_CHANNEL: 'beta',
		WENXUE_RELEASE_ED25519_PUBLIC_KEY: publicKeyPem,
		WENXUE_RELEASE_RUN_URL: runUrl,
		WENXUE_RELEASE_CREATED_AT: '2026-07-17T10:00:00.000Z',
	}
}

function verifyArguments(root, seal, githubEnv) {
	return [
		scriptPath,
		'verify',
		'--release-dir',
		root,
		'--seal',
		seal,
		'--expected-repository',
		repository,
		'--expected-commit',
		commit,
		'--expected-version',
		'0.1.1',
		'--expected-channel',
		'beta',
		'--expected-run-url',
		runUrl,
		'--github-env',
		githubEnv,
	]
}

async function createReleaseDirectory() {
	const root = await mkdtemp(path.join(tmpdir(), 'wenxue-release-seal-'))
	await Promise.all([
		writeArtifact(root, 'darwin/arm64/WenXue.dmg', 'mac-arm64-dmg'),
		writeArtifact(root, 'win32/x64/WenXue.exe', 'win-installer'),
		writeArtifact(
			root,
			'darwin/arm64/release-public-key-fingerprint.txt',
			`${publicKeyFingerprint}\n`,
		),
		writeArtifact(
			root,
			'win32/x64/release-public-key-fingerprint.txt',
			`${publicKeyFingerprint}\n`,
		),
	])
	return root
}

async function writeArtifact(root, relativePath, contents) {
	const file = path.join(root, relativePath)
	await mkdir(path.dirname(file), { recursive: true })
	await writeFile(file, contents)
}
