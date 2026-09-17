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
		const settings = createSettings()
		const store = new LauncherLogStore(new AppPaths(tempDir), settings)
		const logFile = path.join(tempDir, 'launcher-logs.json')
		await writeFile(logFile, '{"entries":[]}\n{"trailing":"broken"}', 'utf8')

		await expect(store.query()).resolves.toEqual([])

		const files = await readdir(tempDir)
		expect(files.some((file) => file.startsWith('launcher-logs.json.corrupt-'))).toBe(true)
		await expect(readFile(logFile, 'utf8').then((content) => JSON.parse(content))).resolves.toEqual(
			{
				entries: [],
			},
		)
	})

	it('serializes concurrent appends without losing entries or reusing IDs', async () => {
		const settings = createSettings()
		const store = new LauncherLogStore(new AppPaths(tempDir), settings)

		await Promise.all(
			Array.from({ length: 50 }, (_, index) =>
				store.append([
					{
						ts: Date.now() + index,
						level: 'info',
						source: 'system',
						context: 'background',
						browserId: 'launcher',
						message: `entry-${index}`,
					},
				]),
			),
		)

		const entries = await store.query({ limit: 100 })
		expect(entries).toHaveLength(50)
		expect(new Set(entries.map((entry) => entry.id))).toHaveLength(50)
		expect(new Set(entries.map((entry) => entry.message))).toHaveLength(50)
		expect(settings.get).toHaveBeenCalledTimes(1)
		expect((await readdir(tempDir)).some((name) => name.includes('.wenxue-'))).toBe(false)
	})

	it('keeps an append that is queued after a concurrent clear', async () => {
		let releaseFirstRetention!: () => void
		const firstRetention = new Promise<void>((resolve) => {
			releaseFirstRetention = resolve
		})
		let shouldBlock = true
		const settings = createSettings()
		vi.mocked(settings.get).mockImplementation(async () => {
			if (shouldBlock) {
				shouldBlock = false
				await firstRetention
			}
			return {
				logs: { retentionDays: 30, maxEntries: 500, minLevel: 'debug' },
			} as Awaited<ReturnType<LauncherSettingsStore['get']>>
		})
		const store = new LauncherLogStore(new AppPaths(tempDir), settings)
		const entry = (message: string) => ({
			ts: Date.now(),
			level: 'info' as const,
			source: 'system' as const,
			context: 'background' as const,
			browserId: 'launcher',
			message,
		})

		const beforeClear = store.append([entry('before-clear')])
		await vi.waitFor(() => expect(settings.get).toHaveBeenCalledTimes(1))
		const clearing = store.clear()
		const afterClear = store.append([entry('after-clear')])
		releaseFirstRetention()
		await Promise.all([beforeClear, clearing, afterClear])

		await expect(store.query()).resolves.toEqual([
			expect.objectContaining({ message: 'after-clear' }),
		])
	})

	it('redacts secrets embedded in log messages before persistence', async () => {
		const store = new LauncherLogStore(new AppPaths(tempDir), createSettings())
		await store.append([
			{
				ts: Date.now(),
				level: 'error',
				source: 'llm',
				context: 'sidepanel',
				browserId: 'default',
				message: 'Authorization: Bearer top-secret https://api.example/v1?api_key=query-secret',
				data: {
					url: 'https://api.example/v1?access_token=structured-secret',
					nested: ['Bearer array-secret'],
				},
			},
		])

		const persisted = await readFile(path.join(tempDir, 'launcher-logs.json'), 'utf8')
		expect(persisted).not.toContain('top-secret')
		expect(persisted).not.toContain('query-secret')
		expect(persisted).not.toContain('structured-secret')
		expect(persisted).not.toContain('array-secret')
		expect(persisted).toContain('[redacted]')
	})
})

function createSettings(): LauncherSettingsStore {
	return {
		get: vi.fn(async () => ({
			logs: {
				retentionDays: 30,
				maxEntries: 500,
				minLevel: 'debug',
			},
		})),
	} as unknown as LauncherSettingsStore
}
