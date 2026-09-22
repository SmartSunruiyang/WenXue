import { createRequire } from 'node:module'
import path from 'node:path'
import { Browser, BrowserPlatform, computeExecutablePath } from '@puppeteer/browsers'

interface BrowserLock {
	version: string
}

const require = createRequire(import.meta.url)
const lock = require('../../browser.lock.json') as BrowserLock

export interface BrowserResourcesOptions {
	repoRoot: string
	isPackaged?: boolean
	resourcesPath?: string
	platform?: NodeJS.Platform
	arch?: NodeJS.Architecture
}

export interface BrowserResources {
	browserBinary(): string
	extensionDir(): string
	browserVersion(): string
}

export function resolveBrowserPlatform(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): BrowserPlatform {
	if (platform === 'darwin' && arch === 'arm64') return BrowserPlatform.MAC_ARM
	if (platform === 'darwin' && arch === 'x64') return BrowserPlatform.MAC
	if (platform === 'win32' && arch === 'x64') return BrowserPlatform.WIN64

	throw new Error(`Unsupported browser platform: ${platform}/${arch}`)
}

export function createBrowserResources(options: BrowserResourcesOptions): BrowserResources {
	const platform = resolveBrowserPlatform(options.platform, options.arch)

	const executable = computeExecutablePath({
		cacheDir: path.join(options.repoRoot, '.browsers'),
		browser: Browser.CHROME,
		buildId: lock.version,
		platform,
	})
	const cacheRelative = path.relative(path.join(options.repoRoot, '.browsers'), executable)

	return {
		browserBinary(): string {
			if (options.isPackaged) {
				if (!options.resourcesPath) {
					throw new Error('resourcesPath is required in packaged mode')
				}

				return path.join(options.resourcesPath, 'browser', cacheRelative)
			}

			return executable
		},
		extensionDir(): string {
			if (options.isPackaged) {
				if (!options.resourcesPath) {
					throw new Error('resourcesPath is required in packaged mode')
				}

				return path.join(options.resourcesPath, 'extension')
			}

			return path.join(options.repoRoot, 'apps', 'extension', '.output', 'chrome-mv3')
		},
		browserVersion(): string {
			return lock.version
		},
	}
}
