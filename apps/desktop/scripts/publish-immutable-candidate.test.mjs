import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { publishImmutableCandidate } from './publish-immutable-candidate.mjs'

test('publishes marker last and safely repairs every partial publication state', async () => {
	const releaseDir = await createReleaseDirectory()
	try {
		const remote = new Map()
		const uploaded = []
		const dependencies = createDependencies(remote, uploaded)
		const options = {
			releaseDir,
			prefix: 'electron/beta/0.1.1',
			originUrl: 'https://bucket.cos.ap-shanghai.myqcloud.com/',
		}

		const entries = await publishImmutableCandidate(options, dependencies)
		assert.equal(uploaded.at(-1), 'electron/beta/0.1.1/candidate-manifest.json')
		assert.equal(remote.size, entries.length)

		uploaded.length = 0
		await publishImmutableCandidate(options, dependencies)
		assert.deepEqual(uploaded, [])

		remote.delete('electron/beta/0.1.1/darwin/arm64/WenXue.dmg')
		remote.delete('electron/beta/0.1.1/candidate-manifest.sig')
		uploaded.length = 0
		await publishImmutableCandidate(options, dependencies)
		assert.deepEqual(uploaded, [
			'electron/beta/0.1.1/darwin/arm64/WenXue.dmg',
			'electron/beta/0.1.1/candidate-manifest.sig',
		])
		assert.equal(remote.has('electron/beta/0.1.1/candidate-manifest.json'), true)
	} finally {
		await rm(releaseDir, { recursive: true, force: true })
	}
})

test('does not upload anything when an existing immutable object differs', async () => {
	const releaseDir = await createReleaseDirectory()
	try {
		const remote = new Map()
		const uploaded = []
		const dependencies = createDependencies(remote, uploaded)
		const options = {
			releaseDir,
			prefix: 'electron/beta/0.1.1',
			originUrl: 'https://bucket.cos.ap-shanghai.myqcloud.com/',
		}
		await publishImmutableCandidate(options, dependencies)
		remote.set('electron/beta/0.1.1/candidate-manifest.json', Buffer.from('different'))
		uploaded.length = 0
		await assert.rejects(publishImmutableCandidate(options, dependencies), /existing COS object/i)
		assert.deepEqual(uploaded, [])
	} finally {
		await rm(releaseDir, { recursive: true, force: true })
	}
})

function createDependencies(remote, uploaded) {
	return {
		requestAttempts: 1,
		fetchImpl: async (url) => {
			const parsed = new URL(url)
			const key = parsed.pathname
				.slice(1)
				.split('/')
				.map((segment) => decodeURIComponent(segment))
				.join('/')
			const bytes = remote.get(key)
			if (!bytes) return new Response('', { status: 404 })
			return new Response(bytes, { status: 200 })
		},
		upload: async (entry) => {
			uploaded.push(entry.key)
			remote.set(entry.key, await readFile(entry.file))
		},
	}
}

async function createReleaseDirectory() {
	const root = await mkdtemp(path.join(tmpdir(), 'wenxue-publish-candidate-'))
	await Promise.all([
		writeArtifact(root, 'darwin/arm64/WenXue.dmg', 'mac-arm64-dmg'),
		writeArtifact(root, 'darwin/x64/WenXue.dmg', 'mac-x64-dmg'),
		writeArtifact(root, 'win32/x64/WenXue.exe', 'win-installer'),
		writeArtifact(root, 'candidate-manifest.sig', 'signature'),
		writeArtifact(root, 'candidate-manifest.json', 'manifest'),
	])
	return root
}

async function writeArtifact(root, relativePath, contents) {
	const file = path.join(root, relativePath)
	await mkdir(path.dirname(file), { recursive: true })
	await writeFile(file, contents)
}
