import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppPaths } from './AppPaths'
import { BrowserProfileStore } from './BrowserProfileStore'
import { ProfileStore } from './ProfileStore'

let userDataDir: string
let appPaths: AppPaths
let profileStore: ProfileStore

beforeEach(async () => {
	userDataDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-browser-profile-store-'))
	appPaths = new AppPaths(userDataDir)
	await appPaths.ensure()
	profileStore = new ProfileStore(appPaths)
})

afterEach(async () => {
	await rm(userDataDir, { force: true, recursive: true })
})

describe('BrowserProfileStore', () => {
	it('starts empty when there are no saved browser profiles', async () => {
		const store = new BrowserProfileStore(appPaths, profileStore)

		await expect(store.list()).resolves.toEqual([])
	})

	it('creates persistent profile metadata and its matching user data directory', async () => {
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 1000,
			idFactory: () => 'profile_a',
		})

		const profile = await store.create()

		expect(profile).toEqual({
			id: 'profile_a',
			displayName: '浏览器 1',
			type: 'persistent',
			colorKey: 'blue',
			createdAt: 1000,
			lastUsedAt: null,
			userDataDir: path.join(appPaths.profilesRoot(), 'profile_a'),
		})
		await expect(store.list()).resolves.toEqual([profile])
		expect(profileStore.listProfiles()).toEqual(['profile_a'])
	})

	it('renames profiles and falls back to the default display name for blank input', async () => {
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 1000,
			idFactory: () => 'profile_a',
		})
		await store.create()

		await expect(store.rename('profile_a', '研究主号')).resolves.toMatchObject({
			id: 'profile_a',
			displayName: '研究主号',
		})
		await expect(store.rename('profile_a', '  ')).resolves.toMatchObject({
			id: 'profile_a',
			displayName: '浏览器 1',
		})
	})

	it('touches last used time without creating unknown profiles', async () => {
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 2000,
			idFactory: () => 'profile_a',
		})
		await store.create()

		await expect(store.touch('profile_a')).resolves.toMatchObject({ lastUsedAt: 2000 })
		await expect(store.touch('missing')).rejects.toThrow('Unknown browser profile: missing')
	})

	it('duplicates and removes profile metadata with matching directories', async () => {
		const ids = ['source', 'copy']
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 3000,
			idFactory: () => ids.shift() ?? 'fallback',
		})
		const source = await store.create()
		await store.rename(source.id, '研究主号')
		await writeFile(path.join(source.userDataDir, 'Preferences'), 'copied-data')

		const copy = await store.duplicate(source.id)

		expect(copy).toEqual(
			expect.objectContaining({
				id: 'copy',
				displayName: '研究主号 副本',
				lastUsedAt: null,
				userDataDir: path.join(appPaths.profilesRoot(), 'copy'),
			}),
		)
		await expect(readFile(path.join(copy.userDataDir, 'Preferences'), 'utf8')).resolves.toBe(
			'copied-data',
		)

		await expect(store.remove(source.id)).resolves.toMatchObject({ id: 'source' })
		await expect(store.list()).resolves.toEqual([copy])
		expect(profileStore.listProfiles()).toEqual(['copy'])
	})
})
