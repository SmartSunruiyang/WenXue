import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppPaths } from './AppPaths'
import { DEFAULT_LAUNCHER_SETTINGS, LauncherSettingsStore } from './LauncherSettingsStore'

let userDataDir: string
let appPaths: AppPaths

beforeEach(async () => {
	userDataDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-settings-store-'))
	appPaths = new AppPaths(userDataDir)
	await appPaths.ensure()
})

afterEach(async () => {
	await rm(userDataDir, { force: true, recursive: true })
})

describe('LauncherSettingsStore', () => {
	it('persists validated settings atomically with a schema version', async () => {
		const store = new LauncherSettingsStore(appPaths)
		await expect(store.update({ launch: { concurrencyLimit: 6 } })).resolves.toMatchObject({
			launch: { concurrencyLimit: 6 },
		})

		const persisted = JSON.parse(await readFile(appPaths.dataFile('settings.json'), 'utf8'))
		expect(persisted).toMatchObject({ version: 1, launch: { concurrencyLimit: 6 } })
		expect((await readdir(userDataDir)).some((name) => name.includes('.wenxue-'))).toBe(false)
	})

	it.each([
		{ launch: { concurrencyLimit: 'x' } },
		{ launch: { concurrencyLimit: 0 } },
		{ launch: { staggerMs: -1 } },
		{ logs: { maxEntries: 1 } },
		{ behavior: { exitWithBrowsers: 'silently-delete' } },
	])('rejects an unsafe settings patch: %j', async (patch) => {
		const store = new LauncherSettingsStore(appPaths)
		await expect(store.update(patch as never)).rejects.toThrow()
		await expect(store.get()).resolves.toEqual(DEFAULT_LAUNCHER_SETTINGS)
	})

	it('quarantines malformed settings and falls back to safe defaults', async () => {
		await writeFile(appPaths.dataFile('settings.json'), '{broken', 'utf8')
		const store = new LauncherSettingsStore(appPaths)

		await expect(store.get()).resolves.toEqual(DEFAULT_LAUNCHER_SETTINGS)
		expect(
			(await readdir(userDataDir)).some((name) => name.startsWith('settings.json.invalid-')),
		).toBe(true)
	})

	it('serializes concurrent partial updates without dropping either section', async () => {
		const store = new LauncherSettingsStore(appPaths)

		await Promise.all([
			store.update({ launch: { concurrencyLimit: 5 } }),
			store.update({ behavior: { openAtLogin: true } }),
		])

		await expect(store.get()).resolves.toMatchObject({
			launch: { concurrencyLimit: 5 },
			behavior: { openAtLogin: true },
		})
	})
})
