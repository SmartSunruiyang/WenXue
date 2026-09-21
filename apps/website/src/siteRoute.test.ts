import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSiteRoute } from './siteRoute'

test('documentation and policy deep links retain the selected article and anchor', () => {
	assert.deepEqual(parseSiteRoute('#docs/customer-start'), {
		page: 'docs',
		section: 'customer-start',
		anchor: undefined,
	})
	assert.deepEqual(parseSiteRoute('#privacy/terms-of-use/responsibility'), {
		page: 'privacy',
		section: 'terms-of-use',
		anchor: 'responsibility',
	})
})

test('short and malformed external hashes fall back without throwing', () => {
	assert.deepEqual(parseSiteRoute('#privacy'), {
		page: 'privacy',
		section: 'privacy-policy',
		anchor: undefined,
	})
	assert.deepEqual(parseSiteRoute('#docs'), {
		page: 'docs',
		section: 'overview',
		anchor: undefined,
	})
	assert.deepEqual(parseSiteRoute('#%E0%A4%A'), { page: 'home' })
	assert.deepEqual(parseSiteRoute('#privacy/unknown'), {
		page: 'privacy',
		section: 'privacy-policy',
		anchor: undefined,
	})
})
