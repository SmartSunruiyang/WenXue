import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

async function main() {
	const options = readOptions(process.argv.slice(2))
	const packageJson = JSON.parse(
		await readFile(new URL('../package.json', import.meta.url), 'utf8'),
	)
	if (packageJson.version !== options.expectedVersion) {
		throw new Error(
			`Desktop package version ${packageJson.version} does not match ${options.expectedVersion}`,
		)
	}
	const releaseDir = path.resolve(options.releaseDir)
	const extension = options.platform === 'darwin' ? '.dmg' : '.exe'
	const osToken = options.platform === 'darwin' ? 'mac' : 'win'
	const installers = (await readdir(releaseDir)).filter((fileName) =>
		fileName.toLowerCase().endsWith(extension),
	)
	if (installers.length !== 1) {
		throw new Error(`Expected exactly one ${extension} installer`)
	}
	const expectedPrefix = `WenXue-${options.expectedVersion}-${osToken}-`
	if (!installers[0].startsWith(expectedPrefix)) {
		throw new Error(`${installers[0]} does not contain version ${options.expectedVersion}`)
	}
	process.stdout.write(
		`Verified packaged desktop version ${options.expectedVersion} in ${installers[0]}.\n`,
	)
}

function readOptions(argv) {
	const values = new Map()
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index]
		const value = argv[index + 1]
		if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? ''}`)
		values.set(key.slice(2), value)
	}
	const platform = requireValue(values.get('platform'), '--platform')
	if (!['darwin', 'win32'].includes(platform)) throw new Error('--platform is invalid')
	return {
		releaseDir: requireValue(values.get('release-dir'), '--release-dir'),
		expectedVersion: requireSemver(values.get('expected-version')),
		platform,
	}
}

function requireSemver(value) {
	const result = requireValue(value, '--expected-version')
	if (
		!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
			result,
		)
	) {
		throw new Error('--expected-version must be semver')
	}
	return result
}

function requireValue(value, name) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} is required`)
	return value.trim()
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
