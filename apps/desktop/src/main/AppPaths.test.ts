import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppPaths } from './AppPaths'

let userDataDir: string

beforeEach(async () => {
	userDataDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-app-paths-'))
})

afterEach(async () => {
	await rm(userDataDir, { force: true, recursive: true })
})

describe('AppPaths', () => {
	it('returns the desktop data layout paths', () => {
		const paths = new AppPaths(userDataDir)

		expect(paths.profilesRoot()).toBe(path.join(userDataDir, 'profiles'))
		expect(paths.logsDir()).toBe(path.join(userDataDir, 'logs'))
	})

	it('ensures profile and log directories exist', async () => {
		const paths = new AppPaths(userDataDir)

		await paths.ensure()

		expect((await stat(paths.profilesRoot())).isDirectory()).toBe(true)
		expect((await stat(paths.logsDir())).isDirectory()).toBe(true)
	})
})
