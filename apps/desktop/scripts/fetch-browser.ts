import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	Browser,
	BrowserPlatform,
	computeExecutablePath,
	install,
} from '@puppeteer/browsers'
import lock from '../browser.lock.json'

type TargetPlatform = 'mac-arm64' | 'mac-x64' | 'win64'

const TARGETS: Record<TargetPlatform, BrowserPlatform> = {
	'mac-arm64': BrowserPlatform.MAC_ARM,
	'mac-x64': BrowserPlatform.MAC,
	win64: BrowserPlatform.WIN64,
}

function hostTarget(): TargetPlatform {
	if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64'
	if (process.platform === 'darwin' && process.arch === 'x64') return 'mac-x64'
	if (process.platform === 'win32' && process.arch === 'x64') return 'win64'

	throw new Error(`Unsupported host platform: ${process.platform}/${process.arch}`)
}

function requestedTargets(argv: string[]): TargetPlatform[] {
	const index = argv.indexOf('--platform')
	const value = index >= 0 ? argv[index + 1] : undefined

	if (!value) return [hostTarget()]
	if (value === 'all') return ['mac-arm64', 'mac-x64', 'win64']
	if (value in TARGETS) return [value as TargetPlatform]

	throw new Error(`Unsupported --platform "${value}". Use mac-arm64, mac-x64, win64, or all.`)
}

async function main(): Promise<void> {
	const dirname = path.dirname(fileURLToPath(import.meta.url))
	const repoRoot = path.resolve(dirname, '../../..')
	const cacheDir = path.join(repoRoot, '.browsers')
	const baseUrl = process.env.PUPPETEER_DOWNLOAD_BASE_URL || undefined

	for (const target of requestedTargets(process.argv.slice(2))) {
		const platform = TARGETS[target]
		const installed = await install({
			browser: Browser.CHROME,
			buildId: lock.version,
			platform,
			cacheDir,
			baseUrl,
			downloadProgressCallback: 'default',
		})
		const executablePath = computeExecutablePath({
			cacheDir,
			browser: Browser.CHROME,
			buildId: lock.version,
			platform,
		})

		console.log(`[fetch-browser] ${target} chrome@${lock.version}`)
		console.log(`[fetch-browser] installDir=${installed.path}`)
		console.log(`[fetch-browser] executable=${executablePath}`)
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error)
	console.error(`[fetch-browser] ${message}`)
	process.exitCode = 1
})
