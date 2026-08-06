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
const USER_A = 'user_a'
const USER_B = 'user_b'

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

		await expect(store.list(USER_A)).resolves.toEqual([])
	})

	it('creates persistent profile metadata and its matching user data directory', async () => {
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 1000,
			idFactory: () => 'profile_a',
		})

		const profile = await store.create(USER_A)

		expect(profile).toEqual({
			id: 'profile_a',
			displayName: '浏览器 1',
			type: 'persistent',
			colorKey: 'blue',
			createdAt: 1000,
			lastUsedAt: null,
			userDataDir: path.join(appPaths.profilesRoot(), 'profile_a'),
		})
		await expect(store.list(USER_A)).resolves.toEqual([profile])
		await expect(store.get(USER_A, profile.id)).resolves.toEqual(profile)
		await expect(store.list(USER_B)).resolves.toEqual([])
		const restartedStore = new BrowserProfileStore(appPaths, profileStore)
		await expect(restartedStore.list(USER_A)).resolves.toEqual([profile])
		await expect(restartedStore.list(USER_B)).resolves.toEqual([])
		await expect(readFile(appPaths.dataFile('browsers.json'), 'utf8')).resolves.toContain(
			`"accountNamespace": "${USER_A}"`,
		)
		expect(profile).not.toHaveProperty('accountNamespace')
		expect(profileStore.listProfiles()).toEqual(['profile_a'])
	})

	it('renames profiles and falls back to the default display name for blank input', async () => {
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 1000,
			idFactory: () => 'profile_a',
		})
		await store.create(USER_A)

		await expect(store.rename(USER_A, 'profile_a', '研究主号')).resolves.toMatchObject({
			id: 'profile_a',
			displayName: '研究主号',
		})
		await expect(store.rename(USER_A, 'profile_a', '  ')).resolves.toMatchObject({
			id: 'profile_a',
			displayName: '浏览器 1',
		})
	})

	it('touches last used time without creating unknown profiles', async () => {
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 2000,
			idFactory: () => 'profile_a',
		})
		await store.create(USER_A)

		await expect(store.touch(USER_A, 'profile_a')).resolves.toMatchObject({ lastUsedAt: 2000 })
		await expect(store.touch(USER_A, 'missing')).rejects.toThrow('Unknown browser profile: missing')
	})

	it('duplicates and removes profile metadata with matching directories', async () => {
		const ids = ['source', 'copy']
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 3000,
			idFactory: () => ids.shift() ?? 'fallback',
		})
		const source = await store.create(USER_A)
		await store.rename(USER_A, source.id, '研究主号')
		await writeFile(path.join(source.userDataDir, 'Preferences'), 'copied-data')

		const copy = await store.duplicate(USER_A, source.id)

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

		await expect(store.remove(USER_A, source.id)).resolves.toMatchObject({ id: 'source' })
		await expect(store.list(USER_A)).resolves.toEqual([copy])
		expect(profileStore.listProfiles()).toEqual(['copy'])
	})

	it('keeps account lists, numbering, and colors independent', async () => {
		const ids = ['a1', 'a2', 'b1']
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 4000,
			idFactory: () => ids.shift() ?? 'fallback',
		})

		const firstA = await store.create(USER_A)
		const secondA = await store.create(USER_A)
		const firstB = await store.create(USER_B)

		expect(await store.list(USER_A)).toEqual([firstA, secondA])
		expect(await store.list(USER_B)).toEqual([firstB])
		expect(secondA).toMatchObject({ displayName: '浏览器 2', colorKey: 'purple' })
		expect(firstB).toMatchObject({ displayName: '浏览器 1', colorKey: 'blue' })
	})

	it('serializes concurrent metadata writes without losing either account record', async () => {
		const ids = ['a1', 'b1']
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 4500,
			idFactory: () => ids.shift() ?? 'fallback',
		})

		const [profileA, profileB] = await Promise.all([store.create(USER_A), store.create(USER_B)])

		await expect(store.list(USER_A)).resolves.toEqual([profileA])
		await expect(store.list(USER_B)).resolves.toEqual([profileB])
		expect(profileStore.listProfiles()).toEqual(['a1', 'b1'])
	})

	it('rejects every known-id operation from another account without changing disk data', async () => {
		const ids = ['source', 'copy']
		const store = new BrowserProfileStore(appPaths, profileStore, {
			now: () => 5000,
			idFactory: () => ids.shift() ?? 'fallback',
		})
		const source = await store.create(USER_A)
		await writeFile(path.join(source.userDataDir, 'Preferences'), 'owner-data')

		await expect(store.get(USER_B, source.id)).rejects.toThrow(
			`Unknown browser profile: ${source.id}`,
		)
		await expect(store.rename(USER_B, source.id, '窃取')).rejects.toThrow(
			`Unknown browser profile: ${source.id}`,
		)
		await expect(store.touch(USER_B, source.id)).rejects.toThrow(
			`Unknown browser profile: ${source.id}`,
		)
		await expect(store.duplicate(USER_B, source.id)).rejects.toThrow(
			`Unknown browser profile: ${source.id}`,
		)
		await expect(store.remove(USER_B, source.id)).rejects.toThrow(
			`Unknown browser profile: ${source.id}`,
		)

		await expect(readFile(path.join(source.userDataDir, 'Preferences'), 'utf8')).resolves.toBe(
			'owner-data',
		)
		await expect(store.list(USER_A)).resolves.toEqual([source])
	})

	it('fails closed for legacy records without an account namespace and preserves them verbatim', async () => {
		const legacyProfile = {
			id: 'legacy',
			displayName: '旧档案',
			type: 'persistent',
			colorKey: 'blue',
			createdAt: 100,
			lastUsedAt: null,
			userDataDir: path.join(appPaths.profilesRoot(), 'legacy'),
		}
		await writeFile(
			appPaths.dataFile('browsers.json'),
			`${JSON.stringify({ schema: 'legacy', profiles: [legacyProfile] }, null, 2)}\n`,
		)
		await profileStore.ensureProfile(legacyProfile.id)
		const ids = ['legacy', 'fresh']
		const store = new BrowserProfileStore(appPaths, profileStore, {
			idFactory: () => ids.shift() ?? 'fallback',
		})

		await expect(store.list(USER_A)).resolves.toEqual([])
		await expect(store.get(USER_A, legacyProfile.id)).rejects.toThrow(
			`Unknown browser profile: ${legacyProfile.id}`,
		)
		await expect(store.create(USER_A)).resolves.toMatchObject({ id: 'fresh' })
		const persisted = JSON.parse(await readFile(appPaths.dataFile('browsers.json'), 'utf8')) as {
			schema: string
			profiles: unknown[]
		}
		expect(persisted.schema).toBe('legacy')
		expect(persisted.profiles[0]).toEqual(legacyProfile)
	})

	it('never reuses an orphan profile directory for a new account', async () => {
		await profileStore.ensureProfile('orphan')
		await writeFile(path.join(appPaths.profilesRoot(), 'orphan', 'secret.txt'), 'legacy-data')
		const ids = ['orphan', 'fresh']
		const store = new BrowserProfileStore(appPaths, profileStore, {
			idFactory: () => ids.shift() ?? 'fallback',
		})

		await expect(store.create(USER_A)).resolves.toMatchObject({ id: 'fresh' })
		await expect(
			readFile(path.join(appPaths.profilesRoot(), 'orphan', 'secret.txt'), 'utf8'),
		).resolves.toBe('legacy-data')
		await expect(store.listForReconciliation()).resolves.toEqual(
			expect.arrayContaining([
				{ id: 'orphan', accountNamespace: null },
				{ id: 'fresh', accountNamespace: USER_A },
			]),
		)
	})
})
