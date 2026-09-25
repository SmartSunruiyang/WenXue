import assert from 'node:assert/strict'
import test from 'node:test'

import { assertReleaseTargetMatrix } from './release-artifact-set.mjs'

const targets = [
	{ platform: 'darwin', arch: 'arm64', kind: 'dmg' },
	{ platform: 'win32', arch: 'x64', kind: 'nsis' },
]

test('requires exactly one installer of each supported target and type', () => {
	assert.doesNotThrow(() => assertReleaseTargetMatrix(targets))
	for (const artifacts of [
		[targets[0]],
		[targets[1]],
		[...targets, { platform: 'darwin', arch: 'x64', kind: 'dmg' }],
		[targets[0], targets[0]],
		[{ ...targets[0], kind: 'nsis' }, targets[1]],
		[targets[0], { ...targets[1], arch: 'arm64' }],
	]) {
		assert.throws(() => assertReleaseTargetMatrix(artifacts), /target installers|release target/i)
	}
})
