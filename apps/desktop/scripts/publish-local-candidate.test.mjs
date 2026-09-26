import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { canonicalJson } from '@wenxue/client-operations'

import { runLocalCandidate } from './publish-local-candidate.mjs'
import { generateWindowsUpdateMetadata } from './release-artifact-set.mjs'

const execFile = promisify(execFileCallback)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sealScript = path.join(repoRoot, 'apps/desktop/scripts/release-build-seal.mjs')
const commit = 'a'.repeat(40)
const repository = 'SmartSunruiyang/WenXue'
const runId = '12345'
const runUrl = `https://github.com/${repository}/actions/runs/${runId}`
const version = JSON.parse(await readFile(path.join(repoRoot, 'apps/desktop/package.json'))).version

async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wenxue-local-candidate-'))
	const source = path.join(root, 'source')
	const releaseDir = path.join(root, 'candidate')
	const { publicKey, privateKey } = generateKeyPairSync('ed25519')
	const publicDer = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
	const fingerprint = (await import('node:crypto'))
		.createHash('sha256')
		.update(publicKey.export({ type: 'spki', format: 'der' }))
		.digest('hex')
	for (const [directory, file] of [
		['darwin/arm64', 'WenXue.dmg'],
		['win32/x64', `WenXue-${version}-win-x64.exe`],
	]) {
		await mkdir(path.join(source, directory), { recursive: true })
		await writeFile(path.join(source, directory, file), `${directory} installer bytes`)
		await writeFile(
			path.join(source, directory, 'release-public-key-fingerprint.txt'),
			`${fingerprint}\n`,
		)
	}
	await generateWindowsUpdateMetadata(path.join(source, 'win32/x64'), version, 'beta')
	const baseEnv = {
		...process.env,
		GITHUB_REPOSITORY: repository,
		GITHUB_SHA: commit,
		RELEASE_VERSION: version,
		RELEASE_CHANNEL: 'beta',
		WENXUE_RELEASE_RUN_URL: runUrl,
		WENXUE_RELEASE_CREATED_AT: '2026-09-25T00:00:00.000Z',
		WENXUE_RELEASE_ED25519_PUBLIC_KEY: publicDer,
	}
	await execFile(
		process.execPath,
		[
			sealScript,
			'create',
			'--release-dir',
			source,
			'--output',
			path.join(source, 'release-build.json'),
		],
		{ cwd: repoRoot, env: baseEnv },
	)
	const seal = JSON.parse(await readFile(path.join(source, 'release-build.json')))
	const options = { repository, runId, commit, version, channel: 'beta', releaseDir }
	const run = {
		id: Number(runId),
		html_url: runUrl,
		path: '.github/workflows/desktop-release-candidate.yml',
		head_branch: 'main',
		event: 'workflow_dispatch',
		status: 'completed',
		conclusion: 'success',
		run_attempt: 1,
		repository: { full_name: repository },
		head_repository: { full_name: repository },
		head_sha: commit,
	}
	const artifacts = {
		total_count: 3,
		artifacts: ['desktop-darwin-arm64', 'desktop-win32-x64', 'desktop-release-seal'].map(
			(name, index) => ({ name, id: index + 1, expired: false }),
		),
	}
	const calls = []
	const fakeExec = async (file, args, settings = {}) => {
		calls.push([file, args])
		if (file === 'git') {
			if (args[0] === 'status') return ''
			if (args[0] === 'rev-parse') return `${commit}\n`
			if (args[0] === 'remote') return `git@github.com:${repository}.git\n`
		}
		if (file === 'gh' && args[0] === 'api') {
			assert.deepEqual(args.slice(0, 3), ['api', '--hostname', 'github.com'])
			return JSON.stringify(args.at(-1).includes('/artifacts?') ? artifacts : run)
		}
		if (file === 'gh' && args[0] === 'run') {
			assert.equal(args[args.indexOf('--repo') + 1], `github.com/${repository}`)
			const name = args[args.indexOf('--name') + 1]
			const target = args[args.indexOf('--dir') + 1]
			const sourceDir = name === 'desktop-darwin-arm64' ? 'darwin/arm64' : 'win32/x64'
			if (name === 'desktop-release-seal')
				await cp(path.join(source, 'release-build.json'), path.join(target, 'release-build.json'))
			else await cp(path.join(source, sourceDir), target, { recursive: true })
			return ''
		}
		if (file === 'coscli') {
			return args[0] === '--version'
				? 'coscli version v1.0.8\n'
				: 'bucket versioning status is Closed'
		}
		if (file === process.execPath) {
			const scriptName = path.basename(args[0])
			if (
				['publish-immutable-candidate.mjs', 'verify-published-candidate.mjs'].includes(scriptName)
			) {
				return ''
			}
			const { stdout } = await execFile(file, args, { ...settings, maxBuffer: 4 * 1024 * 1024 })
			return stdout
		}
		throw new Error('Unexpected command')
	}
	return {
		root,
		source,
		releaseDir,
		options,
		run,
		artifacts,
		calls,
		fakeExec,
		seal,
		publicDer,
		privateKey,
		baseEnv,
	}
}

