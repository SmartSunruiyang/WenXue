import { describe, expect, it } from 'vitest'
import { buildArgv } from './launchConfig'

describe('buildArgv', () => {
	it('builds the default Chrome for Testing argv', () => {
		expect(
			buildArgv({
				userDataDir: '/tmp/wenxue-profile',
				extensionDir: '/tmp/wenxue-extension',
			}),
		).toEqual([
			'--user-data-dir=/tmp/wenxue-profile',
			'--disable-extensions-except=/tmp/wenxue-extension',
			'--load-extension=/tmp/wenxue-extension',
			'--no-first-run',
			'--no-default-browser-check',
			'--hide-crash-restore-bubble',
			'--disable-infobars',
		])
	})

	it('adds remote debugging pipe only when requested', () => {
		expect(
			buildArgv({
				userDataDir: '/profile',
				extensionDir: '/extension',
				debugPipe: true,
			}),
		).toContain('--remote-debugging-pipe')
	})

	it('appends startUrls in foreground-to-background order', () => {
		const argv = buildArgv({
			userDataDir: '/profile',
			extensionDir: '/extension',
			startUrls: ['chrome://newtab', 'https://example.com/handoff'],
		})

		expect(argv.slice(-2)).toEqual(['chrome://newtab', 'https://example.com/handoff'])
	})
})
