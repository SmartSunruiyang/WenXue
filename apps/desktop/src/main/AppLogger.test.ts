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

	it('redacts credentials before writing main-process or launcher logs', () => {
		const append = vi.fn(async (entries: unknown[]) => {
			void entries
			return []
		})
		const logStore = { append }
		const logger = createAppLogger(appPaths, logStore)

		logger.log('Gateway', 'error', 'Bearer top-secret api_key=query-secret')

		const entry = append.mock.calls[0]?.[0]?.[0] as { message?: string } | undefined
		expect(entry?.message).not.toContain('top-secret')
		expect(entry?.message).not.toContain('query-secret')
	})

	it('redacts credentials split across browser stream chunks', async () => {
		const logger = createAppLogger(appPaths)
		const readable = Readable.from([
			'Authorization: Bearer top-',
			'secret\nhttps://api.example/v1?api_key=query-secret\n',
		])

		logger.attachStream('default', readable)
		await finished(readable)

		await vi.waitFor(async () => {
			const content = await readFile(path.join(appPaths.logsDir(), 'browser-default.log'), 'utf8')
			expect(content).not.toContain('top-secret')
			expect(content).not.toContain('query-secret')
			expect(content).toContain('[redacted]')
		})
	})
})
