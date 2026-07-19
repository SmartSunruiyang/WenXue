import assert from 'node:assert/strict'
import test from 'node:test'

import {
	canonicalJson,
	compareSemver,
	matchesAudience,
	rolloutBucket,
	validateAnnouncementInput,
	validateReleasePublishInput,
	versionInRange,
} from './index.mjs'

test('semantic versions use SemVer prerelease ordering and inclusive ranges', () => {
	assert.equal(compareSemver('1.2.3-beta.2', '1.2.3-beta.11'), -1)
	assert.equal(compareSemver('1.2.3', '1.2.3-rc.1'), 1)
	assert.equal(versionInRange('1.2.3', '1.2.3', '2.0.0'), true)
	assert.equal(versionInRange('2.0.1', '1.2.3', '2.0.0'), false)
})

test('announcement validation normalizes content and applies the seven-day default', () => {
	const now = Date.parse('2026-07-17T00:00:00.000Z')
	const result = validateAnnouncementInput(
		{
			importance: 'normal',
			title: '  服务维护  ',
			body: '  今晚进行维护。  ',
			detailUrl: 'https://wenxue.example/notice',
			audience: { platforms: ['darwin'], minVersion: '1.0.0' },
		},
		{ now },
	)
	assert.equal(result.ok, true)
	if (!result.ok) return
	assert.equal(result.value.title, '服务维护')
	assert.equal(result.value.expiresAt, '2026-07-24T00:00:00.000Z')
})

test('announcement validation rejects duplicate users, invalid HTTPS and excessive expiry', () => {
	const result = validateAnnouncementInput(
		{
			importance: 'important',
			title: '通知',
			body: '请确认',
			detailUrl: 'http://wenxue.example/notice',
			expiresAt: '2026-08-20T00:00:00.000Z',
			audience: { userIds: ['u-1', 'u-1'] },
		},
		{ now: Date.parse('2026-07-17T00:00:00.000Z') },
	)
	assert.equal(result.ok, false)
	if (result.ok) return
	assert.deepEqual(result.issues.map((issue) => issue.field).sort(), [
		'audience.userIds',
		'detailUrl',
		'expiresAt',
	])
})

test('audience dimensions combine with AND and empty dimensions remain unrestricted', () => {
	const context = { userId: 'u-7', platform: 'darwin', version: '1.4.0' }
	assert.equal(matchesAudience(context, {}), true)
	assert.equal(
		matchesAudience(context, {
			platforms: ['darwin'],
			minVersion: '1.2.0',
			maxVersion: '1.4.0',
			userIds: ['u-7', 'u-8'],
		}),
		true,
	)
	assert.equal(matchesAudience(context, { platforms: ['win32'] }), false)
})

test('canonical JSON sorts object keys recursively', () => {
	assert.equal(
		canonicalJson({ z: 1, nested: { b: true, a: ['x', null] }, a: 2 }),
		'{"a":2,"nested":{"a":["x",null],"b":true},"z":1}',
	)
})

test('rollout buckets are stable SHA-256-derived values in the 0-99 range', () => {
	const bucket = rolloutBucket('release-1', 'install-1')
	assert.equal(bucket, 53)
	assert.equal(rolloutBucket('release-1', 'install-1'), bucket)
	assert.ok(bucket >= 0 && bucket <= 99)
})

test('mandatory releases require full rollout', () => {
	const result = validateReleasePublishInput({
		candidateId: 'release-1',
		title: '关键更新',
		notes: '修复安全问题',
		percentage: 25,
		mode: 'mandatory',
	})
	assert.equal(result.ok, false)
	if (result.ok) return
	assert.equal(result.issues[0]?.field, 'percentage')
})
