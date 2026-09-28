import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
	if (options.verifyMacSignature) {
		await verifyMacDmg(path.join(releaseDir, installers[0]), options.expectedVersion)
	}
	process.stdout.write(
		`Verified packaged desktop version ${options.expectedVersion} in ${installers[0]}.\n`,
	)
}

export async function verifyMacDmg(dmgPath, expectedVersion, run = execFileAsync) {
	if (process.platform !== 'darwin') throw new Error('macOS signature verification requires macOS')
	await run('/usr/bin/hdiutil', ['verify', dmgPath])
	const mountPoint = await mkdtemp(path.join(tmpdir(), 'wenxue-dmg-verify-'))
	let mounted = false
	try {
		await run('/usr/bin/hdiutil', [
			'attach',
			'-readonly',
			'-nobrowse',
			'-noautoopen',
			'-mountpoint',
			mountPoint,
			dmgPath,
		])
		mounted = true
		const apps = (await readdir(mountPoint, { withFileTypes: true })).filter(
			(entry) => entry.isDirectory() && entry.name.endsWith('.app'),
		)
		if (apps.length !== 1) throw new Error('Final DMG must contain exactly one app bundle')
		const appPath = path.join(mountPoint, apps[0].name)
		const plistPath = path.join(appPath, 'Contents', 'Info.plist')
		for (const [key, expected] of [
			['CFBundleShortVersionString', expectedVersion],
			['CFBundleIdentifier', 'com.wenxue.launcher'],
		]) {
			const { stdout } = await run('/usr/bin/plutil', [
				'-extract',
				key,
				'raw',
				'-o',
				'-',
				plistPath,
			])
			if (stdout.trim() !== expected) throw new Error(`Final DMG ${key} does not match ${expected}`)
		}
		await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
	} finally {
		if (mounted) await run('/usr/bin/hdiutil', ['detach', mountPoint])
		await rm(mountPoint, { recursive: true, force: true })
	}
}

function readOptions(argv) {
	const values = new Map()
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index]
		if (key === '--verify-mac-signature') {
			if (values.has('verify-mac-signature')) throw new Error('Duplicate --verify-mac-signature')
			values.set('verify-mac-signature', 'true')
			index -= 1
			continue
		}
		const value = argv[index + 1]
		if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? ''}`)
		if (
			!['--release-dir', '--expected-version', '--platform'].includes(key) ||
			values.has(key.slice(2))
		) {
			throw new Error(`Unexpected or duplicate argument ${key}`)
		}
		values.set(key.slice(2), value)
	}
	const platform = requireValue(values.get('platform'), '--platform')
	if (!['darwin', 'win32'].includes(platform)) throw new Error('--platform is invalid')
	const verifyMacSignature = values.has('verify-mac-signature')
	if (verifyMacSignature && platform !== 'darwin')
		throw new Error('--verify-mac-signature requires darwin')
	return {
		releaseDir: requireValue(values.get('release-dir'), '--release-dir'),
		expectedVersion: requireSemver(values.get('expected-version')),
		platform,
		verifyMacSignature,
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
