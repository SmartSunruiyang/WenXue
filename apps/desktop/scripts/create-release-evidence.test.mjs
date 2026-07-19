import assert from 'node:assert/strict'
import test from 'node:test'

import { createEvidence } from './create-release-evidence.mjs'

test('creates build-bound evidence without platform signing attestations', () => {
	const runUrl = 'https://github.com/SmartSunruiyang/WenXue/actions/runs/123'
	const artifactSetSha512 = Buffer.alloc(64, 7).toString('base64')
	assert.deepEqual(createEvidence(runUrl, artifactSetSha512), [
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
	])
	assert.throws(() => createEvidence('http://example.com/run', artifactSetSha512), /safe HTTPS/i)
})
