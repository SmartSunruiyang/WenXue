import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTrustedSourceRun } from './resolve-release-source-run.mjs'

const runId = '123456789'
const repository = 'SmartSunruiyang/WenXue'
const expectedCommit = '0123456789abcdef0123456789abcdef01234567'

test('accepts GitHub workflow paths with or without the API @ref suffix', () => {
	for (const workflowPath of [
		'.github/workflows/desktop-release-candidate.yml',
		'.github/workflows/desktop-release-candidate.yml@main',
		'.github/workflows/desktop-release-candidate.yml@refs/heads/release',
		`.github/workflows/desktop-release-candidate.yml@${expectedCommit}`,
	]) {
		assert.equal(validateTrustedSourceRun(sourceRun(workflowPath), expected()), sourceRunUrl())
	}
})

test('rejects a different workflow and malformed @ref suffixes', () => {
	for (const workflowPath of [
		'.github/workflows/desktop-release-publish.yml@main',
		'.github/workflows/desktop-release-candidate.yml.evil@main',
		'.github/workflows/desktop-release-candidate.yml@',
		'.github/workflows/desktop-release-candidate.yml@refs/heads/release branch',
	]) {
		assert.throws(
			() => validateTrustedSourceRun(sourceRun(workflowPath), expected()),
			/successful first-attempt desktop build/i,
		)
	}
})

function expected() {
	return { runId, repository, expectedCommit }
}

function sourceRun(workflowPath) {
	return {
		id: Number(runId),
		html_url: sourceRunUrl(),
		path: workflowPath,
		event: 'workflow_dispatch',
		status: 'completed',
		conclusion: 'success',
		run_attempt: 1,
		repository: { full_name: repository },
		head_repository: { full_name: repository },
		head_sha: expectedCommit,
	}
}

function sourceRunUrl() {
	return `https://github.com/${repository}/actions/runs/${runId}`
}
