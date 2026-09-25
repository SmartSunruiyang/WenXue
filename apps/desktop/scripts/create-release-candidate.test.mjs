import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { canonicalJson } from '@wenxue/client-operations'

import { readReleaseArtifactSet } from './release-artifact-set.mjs'

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(new URL('./create-release-candidate.mjs', import.meta.url))
const desktopPackage = JSON.parse(
	await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)

test('desktop, bundled extension and website share the product version', async () => {
	const extensionPackage = JSON.parse(
		await readFile(fileURLToPath(new URL('../../extension/package.json', import.meta.url)), 'utf8'),
	)
	const websitePackage = JSON.parse(
		await readFile(fileURLToPath(new URL('../../website/package.json', import.meta.url)), 'utf8'),
	)
	assert.equal(extensionPackage.version, desktopPackage.version)
	assert.equal(websitePackage.version, desktopPackage.version)
})

test('creates a verifiable manual-unsigned candidate for the required Electron matrix', async () => {
	const releaseRoot = await createReleaseDirectory()
	try {
		const { privateKey, publicKey } = generateKeyPairSync('ed25519')
		const artifactSet = await readReleaseArtifactSet(releaseRoot)
		const scriptArguments = [
			scriptPath,
			'--version',
			desktopPackage.version,
			'--channel',
			'beta',
			'--release-dir',
			releaseRoot,
			'--output-dir',
			releaseRoot,
			'--base-url',
			`https://updates.wenxue.example/electron/beta/${desktopPackage.version}`,
		]
		const evidence = ['quality', 'manual-installer-integrity', 'manifest-tamper-rejection'].map(
			(name) => ({
				name,
				status: 'passed',
				url: `https://ci.wenxue.example/${name}`,
				...(name === 'quality' ? {} : { artifactSetSha512: artifactSet.artifactSetSha512 }),
			}),
		)
		const releaseEnv = {
			...process.env,
			GITHUB_REPOSITORY: 'SmartSunruiyang/WenXue',
			GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
			WENXUE_RELEASE_ED25519_PRIVATE_KEY: privateKey
				.export({ format: 'pem', type: 'pkcs8' })
				.toString(),
			WENXUE_RELEASE_ED25519_PUBLIC_KEY: publicKey
				.export({ format: 'pem', type: 'spki' })
				.toString(),
			WENXUE_RELEASE_CREATED_AT: '2026-07-17T10:00:00.000Z',
			WENXUE_RELEASE_TEST_EVIDENCE: JSON.stringify(evidence),
		}
		await execFileAsync(process.execPath, scriptArguments, { env: releaseEnv })

		const manifest = JSON.parse(
			await readFile(path.join(releaseRoot, 'candidate-manifest.json'), 'utf8'),
		)
		const signature = Buffer.from(
			(await readFile(path.join(releaseRoot, 'candidate-manifest.sig'), 'utf8')).trim(),
			'base64',
		)
		const registration = JSON.parse(
			await readFile(path.join(releaseRoot, 'candidate-registration.json'), 'utf8'),
		)

		assert.equal(manifest.releaseId, `electron:beta:${desktopPackage.version}`)
		assert.deepEqual(manifest.distribution, { mode: 'manual-unsigned' })
		assert.equal(manifest.artifacts.length, 2)
		assert.deepEqual(
			manifest.artifacts.map(({ platform, arch, kind }) => `${platform}:${arch}:${kind}`),
			['darwin:arm64:dmg', 'win32:x64:nsis'],
		)
		assert.equal(
			manifest.artifacts.some((value) => Object.hasOwn(value, 'feedUrl')),
			false,
		)
		assert.equal(Object.hasOwn(manifest, 'signingIdentity'), false)
		assert.deepEqual(registration.manifest, manifest)
		assert.equal(
			registration.publicKeyFingerprint,
			createHash('sha256')
				.update(publicKey.export({ format: 'der', type: 'spki' }))
				.digest('hex'),
		)
		assert.equal(verify(null, Buffer.from(canonicalJson(manifest)), publicKey, signature), true)

		for (const version of ['00.1.1', '0.1.1-01']) {
			await assert.rejects(
				execFileAsync(process.execPath, [...scriptArguments, '--version', version], {
					env: releaseEnv,
				}),
				/semver/i,
			)
		}

		const mismatchedEvidence = evidence.map((value) =>
			value.name === 'manual-installer-integrity'
				? { ...value, artifactSetSha512: Buffer.alloc(64, 9).toString('base64') }
				: value,
		)
		await assert.rejects(
			execFileAsync(process.execPath, scriptArguments, {
				env: {
					...releaseEnv,
					WENXUE_RELEASE_TEST_EVIDENCE: JSON.stringify(mismatchedEvidence),
				},
			}),
			/evidence does not match the release artifact set/i,
		)

		await assert.rejects(
			execFileAsync(process.execPath, scriptArguments, {
				env: {
					...releaseEnv,
					WENXUE_RELEASE_TEST_EVIDENCE: JSON.stringify([
						...evidence,
						{ name: 'unexpected', status: 'passed', url: 'https://ci.wenxue.example/extra' },
					]),
				},
			}),
			/exactly the three required checks/i,
		)

		await assert.rejects(
			execFileAsync(process.execPath, scriptArguments, {
				env: {
					...releaseEnv,
					WENXUE_RELEASE_TEST_EVIDENCE: JSON.stringify([
						evidence[0],
						evidence[1],
						{ ...evidence[1] },
					]),
				},
			}),
			/names must be unique/i,
		)

		await assert.rejects(
			execFileAsync(process.execPath, scriptArguments, {
				env: {
					...releaseEnv,
					WENXUE_RELEASE_TEST_EVIDENCE: JSON.stringify([
						{ ...evidence[0], unexpected: true },
						evidence[1],
						evidence[2],
					]),
				},
			}),
			/contains unsupported fields/i,
		)

		await rm(path.join(releaseRoot, 'darwin/arm64/WenXue.dmg'))
		await assert.rejects(
			execFileAsync(process.execPath, scriptArguments, { env: releaseEnv }),
			/(exactly two target installers|No release artifacts found)/i,
		)
	} finally {
		await rm(releaseRoot, { recursive: true, force: true })
	}
})

async function createReleaseDirectory() {
	const root = await mkdtemp(path.join(tmpdir(), 'wenxue-release-candidate-'))
	await Promise.all([
		writeArtifact(root, 'darwin/arm64/WenXue.dmg', 'mac-arm64-dmg'),
		writeArtifact(root, 'win32/x64/WenXue.exe', 'windows-installer'),
		writeArtifact(root, 'builder-debug.yml', 'do-not-publish: true'),
	])
	return root
}

async function writeArtifact(root, relativePath, contents) {
	const filePath = path.join(root, relativePath)
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, contents)
}
