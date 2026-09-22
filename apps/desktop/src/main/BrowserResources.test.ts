import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBrowserResources, resolveBrowserPlatform } from './BrowserResources'

const repoRoot = '/repo/wenxue'

describe('BrowserResources', () => {
	it('reads the locked browser version', () => {
		const resources = createBrowserResources({
			repoRoot,
			platform: 'darwin',
			arch: 'arm64',
		})

		expect(resources.browserVersion()).toBe('149.0.7827.55')
	})

	it('resolves the dev browser binary from the Puppeteer cache', () => {
		const resources = createBrowserResources({
			repoRoot,
			platform: 'darwin',
			arch: 'arm64',
		})

		expect(resources.browserBinary()).toBe(
			path.join(
				repoRoot,
				'.browsers',
				'chrome',
				'mac_arm-149.0.7827.55',
				'chrome-mac-arm64',
				'Google Chrome for Testing.app',
				'Contents',
				'MacOS',
				'Google Chrome for Testing',
			),
		)
	})

	it('resolves the packaged browser binary at the Puppeteer cache layout inside resources/browser', () => {
		const resources = createBrowserResources({
			repoRoot,
			isPackaged: true,
			resourcesPath: '/Applications/WenXue.app/Contents/Resources',
			platform: 'darwin',
			arch: 'arm64',
		})

		expect(resources.browserBinary()).toBe(
			path.join(
				'/Applications/WenXue.app/Contents/Resources',
				'browser',
				'chrome',
				'mac_arm-149.0.7827.55',
				'chrome-mac-arm64',
				'Google Chrome for Testing.app',
				'Contents',
				'MacOS',
				'Google Chrome for Testing',
			),
		)
	})

	it('resolves the packaged Windows browser binary at the Puppeteer cache layout', () => {
		const resources = createBrowserResources({
			repoRoot,
			isPackaged: true,
			resourcesPath: 'C:\\Program Files\\WenXue\\resources',
			platform: 'win32',
			arch: 'x64',
		})

		expect(resources.browserBinary()).toBe(
			path.join(
				'C:\\Program Files\\WenXue\\resources',
				'browser',
				'chrome',
				'win64-149.0.7827.55',
				'chrome-win64',
				'chrome.exe',
			),
		)
	})

	it('resolves extension directories for dev and packaged modes', () => {
		const dev = createBrowserResources({
			repoRoot,
			platform: 'darwin',
			arch: 'arm64',
		})
		const packaged = createBrowserResources({
			repoRoot,
			isPackaged: true,
			resourcesPath: '/resources',
			platform: 'win32',
			arch: 'x64',
		})

		expect(dev.extensionDir()).toBe(
			path.join(repoRoot, 'apps', 'extension', '.output', 'chrome-mv3'),
		)
		expect(packaged.extensionDir()).toBe(path.join('/resources', 'extension'))
	})

	it('rejects unsupported platforms', () => {
		expect(() => resolveBrowserPlatform('linux', 'x64')).toThrow(
			'Unsupported browser platform: linux/x64',
		)
	})

	it('requires resourcesPath in packaged mode', () => {
		const resources = createBrowserResources({
			repoRoot,
			isPackaged: true,
			platform: 'darwin',
			arch: 'arm64',
		})

		expect(() => resources.browserBinary()).toThrow('resourcesPath is required in packaged mode')
	})
})