async function publicationFixture() {
	const value = await fixture()
	const configPath = path.join(value.root, 'cos.yaml')
	await writeFile(configPath, 'trusted local credentials')
	const names = [
		'WENXUE_RELEASE_ED25519_PUBLIC_KEY',
		'WENXUE_RELEASE_ED25519_PRIVATE_KEY',
		'WENXUE_UPDATE_COS_BUCKET',
		'WENXUE_UPDATE_COS_REGION',
		'WENXUE_UPDATE_COS_BASE_URL',
		'WENXUE_RELEASE_REGISTER_URL',
		'WENXUE_RELEASE_CI_TOKEN',
	]
	const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]))
	Object.assign(process.env, {
		WENXUE_RELEASE_ED25519_PUBLIC_KEY: value.publicDer,
		WENXUE_RELEASE_ED25519_PRIVATE_KEY: value.privateKey
			.export({ type: 'pkcs8', format: 'der' })
			.toString('base64'),
		WENXUE_UPDATE_COS_BUCKET: 'wenxue-123456',
		WENXUE_UPDATE_COS_REGION: 'ap-shanghai',
		WENXUE_UPDATE_COS_BASE_URL: 'https://wenxue-123456.cos.ap-shanghai.myqcloud.com/',
		WENXUE_RELEASE_REGISTER_URL: 'https://example.com/api/internal/v1/release-candidates/register',
		WENXUE_RELEASE_CI_TOKEN: 'top-secret-token',
	})
	const exec = async (file, args, settings) => {
		if (file === process.execPath) {
			const isSigner = path.basename(args[0]) === 'create-release-candidate.mjs'
			assert.equal(settings.env.WENXUE_RELEASE_CI_TOKEN, undefined)
			assert.equal(
				settings.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY,
				isSigner ? process.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY : undefined,
			)
		}
		if (file === process.execPath && path.basename(args[0]) === 'create-release-candidate.mjs') {
			const { stdout } = await execFile(file, args, { ...settings, maxBuffer: 4 * 1024 * 1024 })
			value.calls.push([file, args])
			return stdout
		}
		return value.fakeExec(file, args, settings)
	}
	return {
		value,
		exec,
		options: {
			...value.options,
			artifactSetSha512: value.seal.artifactSetSha512,
			cosConfig: configPath,
		},
		restore: () => {
			for (const [name, previous] of Object.entries(prior)) {
				if (previous === undefined) delete process.env[name]
				else process.env[name] = previous
			}
		},
	}
}

test('prepare downloads only the three trusted artifacts and verifies their actual bytes', async () => {
	const value = await fixture()
	const previous = process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
	process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = value.publicDer
	try {
		const review = await runLocalCandidate('prepare', value.options, { exec: value.fakeExec })
		assert.equal(review.artifactSetSha512, value.seal.artifactSetSha512)
		assert.equal(review.publicKeyFingerprint, value.seal.releasePublicKeyFingerprint)
		assert.deepEqual(review.artifacts, value.seal.artifacts)
		assert.equal(
			JSON.parse(await readFile(path.join(value.releaseDir, 'release-review.json'))).runUrl,
			runUrl,
		)
		assert.equal(value.calls.filter(([file, args]) => file === 'gh' && args[0] === 'run').length, 3)
		assert.equal(
			value.calls.some(
				([file, args]) => file === 'coscli' || args[0]?.endsWith('create-release-candidate.mjs'),
			),
			false,
		)
	} finally {
		if (previous === undefined) delete process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
		else process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = previous
	}
})

