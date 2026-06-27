import log from 'electron-log/main'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { AppPaths } from './AppPaths'
import type { LauncherLogStore } from './LauncherLogStore'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppLogger {
	log(scope: string, level: LogLevel, message: string): void
	attachStream(profileId: string, readable: Readable): void
}

export function createAppLogger(
	paths: AppPaths,
	launcherLogStore?: Pick<LauncherLogStore, 'append'>,
): AppLogger {
	log.transports.file.resolvePathFn = () => path.join(paths.logsDir(), 'main.log')

	return {
		log(scope: string, level: LogLevel, message: string): void {
			log[level](`[${scope}] ${message}`)
			void launcherLogStore
				?.append([
					{
						ts: Date.now(),
						level,
						source: 'system',
						context: 'background',
						browserId: 'launcher',
						message: `[${scope}] ${message}`,
						data: { scope },
					},
				])
				.catch(() => {})
		},
		attachStream(profileId: string, readable: Readable): void {
			const logPath = path.join(paths.logsDir(), `browser-${profileId}.log`)
			readable.on('data', (chunk: Buffer | string) => {
				appendFileSync(logPath, chunk)
			})
		},
	}
}
