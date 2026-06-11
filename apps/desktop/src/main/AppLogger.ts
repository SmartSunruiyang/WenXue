import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import log from 'electron-log/main'
import { AppPaths } from './AppPaths'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppLogger {
	log(scope: string, level: LogLevel, message: string): void
	attachStream(profileId: string, readable: Readable): void
}

export function createAppLogger(paths: AppPaths): AppLogger {
	log.transports.file.resolvePathFn = () => path.join(paths.logsDir(), 'main.log')

	return {
		log(scope: string, level: LogLevel, message: string): void {
			log[level](`[${scope}] ${message}`)
		},
		attachStream(profileId: string, readable: Readable): void {
			const logPath = path.join(paths.logsDir(), `browser-${profileId}.log`)
			readable.on('data', (chunk: Buffer | string) => {
				appendFileSync(logPath, chunk)
			})
		},
	}
}
