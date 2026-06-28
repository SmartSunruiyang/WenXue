import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppPaths } from './AppPaths'
import { LauncherLogStore } from './LauncherLogStore'
import type { LauncherSettingsStore } from './LauncherSettingsStore'

describe('LauncherLogStore', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'wenxue-log-store-'))
	})

	afterEach(async () => {
		await rm(tempDir, { force: true, recursive: true })
	})

	it('quarantines corrupt log files and recovers with an empty log store', async () => {
		const settings = {
			get: vi.fn(async () => ({
				logs: {
					retentionDays: 30,
					maxEntries: 500,
					minLevel: 'debug',
				},
			})),
		} as unknown as LauncherSettingsStore
		const store = new LauncherLogStore(new AppPaths(tempDir), settings)
		const logFile = path.join(tempDir, 'launcher-logs.json')
		await writeFile(logFile, '{"entries":[]}\n{"trailing":"broken"}', 'utf8')

		await expect(store.query()).resolves.toEqual([])

		const files = await readdir(tempDir)
		expect(files.some((file) => file.startsWith('launcher-logs.json.corrupt-'))).toBe(true)
		await expect(readFile(logFile, 'utf8').then((content) => JSON.parse(content))).resolves.toEqual({
			entries: [],
		})
	})
})