test('prepare rejects altered updater metadata and historical v2 seals before publication', async () => {
	for (const failure of ['metadata', 'v2-seal']) {
		const value = await fixture()
		const previous = process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
		process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = value.publicDer
		try {
			if (failure === 'metadata') {
				const metadataPath = path.join(value.source, 'win32/x64/beta.yml')
				const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
				metadata.files[0].url = '../wrong.exe'
				await writeFile(metadataPath, JSON.stringify(metadata))
			} else {
				await writeFile(
					path.join(value.source, 'release-build.json'),
					JSON.stringify({ ...value.seal, schemaVersion: 2 }),
				)
			}
			await assert.rejects(
				runLocalCandidate('prepare', value.options, { exec: value.fakeExec }),
				/(Windows update metadata|release command failed|v3 release build seal|target artifacts)/i,
			)
			assert.equal(
				value.calls.some(([file]) => file === 'coscli'),
				false,
			)
		} finally {
			if (previous === undefined) delete process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
			else process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = previous
		}
	}
})

test('checkout and source run rejection happens before any download or publish side effect', async () => {
	for (const rejection of [
		'dirty',
		'head',
		'origin',
		'run',
		'missing',
		'expired',
		'unknown-expiry',
		'duplicate',
		'bad-count',
		'zero-id',
	]) {
		const value = await fixture()
		const original = value.fakeExec
		const exec = async (file, args, settings) => {
			if (rejection === 'dirty' && file === 'git' && args[0] === 'status') return '?? stray.txt\n'
			if (rejection === 'head' && file === 'git' && args[0] === 'rev-parse')
				return `${'b'.repeat(40)}\n`
			if (rejection === 'origin' && file === 'git' && args[0] === 'remote')
				return 'https://token@github.com/SmartSunruiyang/WenXue.git\n'
			if (
				rejection === 'run' &&
				file === 'gh' &&
				args[0] === 'api' &&
				!args.at(-1).includes('/artifacts?')
			)
				return JSON.stringify({ ...value.run, head_sha: 'b'.repeat(40) })
			if (file === 'gh' && args[0] === 'api' && args.at(-1).includes('/artifacts?')) {
				const artifacts = structuredClone(value.artifacts)
				if (rejection === 'missing') artifacts.artifacts.pop()
				if (rejection === 'expired') artifacts.artifacts[0].expired = true
				if (rejection === 'unknown-expiry') delete artifacts.artifacts[0].expired
				if (rejection === 'duplicate') {
					artifacts.artifacts.push(artifacts.artifacts[0])
					artifacts.total_count += 1
				}
				if (rejection === 'bad-count') artifacts.total_count -= 1
				if (rejection === 'zero-id') artifacts.artifacts[0].id = 0
				return JSON.stringify(artifacts)
			}
			return original(file, args, settings)
		}
		await assert.rejects(runLocalCandidate('prepare', value.options, { exec }))
		assert.equal(
			value.calls.some(([file, args]) => file === 'gh' && args[0] === 'run'),
			false,
			rejection,
		)
	}
})

test('publish rechecks seal and operator hash before signing, upload or registration', async () => {
	const value = await fixture()
	const previous = process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
	process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = value.publicDer
	try {
		await runLocalCandidate('prepare', value.options, { exec: value.fakeExec })
		await assert.rejects(
			runLocalCandidate(
				'publish',
				{
					...value.options,
					artifactSetSha512: Buffer.alloc(64).toString('base64'),
					cosConfig: path.join(value.root, 'cos.yaml'),
				},
				{ exec: value.fakeExec },
			),
			/Confirmed artifact set/,
		)
		assert.equal(
			value.calls.some(
				([file, args]) => file === 'coscli' || args[0]?.endsWith('create-release-candidate.mjs'),
			),
			false,
		)
		await writeFile(
			path.join(value.releaseDir, 'darwin/arm64/WenXue.dmg'),
			'changed installer bytes',
		)
		await assert.rejects(
			runLocalCandidate(
				'publish',
				{
					...value.options,
					artifactSetSha512: value.seal.artifactSetSha512,
					cosConfig: path.join(value.root, 'cos.yaml'),
				},
				{ exec: value.fakeExec },
			),
			/release command failed|seal/i,
		)
		assert.equal(
			value.calls.some(
				([file, args]) => file === 'coscli' || args[0]?.endsWith('create-release-candidate.mjs'),
			),
			false,
		)
	} finally {
		if (previous === undefined) delete process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
		else process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = previous
	}
})

