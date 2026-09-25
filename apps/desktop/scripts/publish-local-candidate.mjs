import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { isValidSemver } from '@wenxue/client-operations'

import { validateTrustedSourceRun } from './resolve-release-source-run.mjs'

const execFileAsync = promisify(execFileCallback)
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..')
const ARTIFACT_PATHS = new Map([
	['desktop-darwin-arm64', 'darwin/arm64'],
	['desktop-win32-x64', 'win32/x64'],
	['desktop-release-seal', '.'],
])

export async function runLocalCandidate(command, options, dependencies = {}) {
	const exec = dependencies.exec ?? safeExec
	const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
	const repoRoot = dependencies.repoRoot ?? REPO_ROOT
	const input = validateOptions(command, options)
	await verifyCheckout(input, repoRoot, exec)
	const run = JSON.parse(
		await exec(
			'gh',
			['api', '--hostname', 'github.com', `repos/${input.repository}/actions/runs/${input.runId}`],
			{
				cwd: repoRoot,
			},
		),
	)
	const runUrl = validateTrustedSourceRun(run, {
		runId: input.runId,
		repository: input.repository,
		expectedCommit: input.commit,
	})
	const releaseDir = path.resolve(input.releaseDir)
	if (command === 'prepare') {
		const artifactResponse = JSON.parse(
			await exec(
				'gh',
				[
					'api',
					'--hostname',
					'github.com',
					`repos/${input.repository}/actions/runs/${input.runId}/artifacts?per_page=100`,
				],
				{ cwd: repoRoot },
			),
		)
		const artifacts = validateArtifacts(artifactResponse)
		await mkdir(releaseDir)
		for (const [name, destination] of ARTIFACT_PATHS) {
			const target = path.join(releaseDir, destination)
			await mkdir(target, { recursive: true })
			await exec(
				'gh',
				[
					'run',
					'download',
					input.runId,
					'--repo',
					`github.com/${input.repository}`,
					'--name',
					name,
					'--dir',
					target,
				],
				{ cwd: repoRoot },
			)
		}
		const seal = await verifySeal(input, runUrl, releaseDir, repoRoot, exec)
		const review = {
			repository: input.repository,
			commit: input.commit,
			runId: input.runId,
			runUrl,
			version: input.version,
			channel: input.channel,
			artifactSetSha512: seal.artifactSetSha512,
			publicKeyFingerprint: seal.releasePublicKeyFingerprint,
			createdAt: seal.createdAt,
			artifacts: seal.artifacts,
			githubArtifacts: artifacts.map(({ name, id }) => ({ name, id })),
		}
		await writeFile(
			path.join(releaseDir, 'release-review.json'),
			`${JSON.stringify(review, null, 2)}\n`,
			{ mode: 0o600 },
		)
		return review
	}
	const seal = await verifySeal(input, runUrl, releaseDir, repoRoot, exec)
	if (seal.artifactSetSha512 !== input.artifactSetSha512) {
		throw new Error('Confirmed artifact set SHA-512 differs from verified installer bytes')
	}
	const publication = await validatePublication(input, repoRoot, exec)
	const releaseEnv = {
		PATH: process.env.PATH,
		GITHUB_REPOSITORY: input.repository,
		GITHUB_SHA: input.commit,
		WENXUE_RELEASE_RUN_URL: runUrl,
		WENXUE_RELEASE_CREATED_AT: seal.createdAt,
		WENXUE_RELEASE_ED25519_PUBLIC_KEY: process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY,
	}
	await script(
		'create-release-evidence.mjs',
		['--release-dir', releaseDir, '--output', path.join(releaseDir, 'release-evidence.json')],
		repoRoot,
		exec,
		releaseEnv,
	)
	const prefix = `electron/${input.channel}/${input.version}`
	const candidateBaseUrl = `${publication.originUrl}${prefix}`
	await script(
		'create-release-candidate.mjs',
		[
			'--version',
			input.version,
			'--channel',
			input.channel,
			'--release-dir',
			releaseDir,
			'--output-dir',
			releaseDir,
			'--base-url',
			candidateBaseUrl,
			'--test-evidence',
			path.join(releaseDir, 'release-evidence.json'),
		],
		repoRoot,
		exec,
		{
			...releaseEnv,
			WENXUE_RELEASE_ED25519_PRIVATE_KEY: process.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY,
		},
	)
	const versioning = await exec(
		'coscli',
		[
			'bucket-versioning',
			'--method',
			'get',
			`cos://${publication.bucket}`,
			'--disable-log',
			'--config-path',
			publication.configPath,
		],
		{ cwd: repoRoot },
	)
	if (!versioning.includes('bucket versioning status is Closed')) {
		throw new Error('COS bucket versioning must be Closed')
	}
	await script(
		'publish-immutable-candidate.mjs',
		[
			'--release-dir',
			releaseDir,
			'--prefix',
			prefix,
			'--origin-url',
			publication.originUrl,
			'--bucket',
			publication.bucket,
			'--config',
			publication.configPath,
		],
		repoRoot,
		exec,
		releaseEnv,
	)
	await script(
		'verify-published-candidate.mjs',
		[
			'--manifest-url',
			`${candidateBaseUrl}/candidate-manifest.json`,
			'--expected-version',
			input.version,
			'--expected-channel',
			input.channel,
			'--expected-commit',
			input.commit,
			'--registration-output',
			path.join(releaseDir, 'candidate-registration.json'),
		],
		repoRoot,
		exec,
		releaseEnv,
	)
	const registration = await readFile(path.join(releaseDir, 'candidate-registration.json'))
	const candidate = await registerCandidate(
		publication.registerUrl,
		publication.token,
		registration,
		fetchImpl,
		`electron:${input.channel}:${input.version}`,
		`${candidateBaseUrl}/candidate-manifest.json`,
		dependencies.delay,
	)
	return {
		candidateId: candidate.releaseId,
		status: candidate.status,
		manifestUrl: `${candidateBaseUrl}/candidate-manifest.json`,
	}
}

