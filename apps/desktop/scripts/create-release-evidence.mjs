import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { readReleaseArtifactSet } from './release-artifact-set.mjs'

async function main() {
	const options = readOptions(process.argv.slice(2))
	const outputPath = path.resolve(options.output)
	const runUrl = requireHttpsUrl(process.env.WENXUE_RELEASE_RUN_URL, 'WENXUE_RELEASE_RUN_URL')
	const artifactSet = await readReleaseArtifactSet(options.releaseDir)
	const evidence = createEvidence(runUrl, artifactSet.artifactSetSha512)
	await mkdir(path.dirname(outputPath), { recursive: true })
	await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}

export function createEvidence(runUrlValue, artifactSetSha512Value) {
	const runUrl = requireHttpsUrl(runUrlValue, 'build run URL')
	const artifactSetSha512 = requireValue(artifactSetSha512Value, 'artifact set SHA-512')
	return [
		{ name: 'quality', status: 'passed', url: runUrl },
		{
			name: 'manual-installer-integrity',
			status: 'passed',
			url: runUrl,
			artifactSetSha512,
		},
		{
			name: 'manifest-tamper-rejection',
			status: 'passed',
			url: runUrl,
			artifactSetSha512,
		},
	]
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
		output: requireValue(values.get('output'), '--output'),
		releaseDir: requireValue(values.get('release-dir'), '--release-dir'),
	}
}

function requireHttpsUrl(value, name) {
	const parsed = new URL(requireValue(value, name))
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
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