test('publish signs after verification, checks COS, uploads, verifies public bytes, then registers', async () => {
	const { value, exec, options, restore } = await publicationFixture()
	try {
		await runLocalCandidate('prepare', value.options, { exec })
		const publication = await runLocalCandidate('publish', options, {
			exec,
			fetchImpl: async (_url, request) => {
				assert.equal(request.redirect, 'error')
				assert.equal(request.headers.Authorization, 'Bearer top-secret-token')
				assert.equal(JSON.parse(request.body).manifest.sourceCoordinates.commit, commit)
				value.calls.push(['register', []])
				return {
					ok: true,
					json: async () => ({
						candidate: {
							releaseId: `electron:beta:${version}`,
							manifestUrl: `https://wenxue-123456.cos.ap-shanghai.myqcloud.com/electron/beta/${version}/candidate-manifest.json`,
							status: 'verified',
						},
					}),
				}
			},
		})
		assert.equal(publication.status, 'verified')
		const ordered = value.calls.map(([file, args]) =>
			file === 'register'
				? 'register'
				: file === 'coscli'
					? `coscli:${args[0]}`
					: file === process.execPath
						? path.basename(args[0])
						: '',
		)
		const position = (name) => ordered.lastIndexOf(name)
		assert.ok(position('release-build-seal.mjs') < position('create-release-candidate.mjs'))
		assert.ok(position('create-release-candidate.mjs') < position('coscli:bucket-versioning'))
		assert.ok(position('coscli:bucket-versioning') < position('publish-immutable-candidate.mjs'))
		assert.ok(
			position('publish-immutable-candidate.mjs') < position('verify-published-candidate.mjs'),
		)
		assert.ok(position('verify-published-candidate.mjs') < position('register'))
		assert.equal(JSON.stringify(publication).includes('top-secret-token'), false)
	} finally {
		restore()
	}
})

test('publish stops before registration on COS or public verification failure and bounds registration retries', async () => {
	const { value, exec, options, restore } = await publicationFixture()
	try {
		await runLocalCandidate('prepare', value.options, { exec })
		for (const failure of ['cos-version', 'versioning', 'upload', 'public-verify']) {
			let registrationCalls = 0
			const failingExec = async (file, args, settings) => {
				const scriptName = file === process.execPath ? path.basename(args[0]) : ''
				if (failure === 'cos-version' && file === 'coscli' && args[0] === '--version')
					return 'coscli version v1.0.7'
				if (failure === 'versioning' && file === 'coscli' && args[0] === 'bucket-versioning')
					return 'bucket versioning status is Enabled'
				if (failure === 'upload' && scriptName === 'publish-immutable-candidate.mjs')
					throw new Error('Immutable upload failed')
				if (failure === 'public-verify' && scriptName === 'verify-published-candidate.mjs')
					throw new Error('Published bytes differ')
				return exec(file, args, settings)
			}
			await assert.rejects(
				runLocalCandidate('publish', options, {
					exec: failingExec,
					fetchImpl: async () => {
						registrationCalls += 1
						throw new Error('Registration must not run')
					},
				}),
				undefined,
				failure,
			)
			assert.equal(registrationCalls, 0, failure)
		}
		let attempts = 0
		await assert.rejects(
			runLocalCandidate('publish', options, {
				exec,
				delay: async () => {},
				fetchImpl: async () => {
					attempts += 1
					return { ok: false, status: 503, text: async () => 'response-body-secret' }
				},
			}),
			(error) => {
				assert.match(error.message, /could not be confirmed/)
				assert.equal(error.message.includes('response-body-secret'), false)
				assert.equal(error.message.includes('top-secret-token'), false)
				return true
			},
		)
		assert.equal(attempts, 3)
	} finally {
		restore()
	}
})

