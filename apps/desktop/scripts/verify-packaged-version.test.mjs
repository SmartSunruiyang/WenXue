import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { verifyMacDmg } from './verify-packaged-version.mjs'

const run = promisify(execFile)
const script = fileURLToPath(new URL('./verify-packaged-version.mjs', import.meta.url))
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

function args(releaseDir, platform = 'darwin') {
	return [
		script,
		'--release-dir',
		releaseDir,
		'--expected-version',
		version,
		'--platform',
		platform,
		'--verify-mac-signature',
	]
}

test('rejects the macOS signature flag for Windows before invoking OS tools', async () => {
	await assert.rejects(run(process.execPath, args('/not-used', 'win32')), /requires darwin/)
})

test('rejects ambiguous installer sets', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'wenxue-version-test-'))
	try {
		await assert.rejects(run(process.execPath, args(root)), /exactly one .dmg/)
		await writeFile(path.join(root, `WenXue-${version}-mac-arm64.dmg`), '')
		await writeFile(path.join(root, 'unexpected.dmg'), '')
		await assert.rejects(run(process.execPath, args(root)), /exactly one .dmg/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test(
	'verifies the signed final DMG and rejects tampering or wrong bundle identity while detaching',
	{ skip: process.platform !== 'darwin' },
	async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'wenxue-final-dmg-test-'))
		try {
			for (const variant of ['valid', 'tampered', 'wrong-id', 'wrong-version']) {
				const source = path.join(root, `source ${variant}`)
				const app = path.join(source, '问学 fixture.app')
				await mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true })
				await mkdir(path.join(app, 'Contents', 'Resources'))
				await copyFile('/usr/bin/true', path.join(app, 'Contents', 'MacOS', 'fixture'))
				const bundleVersion = variant === 'wrong-version' ? '0.0.0' : version
				const id = variant === 'wrong-id' ? 'com.example.wrong' : 'com.wenxue.launcher'
				await writeFile(
					path.join(app, 'Contents', 'Info.plist'),
					`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${bundleVersion}</string></dict></plist>`,
				)
				const resource = path.join(app, 'Contents', 'Resources', 'sample.txt')
				await writeFile(resource, 'sealed')
				await run('/usr/bin/codesign', ['--force', '--sign', '-', app])
				if (variant === 'tampered') await writeFile(resource, 'changed after signing')
				const release = path.join(root, `release ${variant}`)
				await mkdir(release)
				const dmg = path.join(release, `WenXue-${version}-mac-arm64.dmg`)
				await run('/usr/bin/hdiutil', [
					'create',
					'-srcfolder',
					source,
					'-format',
					'UDZO',
					'-volname',
					'问学 signature fixture',
					dmg,
				])
				if (variant === 'valid') {
					const { stdout } = await run(process.execPath, args(release))
					assert.match(stdout, /Verified packaged desktop version/)
				} else {
					await assert.rejects(
						run(process.execPath, args(release)),
						variant === 'wrong-id'
							? /CFBundleIdentifier/
							: variant === 'wrong-version'
								? /CFBundleShortVersionString/
								: /codesign/,
					)
				}
				const { stdout } = await run('/usr/bin/hdiutil', ['info', '-plist'])
				assert.equal(stdout.includes(dmg), false, 'verification must detach the image')
			}
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	},
)

test(
	'removes the temporary directory when attaching fails without attempting detach',
	{ skip: process.platform !== 'darwin' },
	async () => {
		let mountPoint
		const commands = []
		await assert.rejects(
			verifyMacDmg('/fixture.dmg', version, async (command, args) => {
				commands.push([command, args[0]])
				if (args[0] === 'attach') {
					mountPoint = args[args.indexOf('-mountpoint') + 1]
					assert.ok(args.includes('-noautoopen'))
					throw new Error('attach failed')
				}
				return { stdout: '' }
			}),
			/attach failed/,
		)
		assert.deepEqual(
			commands.map((entry) => entry[1]),
			['verify', 'attach'],
		)
		await assert.rejects(access(mountPoint), { code: 'ENOENT' })
	},
)

test(
	'retains the mount directory if safe detach fails',
	{ skip: process.platform !== 'darwin' },
	async () => {
		let mountPoint
		try {
			await assert.rejects(
				verifyMacDmg('/fixture.dmg', version, async (command, args) => {
					if (args[0] === 'attach') mountPoint = args[args.indexOf('-mountpoint') + 1]
					if (args[0] === 'detach') throw new Error('detach failed')
					return { stdout: '' }
				}),
				/detach failed/,
			)
			await access(mountPoint)
		} finally {
			if (mountPoint) await rm(mountPoint, { recursive: true, force: true })
		}
	},
)