async function verifyCheckout(input, repoRoot, exec) {
	const [status, head, origin, desktopPackage] = await Promise.all([
		exec('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot }),
		exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
		exec('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot }),
		readFile(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8'),
	])
	if (status.trim()) throw new Error('Checkout must be clean, including untracked files')
	if (head.trim() !== input.commit) throw new Error('Checkout HEAD differs from requested commit')
	const escaped = input.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	if (
		!new RegExp(
			`^(?:https://github\\.com/${escaped}(?:\\.git)?|git@github\\.com:${escaped}(?:\\.git)?|ssh://git@github\\.com/${escaped}(?:\\.git)?)$`,
			'i',
		).test(origin.trim())
	) {
		throw new Error('Git origin must match the requested GitHub repository without credentials')
	}
	if (JSON.parse(desktopPackage).version !== input.version)
		throw new Error('Desktop package version differs from requested version')
}

function validateArtifacts(response) {
	if (
		!response ||
		!Array.isArray(response.artifacts) ||
		!Number.isSafeInteger(response.total_count) ||
		response.total_count !== response.artifacts.length ||
		response.total_count > 100
	) {
		throw new Error('Source run artifact listing is incomplete')
	}
	const found = []
	for (const name of ARTIFACT_PATHS.keys()) {
		const matches = response.artifacts.filter((artifact) => artifact.name === name)
		if (
			matches.length !== 1 ||
			matches[0].expired !== false ||
			!Number.isSafeInteger(matches[0].id) ||
			matches[0].id <= 0
		) {
			throw new Error(`Source run requires one unexpired ${name} artifact`)
		}
		found.push(matches[0])
	}
	return found
}

async function verifySeal(input, runUrl, releaseDir, repoRoot, exec) {
	const sealPath = path.join(releaseDir, 'release-build.json')
	await script(
		'release-build-seal.mjs',
		[
			'verify',
			'--release-dir',
			releaseDir,
			'--seal',
			sealPath,
			'--expected-repository',
			input.repository,
			'--expected-commit',
			input.commit,
			'--expected-version',
			input.version,
			'--expected-channel',
			input.channel,
			'--expected-run-url',
			runUrl,
		],
		repoRoot,
		exec,
		{
			PATH: process.env.PATH,
			WENXUE_RELEASE_ED25519_PUBLIC_KEY: process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY,
		},
	)
	return JSON.parse(await readFile(sealPath, 'utf8'))
}

async function validatePublication(input, repoRoot, exec) {
	let configPath
	try {
		configPath = await realpath(input.cosConfig)
	} catch {
		throw new Error('COS config must be an existing file outside the repository')
	}
	if (configPath.startsWith(`${repoRoot}${path.sep}`))
		throw new Error('COS config must live outside the repository')
	if (!(await stat(configPath)).isFile()) throw new Error('COS config must be a file')
	const bucket = requireValue(process.env.WENXUE_UPDATE_COS_BUCKET, 'WENXUE_UPDATE_COS_BUCKET')
	const region = requireValue(process.env.WENXUE_UPDATE_COS_REGION, 'WENXUE_UPDATE_COS_REGION')
	if (!/^[a-z0-9][a-z0-9-]{1,61}-[0-9]{5,}$/.test(bucket) || !/^[a-z0-9-]+$/.test(region)) {
		throw new Error('COS bucket or region is invalid')
	}
	const originUrl = `https://${bucket}.cos.${region}.myqcloud.com/`
	if (
		requireHttpsUrl(process.env.WENXUE_UPDATE_COS_BASE_URL, 'WENXUE_UPDATE_COS_BASE_URL') !==
		originUrl
	) {
		throw new Error('COS public base URL does not match bucket and region')
	}
	const registerUrl = requireHttpsUrl(
		process.env.WENXUE_RELEASE_REGISTER_URL,
		'WENXUE_RELEASE_REGISTER_URL',
		true,
	)
	const token = requireValue(process.env.WENXUE_RELEASE_CI_TOKEN, 'WENXUE_RELEASE_CI_TOKEN')
	requireValue(process.env.WENXUE_RELEASE_ED25519_PRIVATE_KEY, 'WENXUE_RELEASE_ED25519_PRIVATE_KEY')
	const version = (await exec('coscli', ['--version'], { cwd: repoRoot })).trim()
	if (version !== 'coscli version v1.0.8') throw new Error('Trusted COSCLI v1.0.8 is required')
	return { configPath, bucket, originUrl, registerUrl, token }
}

async function registerCandidate(
	url,
	token,
	body,
	fetchImpl,
	expectedReleaseId,
	expectedManifestUrl,
	delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 30_000)
			let candidate
			try {
				const response = await fetchImpl(url, {
					method: 'POST',
					redirect: 'error',
					signal: controller.signal,
					headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
					body,
				})
				if (!response.ok) throw new Error('Candidate registration failed')
				const value = await response.json()
				candidate = value.candidate ?? value
			} finally {
				clearTimeout(timeout)
			}
			if (
				candidate.releaseId !== expectedReleaseId ||
				candidate.manifestUrl !== expectedManifestUrl ||
				candidate.status !== 'verified'
			) {
				throw new Error('Candidate registration response did not confirm candidate status')
			}
			return candidate
		} catch {
			if (attempt === 3) throw new Error('Candidate registration could not be confirmed')
			await delay(500 * 2 ** (attempt - 1))
		}
	}
}