test('different configured public key fails publish before any signing or COS operation', async () => {
	const value = await fixture()
	const prior = process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
	process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = value.publicDer
	try {
		await runLocalCandidate('prepare', value.options, { exec: value.fakeExec })
		const otherKey = generateKeyPairSync('ed25519')
			.publicKey.export({ type: 'spki', format: 'der' })
			.toString('base64')
		process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = otherKey
		await assert.rejects(
			runLocalCandidate(
				'publish',
				{
					...value.options,
					artifactSetSha512: value.seal.artifactSetSha512,
					cosConfig: path.join(value.root, 'cos.yaml'),
				},
				{ exec: value.fakeExec },
			),
		)
		assert.equal(
			value.calls.some(
				([file, args]) => file === 'coscli' || args[0]?.endsWith('create-release-candidate.mjs'),
			),
			false,
		)
	} finally {
		if (prior === undefined) delete process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY
		else process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = prior
	}
})

test('malformed register URL cannot leak its input in an error', async () => {
	const value = await fixture()
	const configPath = path.join(value.root, 'cos.yaml')
	await writeFile(configPath, 'trusted local credentials')
	const names = [
		'WENXUE_RELEASE_ED25519_PUBLIC_KEY',
		'WENXUE_RELEASE_ED25519_PRIVATE_KEY',
		'WENXUE_UPDATE_COS_BUCKET',
		'WENXUE_UPDATE_COS_REGION',
		'WENXUE_UPDATE_COS_BASE_URL',
		'WENXUE_RELEASE_REGISTER_URL',
		'WENXUE_RELEASE_CI_TOKEN',
	]
	const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]))
	Object.assign(process.env, {
		WENXUE_RELEASE_ED25519_PUBLIC_KEY: value.publicDer,
		WENXUE_RELEASE_ED25519_PRIVATE_KEY: 'private-secret',
		WENXUE_UPDATE_COS_BUCKET: 'wenxue-123456',
		WENXUE_UPDATE_COS_REGION: 'ap-shanghai',
		WENXUE_UPDATE_COS_BASE_URL: 'https://wenxue-123456.cos.ap-shanghai.myqcloud.com/',
		WENXUE_RELEASE_REGISTER_URL: 'https://user:secret@',
		WENXUE_RELEASE_CI_TOKEN: 'top-secret-token',
	})
	try {
		await runLocalCandidate('prepare', value.options, { exec: value.fakeExec })
		await assert.rejects(
			runLocalCandidate(
				'publish',
				{
					...value.options,
					artifactSetSha512: value.seal.artifactSetSha512,
					cosConfig: configPath,
				},
				{ exec: value.fakeExec },
			),
			(error) => {
				assert.match(error.message, /WENXUE_RELEASE_REGISTER_URL/)
				assert.equal(error.message.includes('secret'), false)
				return true
			},
		)
	} finally {
		for (const [name, previous] of Object.entries(prior)) {
			if (previous === undefined) delete process.env[name]
			else process.env[name] = previous
		}
	}
})

