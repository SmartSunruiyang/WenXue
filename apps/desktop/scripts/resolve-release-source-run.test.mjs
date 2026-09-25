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

test('rejects source runs outside the reviewed repository, commit, and main branch', () => {
	for (const changes of [
		{ id: 123456790 },
		{ repository: { full_name: 'other/WenXue' } },
		{ head_repository: { full_name: 'other/WenXue' } },
		{ head_branch: 'release' },
		{ head_sha: 'f'.repeat(40) },
		{ head_sha: 'not-a-commit' },
	]) {
		assert.throws(
			() => validateTrustedSourceRun({ ...sourceRun(), ...changes }, expected()),
			/reviewed commit|40 character commit/,
		)
	}
	assert.throws(
		() => validateTrustedSourceRun(sourceRun(), { ...expected(), expectedCommit: 'f'.repeat(40) }),
		/reviewed commit/,
	)
})

test('rejects noncanonical source run URLs', () => {
	for (const htmlUrl of [
		`https://github.com/other/WenXue/actions/runs/${runId}`,
		`${sourceRunUrl()}/`,
		`${sourceRunUrl()}?check_suite_focus=true`,
		`http://github.com/${repository}/actions/runs/${runId}`,
	]) {
		assert.throws(
			() => validateTrustedSourceRun({ ...sourceRun(), html_url: htmlUrl }, expected()),
			/reviewed commit/,
		)
	}
})

test('rejects non-manual, failed, incomplete, and repeated source runs', () => {
	for (const changes of [
		{ event: 'push' },
		{ status: 'in_progress' },
		{ conclusion: 'failure' },
		{ run_attempt: 2 },
	]) {
		assert.throws(
			() => validateTrustedSourceRun({ ...sourceRun(), ...changes }, expected()),
			/reviewed commit/,
		)
	}
})

function expected() {
	return { runId, repository, expectedCommit }
}

function sourceRun(workflowPath = '.github/workflows/desktop-release-candidate.yml') {
	return {
		id: Number(runId),
		html_url: sourceRunUrl(),
		path: workflowPath,
		head_branch: 'main',
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
