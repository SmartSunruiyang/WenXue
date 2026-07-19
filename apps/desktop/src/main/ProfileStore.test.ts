import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppPaths } from './AppPaths'
import { ProfileStore } from './ProfileStore'

let userDataDir: string
let appPaths: AppPaths

beforeEach(async () => {
	userDataDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-profile-store-'))
	appPaths = new AppPaths(userDataDir)
	await appPaths.ensure()
})

afterEach(async () => {
	await rm(userDataDir, { force: true, recursive: true })
})

describe('ProfileStore', () => {
	it('creates the default profile directory', async () => {
		const store = new ProfileStore(appPaths)

		await expect(store.ensureProfile()).resolves.toBe(path.join(appPaths.profilesRoot(), 'default'))
		await expect(mkdir(path.join(appPaths.profilesRoot(), 'default'))).rejects.toMatchObject({
			code: 'EEXIST',
		})
	})

	it('creates a named profile directory', async () => {
		const store = new ProfileStore(appPaths)

		await expect(store.ensureProfile('research')).resolves.toBe(
			path.join(appPaths.profilesRoot(), 'research'),
		)
	})

	it('enables extension developer mode without overwriting existing Chrome preferences', async () => {
		const store = new ProfileStore(appPaths)
		const profileDir = await store.ensureProfile('research')
		const defaultDir = path.join(profileDir, 'Default')
		await mkdir(defaultDir)
		await writeFile(
			path.join(defaultDir, 'Preferences'),
			JSON.stringify({ homepage: 'https://example.com', extensions: { ui: { other: true } } }),
		)

		await expect(store.prepareForUnpackedExtension('research')).resolves.toBe(profileDir)
		const preferences = JSON.parse(
			await readFile(path.join(defaultDir, 'Preferences'), 'utf8'),
		) as Record<string, unknown>

		expect(preferences).toMatchObject({
			homepage: 'https://example.com',
			extensions: { ui: { developer_mode: true, other: true } },
		})
	})

	it('creates secure Preferences atomically for a new unpacked-extension profile', async () => {
		const store = new ProfileStore(appPaths)
		const profileDir = await store.prepareForUnpackedExtension('research')
		const defaultDir = path.join(profileDir, 'Default')
		const preferencesPath = path.join(defaultDir, 'Preferences')

		expect(JSON.parse(await readFile(preferencesPath, 'utf8'))).toMatchObject({
			extensions: { ui: { developer_mode: true } },
		})
		expect((await stat(preferencesPath)).mode & 0o777).toBe(0o600)
		expect((await readdir(defaultDir)).some((name) => name.includes('.wenxue-'))).toBe(false)
	})

	it('does not overwrite malformed Chrome Preferences', async () => {
		const store = new ProfileStore(appPaths)
		const profileDir = await store.ensureProfile('research')
		const defaultDir = path.join(profileDir, 'Default')
		const preferencesPath = path.join(defaultDir, 'Preferences')
		await mkdir(defaultDir)
		await writeFile(preferencesPath, '{malformed')

		await expect(store.prepareForUnpackedExtension('research')).rejects.toBeInstanceOf(SyntaxError)
		expect(await readFile(preferencesPath, 'utf8')).toBe('{malformed')
	})

	it('refuses to mutate a profile that has a live or unrecognized SingletonLock', async () => {
		const store = new ProfileStore(appPaths)
		const profileDir = await store.ensureProfile('research')
		await writeFile(path.join(profileDir, 'SingletonLock'), 'locked')

		await expect(store.prepareForUnpackedExtension('research')).rejects.toThrow(
			/Browser profile is already in use/i,
		)
		await expect(
			readFile(path.join(profileDir, 'Default', 'Preferences'), 'utf8'),
		).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('refuses to mutate a profile with Chromium Windows lockfile', async () => {
		const store = new ProfileStore(appPaths)
		const profileDir = await store.ensureProfile('research')
		await writeFile(path.join(profileDir, 'lockfile'), 'locked')

		await expect(store.prepareForUnpackedExtension('research')).rejects.toThrow(
			/Browser profile is already in use/i,
		)
	})

	it.skipIf(process.platform === 'win32')(
		'refuses to mutate a profile locked by an unverifiable foreign host',
		async () => {
			const store = new ProfileStore(appPaths)
			const profileDir = await store.ensureProfile('research')
			await symlink('other-host-999999', path.join(profileDir, 'SingletonLock'))

			await expect(store.prepareForUnpackedExtension('research')).rejects.toThrow(
				/Browser profile is already in use/i,
			)
		},
	)

	it('allows an already-prepared profile to be focused while its browser is still running', async () => {
		const store = new ProfileStore(appPaths)
		const profileDir = await store.ensureProfile('research')
		const defaultDir = path.join(profileDir, 'Default')
		await mkdir(defaultDir)
		await writeFile(path.join(profileDir, 'SingletonLock'), 'locked')
		await writeFile(
			path.join(defaultDir, 'Preferences'),
			JSON.stringify({ extensions: { ui: { developer_mode: true } } }),
		)

		await expect(store.prepareForUnpackedExtension('research')).resolves.toBe(profileDir)
	})

	it('lists profile directories sorted by name', async () => {
		const store = new ProfileStore(appPaths)
		await store.ensureProfile('zeta')
		await store.ensureProfile('alpha')
		await writeFile(path.join(appPaths.profilesRoot(), 'notes.txt'), 'not a profile')

		expect(store.listProfiles()).toEqual(['alpha', 'zeta'])
	})

	it('copies and deletes profile directories by id', async () => {
		const store = new ProfileStore(appPaths)
		const sourceDir = await store.ensureProfile('source')
		await writeFile(path.join(sourceDir, 'Preferences'), 'profile-data')

		const copiedDir = await store.copyProfile('source', 'copy')

		expect(copiedDir).toBe(path.join(appPaths.profilesRoot(), 'copy'))
		expect(store.listProfiles()).toEqual(['copy', 'source'])

		await store.deleteProfile('source')

		expect(store.listProfiles()).toEqual(['copy'])
	})

	it('rejects directory-unsafe profile IDs', async () => {
		const store = new ProfileStore(appPaths)

		await expect(store.ensureProfile('../escape')).rejects.toThrow('Invalid profile id: ../escape')
		expect(() => store.listProfiles()).not.toThrow()
	})
})
