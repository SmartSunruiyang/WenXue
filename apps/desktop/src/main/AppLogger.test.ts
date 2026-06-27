import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppLogger } from './AppLogger'
import { AppPaths } from './AppPaths'

let userDataDir: string
let appPaths: AppPaths

beforeEach(async () => {
	userDataDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-app-logger-'))
	appPaths = new AppPaths(userDataDir)
	await appPaths.ensure()
})

afterEach(async () => {
	await rm(userDataDir, { force: true, recursive: true })
})

describe('createAppLogger', () => {
	it('mirrors main-process log events into the launcher log store', () => {
		const logStore = {
			append: vi.fn(async () => []),
		}
		const logger = createAppLogger(appPaths, logStore)

		logger.log('MainBootstrap', 'info', 'window ready')

		expect(logStore.append).toHaveBeenCalledWith([
			expect.objectContaining({
				browserId: 'launcher',
				context: 'background',
				level: 'info',
				message: '[MainBootstrap] window ready',
				source: 'system',
			}),
		])
	})

	it('writes browser stream chunks to the profile log file', async () => {
		const logger = createAppLogger(appPaths)
		const readable = Readable.from(['hello\n', 'world\n'])

		logger.attachStream('default', readable)
		await finished(readable)

		const content = await readFile(path.join(appPaths.logsDir(), 'browser-default.log'), 'utf8')
		expect(content).toBe('hello\nworld\n')
	})
})