test('prepare-upload lists five exact CloudBase hosting paths and resumes matching partial uploads', async () => {
	const value = await fixture()
	const prior = {
		publicKey: process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY,
		privateKey: process.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY,
	}
	process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY = value.publicDer
	process.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY = value.privateKey
		.export({ type: 'pkcs8', format: 'der' })
		.toString('base64')
	const remote = new Map()
	const fetchImpl = async (url) => {
		const bytes = remote.get(String(url))
		return bytes ? new Response(bytes) : new Response('', { status: 404 })
	}
	const options = { ...value.options, artifactSetSha512: value.seal.artifactSetSha512 }
	try {
		await runLocalCandidate('prepare', value.options, { exec: value.fakeExec })
		await assert.rejects(
			runLocalCandidate(
				'prepare-upload',
				{
					...options,
					artifactSetSha512: Buffer.alloc(64).toString('base64'),
				},
				{ exec: value.fakeExec, fetchImpl },
			),
			/Confirmed artifact set/i,
		)
		assert.equal(
			value.calls.some(([, args]) => args[0]?.endsWith('create-release-candidate.mjs')),
			false,
		)
		const plan = await runLocalCandidate('prepare-upload', options, {
			exec: value.fakeExec,
			fetchImpl,
		})
		assert.equal(plan.length, 5)
		assert.deepEqual(
			plan.map((item) => path.basename(item.localPath)).sort(),
			[
				'beta.yml',
				'candidate-manifest.json',
				'candidate-manifest.sig',
				`WenXue-${version}-win-x64.exe`,
				'WenXue.dmg',
			].sort(),
		)
		assert.ok(
			plan.every((item) => item.cloudPath.startsWith(`desktop-releases/electron/beta/${version}/`)),
		)
		assert.ok(
			plan.every((item) => item.publicUrl.startsWith('https://askwenxue.com/desktop-releases/')),
		)
		assert.deepEqual(
			JSON.parse(await readFile(path.join(value.releaseDir, 'hosting-upload.json'))),
			plan,
		)
		assert.ok(plan.every((item) => item.disposition === 'upload'))
		assert.equal(JSON.stringify(plan).includes('PRIVATE KEY'), false)
		assert.equal(
			value.calls.some(([file]) => file === 'coscli'),
			false,
		)
		remote.set(plan[0].publicUrl, await readFile(plan[0].localPath))
		const resumed = await runLocalCandidate('prepare-upload', options, {
			exec: value.fakeExec,
			fetchImpl,
		})
		assert.equal(resumed[0].disposition, 'reuse')
		assert.ok(resumed.slice(1).every((item) => item.disposition === 'upload'))
		remote.set(plan[1].publicUrl, Buffer.from('wrong existing bytes'))
		await assert.rejects(
			runLocalCandidate('prepare-upload', options, {
				exec: value.fakeExec,
				fetchImpl,
			}),
			/differs from local candidate bytes/i,
		)
	} finally {
		for (const [name, previous] of Object.entries({
			WENXUE_RELEASE_ED25519_PUBLIC_KEY: prior.publicKey,
			WENXUE_RELEASE_ED25519_PRIVATE_KEY: prior.privateKey,
		})) {
			if (previous === undefined) delete process.env[name]
			else process.env[name] = previous
		}
	}
})

