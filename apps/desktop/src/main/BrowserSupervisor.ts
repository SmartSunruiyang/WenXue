import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { AppLogger } from './AppLogger'
import type { BrowserResources } from './BrowserResources'
import { buildArgv } from './launchConfig'
import type { ProfileStore } from './ProfileStore'

export type BrowserStatus = 'idle' | 'launching' | 'running' | 'error'

export interface BrowserProcessLike {
	stdout?: Readable | null
	stderr?: Readable | null
	kill(signal?: NodeJS.Signals): boolean
	on(event: 'spawn', listener: () => void): this
	on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
	on(event: 'error', listener: (error: Error) => void): this
}

export interface BrowserSupervisorDeps {
	resources: BrowserResources
	profiles: ProfileStore
	logger: AppLogger
	spawnBrowser?: (binary: string, argv: string[]) => BrowserProcessLike
	focusExisting?: (binary: string, argv: string[]) => void | Promise<void>
}

type StatusListener = (status: BrowserStatus) => void

export class BrowserSupervisor {
	private readonly spawnBrowser: (binary: string, argv: string[]) => BrowserProcessLike
	private readonly focusExisting: (binary: string, argv: string[]) => void | Promise<void>
	private readonly listeners = new Set<StatusListener>()
	private statusValue: BrowserStatus = 'idle'
	private child: BrowserProcessLike | undefined
	private currentBinary: string | undefined
	private currentArgv: string[] | undefined

	constructor(private readonly deps: BrowserSupervisorDeps) {
		this.spawnBrowser = deps.spawnBrowser ?? defaultSpawnBrowser
		this.focusExisting = deps.focusExisting ?? defaultFocusExisting
	}

	async launch(profileId = 'default'): Promise<void> {
		if (this.statusValue === 'launching') return

		if (this.statusValue === 'running') {
			if (this.currentBinary && this.currentArgv) {
				await this.focusExisting(this.currentBinary, this.currentArgv)
			}
			return
		}

		const userDataDir = await this.deps.profiles.ensureProfile(profileId)
		const binary = this.deps.resources.browserBinary()
		const argv = buildArgv({
			userDataDir,
			extensionDir: this.deps.resources.extensionDir(),
		})

		this.setStatus('launching')

		let child: BrowserProcessLike
		try {
			child = this.spawnBrowser(binary, argv)
		} catch (error) {
			this.clearCurrentProcess()
			this.setStatus('error')
			throw error
		}

		this.child = child
		this.currentBinary = binary
		this.currentArgv = [...argv]
		this.attachBrowserLogs(profileId, child)
		this.bindChildEvents(child)
	}

	status(): BrowserStatus {
		return this.statusValue
	}

	onStatusChange(cb: StatusListener): () => void {
		this.listeners.add(cb)
		return () => {
			this.listeners.delete(cb)
		}
	}

	async requestShutdown(): Promise<void> {
		const child = this.child
		if (!child) return

		await new Promise<void>((resolve) => {
			let settled = false
			const settle = () => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				resolve()
			}
			const timer = setTimeout(settle, 2000)

			child.on('exit', settle)
			child.kill()
		})
	}

	private bindChildEvents(child: BrowserProcessLike): void {
		child.on('spawn', () => {
			if (this.child === child) {
				this.setStatus('running')
			}
		})
		child.on('error', (error) => {
			if (this.child !== child) return

			this.deps.logger.log('BrowserSupervisor', 'error', error.message)
			this.clearCurrentProcess()
			this.setStatus('error')
		})
		child.on('exit', (code, signal) => {
			if (this.child !== child) return

			this.clearCurrentProcess()
			this.setStatus((code === 0 || code === null) && signal === null ? 'idle' : 'error')
		})
	}

	private attachBrowserLogs(profileId: string, child: BrowserProcessLike): void {
		if (child.stdout) {
			this.deps.logger.attachStream(profileId, child.stdout)
		}
		if (child.stderr) {
			this.deps.logger.attachStream(profileId, child.stderr)
		}
	}

	private clearCurrentProcess(): void {
		this.child = undefined
		this.currentBinary = undefined
		this.currentArgv = undefined
	}

	private setStatus(next: BrowserStatus): void {
		if (next === this.statusValue) return

		this.statusValue = next
		this.listeners.forEach((listener) => {
			listener(next)
		})
	}
}

function defaultSpawnBrowser(binary: string, argv: string[]): BrowserProcessLike {
	return spawn(binary, argv, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

function defaultFocusExisting(binary: string, argv: string[]): void {
	const process = spawn(binary, argv, { detached: true, stdio: 'ignore' })
	process.unref()
}
