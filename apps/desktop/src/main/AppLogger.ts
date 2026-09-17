import log from 'electron-log/main'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { AppPaths } from './AppPaths'
import { sanitizeLogMessage, type LauncherLogStore } from './LauncherLogStore'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppLogger {
	log(scope: string, level: LogLevel, message: string): void
	attachStream(profileId: string, readable: Readable): void
}

const MAX_PENDING_LOG_LINE_BYTES = 1024 * 1024
const OVERSIZED_LOG_LINE_PLACEHOLDER = '[redacted oversized browser log line]'

export function createAppLogger(
	paths: AppPaths,
	launcherLogStore?: Pick<LauncherLogStore, 'append'>,
): AppLogger {
	log.transports.file.resolvePathFn = () => path.join(paths.logsDir(), 'main.log')

	return {
		log(scope: string, level: LogLevel, message: string): void {
			const safeMessage = sanitizeLogMessage(`[${scope}] ${message}`)
			log[level](safeMessage)
			void launcherLogStore
				?.append([
					{
						ts: Date.now(),
						level,
						source: 'system',
						context: 'background',
						browserId: 'launcher',
						message: safeMessage,
						data: { scope },
					},
				])
				.catch(() => {})
		},
		attachStream(profileId: string, readable: Readable): void {
			const logPath = path.join(paths.logsDir(), `browser-${profileId}.log`)
			const writer = createWriteStream(logPath, { flags: 'a' })
			const sanitizer = createLogSanitizer()
			readable.on('error', (error) => {
				sanitizer.destroy()
				writer.destroy()
				log.error(
					sanitizeLogMessage(
						`[BrowserSupervisor] profile ${profileId} log stream failed: ${error.message}`,
					),
				)
			})
			writer.on('error', (error) => {
				log.error(
					sanitizeLogMessage(
						`[BrowserSupervisor] profile ${profileId} log write failed: ${error.message}`,
					),
				)
			})
			sanitizer.on('error', (error) => {
				writer.destroy()
				log.error(
					sanitizeLogMessage(
						`[BrowserSupervisor] profile ${profileId} log sanitization failed: ${error.message}`,
					),
				)
			})
			readable.pipe(sanitizer).pipe(writer)
		},
	}
}

function createLogSanitizer(): Transform {
	const decoder = new StringDecoder('utf8')
	let pending = ''
	let discardingOversizedLine = false

	const consume = (stream: Transform, input: string): void => {
		let text = input
		if (discardingOversizedLine) {
			const newlineIndex = text.indexOf('\n')
			if (newlineIndex < 0) return
			stream.push(`${OVERSIZED_LOG_LINE_PLACEHOLDER}\n`)
			discardingOversizedLine = false
			text = text.slice(newlineIndex + 1)
		}

		pending += text
		let newlineIndex = pending.indexOf('\n')
		while (newlineIndex >= 0) {
			stream.push(sanitizeLogMessage(pending.slice(0, newlineIndex + 1)))
			pending = pending.slice(newlineIndex + 1)
			newlineIndex = pending.indexOf('\n')
		}

		if (Buffer.byteLength(pending, 'utf8') > MAX_PENDING_LOG_LINE_BYTES) {
			pending = ''
			discardingOversizedLine = true
		}
	}

	return new Transform({
		transform(chunk: Buffer | string, _encoding, callback): void {
			try {
				consume(this, typeof chunk === 'string' ? chunk : decoder.write(chunk))
				callback()
			} catch (error) {
				callback(error as Error)
			}
		},
		flush(callback): void {
			try {
				consume(this, decoder.end())
				if (discardingOversizedLine) {
					this.push(OVERSIZED_LOG_LINE_PLACEHOLDER)
				} else if (pending) {
					this.push(sanitizeLogMessage(pending))
				}
				callback()
			} catch (error) {
				callback(error as Error)
			}
		},
	})
}