test('register-upload requires all five public bytes and does not need signing or COS credentials', async () => {
	const value = await fixture()
	const names = [
		'WENXUE_RELEASE_ED25519_PUBLIC_KEY',
		'WENXUE_RELEASE_ED25519_PRIVATE_KEY',
		'WENXUE_RELEASE_REGISTER_URL',
		'WENXUE_RELEASE_CI_TOKEN',
	]
	const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]))
	Object.assign(process.env, {
		WENXUE_RELEASE_ED25519_PUBLIC_KEY: value.publicDer,
		WENXUE_RELEASE_ED25519_PRIVATE_KEY: value.privateKey
			.export({ type: 'pkcs8', format: 'der' })
			.toString('base64'),
		WENXUE_RELEASE_REGISTER_URL: 'https://example.com/api/internal/v1/release-candidates/register',
		WENXUE_RELEASE_CI_TOKEN: 'top-secret-token',
	})
	const remote = new Map()
	const options = { ...value.options, artifactSetSha512: value.seal.artifactSetSha512 }
	let registrationCalls = 0
	const publicReads = new Map()
	try {
		await runLocalCandidate('prepare', value.options, { exec: value.fakeExec })
		const plan = await runLocalCandidate('prepare-upload', options, {
			exec: value.fakeExec,
			fetchImpl: async () => new Response('', { status: 404 }),
		})
		delete process.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY
		for (const entry of plan.slice(0, 4))
			remote.set(entry.publicUrl, await readFile(entry.localPath))
		const fetchImpl = async (url, request) => {
			if (request?.method === 'POST') {
				registrationCalls += 1
				return new Response(
					JSON.stringify({
						candidate: {
							releaseId: `electron:beta:${version}`,
							manifestUrl: `https://askwenxue.com/desktop-releases/electron/beta/${version}/candidate-manifest.json`,
							status: 'verified',
						},
					}),
					{ headers: { 'Content-Type': 'application/json' } },
				)
			}
			const bytes = remote.get(String(url))
			publicReads.set(String(url), (publicReads.get(String(url)) ?? 0) + 1)
			return bytes ? new Response(bytes) : new Response('', { status: 404 })
		}
		const exec = async (file, args, settings) => {
			if (
				file === process.execPath &&
				path.basename(args[0]) === 'verify-published-candidate.mjs'
			) {
				const manifest = JSON.parse(
					await readFile(path.join(value.releaseDir, 'candidate-manifest.json')),
				)
				const manifestSignature = (
					await readFile(path.join(value.releaseDir, 'candidate-manifest.sig'), 'utf8')
				).trim()
				await writeFile(
					args[args.indexOf('--registration-output') + 1],
					JSON.stringify({
						manifestUrl: manifest.manifestUrl,
						manifest,
						manifestSignature,
						publicKeyFingerprint: manifest.sourceCoordinates.releasePublicKeyFingerprint,
					}),
				)
				assert.equal(settings.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY, undefined)
			}
			return value.fakeExec(file, args, settings)
		}
		await assert.rejects(
			runLocalCandidate('register-upload', options, { exec, fetchImpl }),
			/missing or unreadable/i,
		)
		assert.equal(registrationCalls, 0)
		remote.set(plan[4].publicUrl, await readFile(plan[4].localPath))
		const result = await runLocalCandidate('register-upload', options, { exec, fetchImpl })
		assert.equal(result.status, 'verified')
		assert.equal(registrationCalls, 1)
		const manifestPath = path.join(value.releaseDir, 'candidate-manifest.json')
		const signaturePath = path.join(value.releaseDir, 'candidate-manifest.sig')
		const approvedManifestBytes = await readFile(manifestPath)
		const approvedSignatureBytes = await readFile(signaturePath)
		for (const mutation of [
			(manifest) => {
				manifest.tests[0].url = `${runUrl}/other-run`
			},
			(manifest) => {
				manifest.artifacts[0].sha512 = Buffer.alloc(64, 9).toString('base64')
			},
		]) {
			const different = JSON.parse(approvedManifestBytes)
			mutation(different)
			const signedBytes = Buffer.from(`${canonicalJson(different)}\n`)
			const signatureBytes = Buffer.from(
				`${sign(null, Buffer.from(canonicalJson(different)), value.privateKey).toString(
					'base64',
				)}\n`,
			)
			await writeFile(manifestPath, signedBytes)
			await writeFile(signaturePath, signatureBytes)
			remote.set(plan[3].publicUrl, signatureBytes)
			remote.set(plan[4].publicUrl, signedBytes)
			await assert.rejects(
				runLocalCandidate('register-upload', options, { exec, fetchImpl }),
				/approved build seal and source run/i,
			)
			assert.equal(registrationCalls, 1)
		}
		await writeFile(manifestPath, approvedManifestBytes)
		await writeFile(signaturePath, approvedSignatureBytes)
		remote.set(plan[3].publicUrl, approvedSignatureBytes)
		remote.set(plan[4].publicUrl, approvedManifestBytes)
		const divergentExec = async (file, args, settings) => {
			const result = await exec(file, args, settings)
			if (
				file === process.execPath &&
				path.basename(args[0]) === 'verify-published-candidate.mjs'
			) {
				const output = args[args.indexOf('--registration-output') + 1]
				const registration = JSON.parse(await readFile(output))
				registration.manifest.tests[0].url = `${runUrl}/different-output`
				await writeFile(output, JSON.stringify(registration))
			}
			return result
		}
		await assert.rejects(
			runLocalCandidate('register-upload', options, {
				exec: divergentExec,
				fetchImpl,
			}),
			/verification output differs from the approved local candidate/i,
		)
		assert.equal(registrationCalls, 1)
		assert.ok(plan.slice(0, 3).every((entry) => !publicReads.has(entry.publicUrl)))
		assert.ok(value.calls.some(([, args]) => args[0]?.endsWith('verify-published-candidate.mjs')))
		assert.equal(
			value.calls.some(([file]) => file === 'coscli'),
			false,
		)
		remote.set(plan[4].publicUrl, Buffer.from('changed signed manifest bytes'))
		await assert.rejects(
			runLocalCandidate('register-upload', options, { exec, fetchImpl }),
			/differs from local candidate bytes/i,
		)
		assert.equal(registrationCalls, 1)
	} finally {
		for (const [name, previous] of Object.entries(prior)) {
			if (previous === undefined) delete process.env[name]
			else process.env[name] = previous
		}
	}
})
