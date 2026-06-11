import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

	it('lists profile directories sorted by name', async () => {
		const store = new ProfileStore(appPaths)
		await store.ensureProfile('zeta')
		await store.ensureProfile('alpha')
		await writeFile(path.join(appPaths.profilesRoot(), 'notes.txt'), 'not a profile')

		expect(store.listProfiles()).toEqual(['alpha', 'zeta'])
	})

	it('rejects directory-unsafe profile IDs', async () => {
		const store = new ProfileStore(appPaths)

		await expect(store.ensureProfile('../escape')).rejects.toThrow('Invalid profile id: ../escape')
		expect(() => store.listProfiles()).not.toThrow()
	})
})