async function script(name, args, cwd, exec, env) {
	await exec(process.execPath, [path.join(SCRIPT_DIR, name), ...args], { cwd, env })
}

async function safeExec(file, args, options) {
	try {
		const env = { ...process.env }
		delete env.WENXUE_RELEASE_CI_TOKEN
		delete env.WENXUE_RELEASE_ED25519_PRIVATE_KEY
		Object.assign(env, options.env ?? {})
		const { stdout } = await execFileAsync(file, args, {
			...options,
			env,
			maxBuffer: 4 * 1024 * 1024,
			timeout: 20 * 60 * 1000,
		})
		return stdout
	} catch {
		throw new Error(`Local release command failed: ${path.basename(file)}`)
	}
}

function validateOptions(command, options) {
	if (command !== 'prepare' && command !== 'publish') throw new Error('Expected prepare or publish')
	const repository = requireValue(options.repository, '--repository')
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository))
		throw new Error('Invalid --repository')
	const runId = requireValue(options.runId, '--run-id')
	if (!/^[1-9][0-9]{0,15}$/.test(runId) || !Number.isSafeInteger(Number(runId)))
		throw new Error('Invalid --run-id')
	const commit = requireValue(options.commit, '--commit').toLowerCase()
	if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid --commit')
	const version = requireValue(options.version, '--version')
	if (!isValidSemver(version)) throw new Error('Invalid --version')
	const channel = requireValue(options.channel, '--channel')
	if (!['dev', 'beta', 'stable'].includes(channel)) throw new Error('Invalid --channel')
	const releaseDir = requireValue(options.releaseDir, '--release-dir')
	if (command === 'publish') {
		if (
			!/^[A-Za-z0-9+/]{86}==$/.test(
				requireValue(options.artifactSetSha512, '--artifact-set-sha512'),
			)
		)
			throw new Error('Invalid --artifact-set-sha512')
		requireValue(options.cosConfig, '--cos-config')
	}
	return {
		repository,
		runId,
		commit,
		version,
		channel,
		releaseDir,
		artifactSetSha512: options.artifactSetSha512,
		cosConfig: options.cosConfig,
	}
}

function requireHttpsUrl(value, name, allowPath = false) {
	let url
	try {
		url = new URL(requireValue(value, name))
	} catch {
		throw new Error(`${name} must be a safe HTTPS URL`)
	}
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(!allowPath && url.pathname !== '/')
	) {
		throw new Error(`${name} must be a safe HTTPS URL`)
	}
	return url.toString()
}

function requireValue(value, name) {
	if (typeof value !== 'string' || !value.trim() || value !== value.trim())
		throw new Error(`${name} is required`)
	return value
}

function readCli(argv) {
	const [command, ...args] = argv
	const options = {}
	const names = new Set([
		'repository',
		'run-id',
		'commit',
		'version',
		'channel',
		'release-dir',
		'artifact-set-sha512',
		'cos-config',
	])
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index]?.slice(2)
		if (!args[index]?.startsWith('--') || !names.has(key) || options[key] || !args[index + 1])
			throw new Error('Invalid release option')
		options[key] = args[index + 1]
	}
	if (command === 'prepare' && (options['artifact-set-sha512'] || options['cos-config']))
		throw new Error('Prepare does not accept publish options')
	return [
		command,
		{
			repository: options.repository,
			runId: options['run-id'],
			commit: options.commit,
			version: options.version,
			channel: options.channel,
			releaseDir: options['release-dir'],
			artifactSetSha512: options['artifact-set-sha512'],
			cosConfig: options['cos-config'],
		},
	]
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	Promise.resolve()
		.then(() => readCli(process.argv.slice(2)))
		.then(([command, options]) => runLocalCandidate(command, options))
		.then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
		.catch((error) => {
			console.error(error instanceof Error ? error.message : 'Local release failed')
			process.exitCode = 1
		})
}
