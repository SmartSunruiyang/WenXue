import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
	assertReleaseTargetMatrix,
	generateWindowsUpdateMetadata,
	readReleaseArtifactSet,
} from './release-artifact-set.mjs'

const targets = [
	{ platform: 'darwin', arch: 'arm64', kind: 'dmg' },
	{ platform: 'win32', arch: 'x64', kind: 'nsis' },
	{ platform: 'win32', arch: 'x64', kind: 'nsis-yaml' },
]

test('requires exactly one signed item of each supported target and type', () => {
	assert.doesNotThrow(() => assertReleaseTargetMatrix(targets))
	for (const artifacts of [
		[targets[0]],
		[targets[1]],
		[...targets, { platform: 'darwin', arch: 'x64', kind: 'dmg' }],
		[targets[0], targets[0]],
		[{ ...targets[0], kind: 'nsis' }, targets[1], targets[2]],
		[targets[0], { ...targets[1], arch: 'arm64' }, targets[2]],
	]) {
		assert.throws(() => assertReleaseTargetMatrix(artifacts), /target artifacts|release target/i)
	}
	assert.doesNotThrow(() => assertReleaseTargetMatrix(targets.slice(0, 2), 1))
})

test('generates channel metadata from exact NSIS bytes and rejects altered metadata', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'wenxue-update-metadata-'))
	const windows = path.join(root, 'win32/x64')
	const exeName = 'WenXue-0.1.1-win-x64.exe'
	try {
		await mkdir(path.join(root, 'darwin/arm64'), { recursive: true })
		await mkdir(windows, { recursive: true })
		await writeFile(path.join(root, 'darwin/arm64/WenXue.dmg'), 'mac')
		await writeFile(path.join(windows, exeName), 'windows bytes')
		const metadata = await generateWindowsUpdateMetadata(windows, '0.1.1', 'beta')
		assert.equal(metadata.files[0].size, Buffer.byteLength('windows bytes'))
		assert.equal(metadata.path, exeName)
		assert.equal(
			(await readReleaseArtifactSet(root, { version: '0.1.1', channel: 'beta' })).entries.length,
			3,
		)
		const metadataPath = path.join(windows, 'beta.yml')
		const original = await readFile(metadataPath)
		for (const mutation of [
			(value) => {
				value.version = '0.1.2'
			},
			(value) => {
				value.files[0].url = '../elsewhere.exe'
			},
			(value) => {
				value.files[0].sha512 = 'bad'
			},
			(value) => {
				value.files.push(value.files[0])
			},
			(value) => {
				value.path = 'other.exe'
			},
		]) {
			const value = JSON.parse(original)
			mutation(value)
			await writeFile(metadataPath, JSON.stringify(value))
			await assert.rejects(
				readReleaseArtifactSet(root, { version: '0.1.1', channel: 'beta' }),
				/Windows update metadata/i,
			)
		}
		await writeFile(metadataPath, original)
		await writeFile(path.join(windows, 'extra.yml'), '{}')
		await assert.rejects(
			readReleaseArtifactSet(root, { version: '0.1.1', channel: 'beta' }),
			/exactly 3 target artifacts/i,
		)
		await rm(path.join(windows, 'extra.yml'))
		await writeFile(metadataPath, Buffer.alloc(65_537, 0x20))
		await assert.rejects(
			readReleaseArtifactSet(root, { version: '0.1.1', channel: 'beta' }),
			/metadata exceeds the size limit/i,
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
