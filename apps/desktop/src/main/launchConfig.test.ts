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

	it('appends startUrl as the final positional argument', () => {
		const argv = buildArgv({
			userDataDir: '/profile',
			extensionDir: '/extension',
			startUrl: 'https://example.com',
		})

		expect(argv.at(-1)).toBe('https://example.com')
	})
})
