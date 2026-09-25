import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_RUN_RESPONSE_BYTES = 1024 * 1024
const BUILD_WORKFLOW_PATH = '.github/workflows/desktop-release-candidate.yml'

async function main() {
	const options = readOptions(process.argv.slice(2))
	const runId = requireRunId(options.get('run-id'))
	const repository = requireRepository(process.env.GITHUB_REPOSITORY)
	const expectedCommit = requireCommit(process.env.GITHUB_SHA, 'GITHUB_SHA')
	const apiBase = requireHttpsUrl(process.env.GITHUB_API_URL, 'GITHUB_API_URL').replace(/\/+$/, '')
	const token = requireValue(process.env.GITHUB_TOKEN, 'GITHUB_TOKEN')
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
	let run
	try {
		const response = await fetch(`${apiBase}/repos/${repository}/actions/runs/${runId}`, {
			signal: controller.signal,
			redirect: 'error',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
		})
		if (!response.ok) throw new Error(`Unable to read source workflow run (${response.status})`)
		const contentLength = Number(response.headers.get('content-length'))
		if (Number.isFinite(contentLength) && contentLength > MAX_RUN_RESPONSE_BYTES) {
			throw new Error('Source workflow response is too large')
		}
		const bytes = Buffer.from(await response.arrayBuffer())
		if (bytes.byteLength > MAX_RUN_RESPONSE_BYTES) {
			throw new Error('Source workflow response is too large')
		}
		run = JSON.parse(bytes.toString('utf8'))
	} finally {
		clearTimeout(timeout)
	}
	const runUrl = validateTrustedSourceRun(run, {
		runId,
		repository,
		expectedCommit,
	})
	const githubEnv = path.resolve(requireValue(options.get('github-env'), '--github-env'))
	await appendFile(
		githubEnv,
		[
			`WENXUE_SOURCE_RUN_ID=${runId}`,
			`WENXUE_SOURCE_RUN_URL=${runUrl}`,
			`WENXUE_SOURCE_COMMIT=${expectedCommit}`,
			'',
		].join('\n'),
		'utf8',
	)
	process.stdout.write(`Resolved trusted desktop build run ${runId}.\n`)
}

export function validateTrustedSourceRun(run, { runId, repository, expectedCommit }) {
	const runUrl = `https://github.com/${repository}/actions/runs/${runId}`
	if (
		run.id !== Number(runId) ||
		run.html_url !== runUrl ||
		!isTrustedBuildWorkflowPath(run.path) ||
		run.head_branch !== 'main' ||
		run.event !== 'workflow_dispatch' ||
		run.status !== 'completed' ||
		run.conclusion !== 'success' ||
		run.run_attempt !== 1 ||
		run.repository?.full_name !== repository ||
		run.head_repository?.full_name !== repository ||
		requireCommit(run.head_sha, 'source run head_sha') !== expectedCommit
	) {
		throw new Error(
			'Source run must be a successful first-attempt desktop build from this reviewed commit',
		)
	}
	return runUrl
}

function isTrustedBuildWorkflowPath(value) {
	if (value === BUILD_WORKFLOW_PATH) return true
	if (typeof value !== 'string' || !value.startsWith(`${BUILD_WORKFLOW_PATH}@`)) return false
	const ref = value.slice(BUILD_WORKFLOW_PATH.length + 1)
	return ref.length > 0 && ref.length <= 1_024 && !/[\0-\x20\x7f]/.test(ref)
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

function requireRunId(value) {
	const result = requireValue(value, '--run-id')
	if (!/^[1-9][0-9]{0,19}$/.test(result) || !Number.isSafeInteger(Number(result))) {
		throw new Error('--run-id must be a positive GitHub Actions run id')
	}
	return result
}

function requireRepository(value) {
	const result = requireValue(value, 'GITHUB_REPOSITORY')
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(result)) {
		throw new Error('GITHUB_REPOSITORY is invalid')
	}
	return result
}

function requireCommit(value, name) {
	const result = requireValue(value, name).toLowerCase()
	if (!/^[a-f0-9]{40}$/.test(result)) throw new Error(`${name} must be a 40 character commit`)
	return result
}

function requireHttpsUrl(value, name) {
	const parsed = new URL(requireValue(value, name))
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
		throw new Error(`${name} must be a safe HTTPS URL`)
	}
	return parsed.toString()
}

function requireValue(value, name) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} is required`)
	return value.trim()
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
