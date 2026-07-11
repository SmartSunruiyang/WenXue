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

export interface BrowserLaunchOptions {
	startUrl?: string
}

type StatusListener = (status: BrowserStatus) => void
type ProfileStatusListener = (profileId: string, status: BrowserStatus) => void
const GRACEFUL_SHUTDOWN_MS = 2000
const FORCE_SHUTDOWN_MS = 5000

interface BrowserInstance {
	child: BrowserProcessLike
	binary: string
	argv: string[]
	shutdownRequested: boolean
}

export class BrowserSupervisor {
	private readonly spawnBrowser: (binary: string, argv: string[]) => BrowserProcessLike
	private readonly focusExisting: (binary: string, argv: string[]) => void | Promise<void>
	private readonly listeners = new Set<StatusListener>()
	private readonly profileListeners = new Set<ProfileStatusListener>()
	private readonly instances = new Map<string, BrowserInstance>()
	private readonly pendingLaunches = new Map<string, object>()
	private readonly statusValues = new Map<string, BrowserStatus>()

	constructor(private readonly deps: BrowserSupervisorDeps) {
		this.spawnBrowser = deps.spawnBrowser ?? defaultSpawnBrowser
		this.focusExisting = deps.focusExisting ?? defaultFocusExisting
	}

	async launch(profileId = 'default', options: BrowserLaunchOptions = {}): Promise<void> {
		const status = this.profileStatus(profileId)
		if (status === 'launching') return

		const current = this.instances.get(profileId)
		if (status === 'running' && current) {
			const focusArgv = options.startUrl
				? buildArgv({
						userDataDir: await this.deps.profiles.ensureProfile(profileId),
						extensionDir: this.deps.resources.extensionDir(),
						startUrl: options.startUrl,
					})
				: current.argv
			await this.focusExisting(current.binary, focusArgv)
			return
		}

		this.setProfileStatus(profileId, 'launching')
		this.deps.logger.log('BrowserSupervisor', 'info', `launching profile ${profileId}`)
		const launchToken = {}
		this.pendingLaunches.set(profileId, launchToken)

		let child: BrowserProcessLike
		let binary: string
		let argv: string[]
		try {
			const userDataDir = await this.deps.profiles.prepareForUnpackedExtension(profileId)
			if (this.pendingLaunches.get(profileId) !== launchToken) return
			binary = this.deps.resources.browserBinary()
			argv = buildArgv({
				userDataDir,
				extensionDir: this.deps.resources.extensionDir(),
				startUrl: options.startUrl ?? 'chrome://newtab',
			})
			child = this.spawnBrowser(binary, argv)
		} catch (error) {
			if (this.pendingLaunches.get(profileId) !== launchToken) return
			this.pendingLaunches.delete(profileId)
			this.instances.delete(profileId)
			this.setProfileStatus(profileId, 'error')
			throw error
		}

		this.pendingLaunches.delete(profileId)
		this.instances.set(profileId, {
			child,
			binary,
			argv: [...argv],
			shutdownRequested: false,
		})
		this.attachBrowserLogs(profileId, child)
		this.bindChildEvents(profileId, child)
	}

	async stop(profileId: string): Promise<void> {
		this.pendingLaunches.delete(profileId)
		const current = this.instances.get(profileId)
		if (!current) {
			this.setProfileStatus(profileId, 'idle')
			return
		}
		this.deps.logger.log('BrowserSupervisor', 'info', `stopping profile ${profileId}`)

		await new Promise<void>((resolve) => {
			let settled = false
			let forceTimer: NodeJS.Timeout | undefined
			let timeoutTimer: NodeJS.Timeout | undefined
			const settle = () => {
				if (settled) return
				settled = true
				clearTimeout(forceTimer)
				clearTimeout(timeoutTimer)
				resolve()
			}
			const forceShutdown = () => {
				const latest = this.instances.get(profileId)
				if (latest?.child !== current.child) {
					settle()
					return
				}
				this.deps.logger.log('BrowserSupervisor', 'warn', `force stopping profile ${profileId}`)
				current.child.kill('SIGKILL')
			}
			forceTimer = setTimeout(forceShutdown, GRACEFUL_SHUTDOWN_MS)
			timeoutTimer = setTimeout(() => {
				const latest = this.instances.get(profileId)
				if (latest?.child === current.child) {
					this.instances.delete(profileId)
					this.setProfileStatus(profileId, 'error')
				}
				settle()
			}, FORCE_SHUTDOWN_MS)

			current.child.on('exit', settle)
			current.shutdownRequested = true
			if (!current.child.kill('SIGTERM')) {
				this.instances.delete(profileId)
				this.setProfileStatus(profileId, 'idle')
				settle()
			}
		})
	}

	status(): BrowserStatus {
		const statuses = Array.from(this.statusValues.values())
		if (statuses.includes('error')) return 'error'
		if (statuses.includes('launching')) return 'launching'
		if (statuses.includes('running')) return 'running'
		return 'idle'
	}

	statuses(): Record<string, BrowserStatus> {
		return Object.fromEntries(this.statusValues.entries())
	}

	onStatusChange(cb: StatusListener): () => void {
		this.listeners.add(cb)
		return () => {
			this.listeners.delete(cb)
		}
	}

	onProfileStatusChange(cb: ProfileStatusListener): () => void {
		this.profileListeners.add(cb)
		return () => {
			this.profileListeners.delete(cb)
		}
	}

	async requestShutdown(): Promise<void> {
		const profileIds = new Set([
			...Array.from(this.instances.keys()),
			...Array.from(this.pendingLaunches.keys()),
		])
		await Promise.all(Array.from(profileIds).map((profileId) => this.stop(profileId)))
	}

	private bindChildEvents(profileId: string, child: BrowserProcessLike): void {
		child.on('spawn', () => {
			if (this.instances.get(profileId)?.child === child) {
				this.deps.logger.log('BrowserSupervisor', 'info', `profile ${profileId} running`)
				this.setProfileStatus(profileId, 'running')
			}
		})
		child.on('error', (error) => {
			if (this.instances.get(profileId)?.child !== child) return

			this.deps.logger.log('BrowserSupervisor', 'error', error.message)
			this.instances.delete(profileId)
			this.setProfileStatus(profileId, 'error')
		})
		child.on('exit', (code, signal) => {
			const current = this.instances.get(profileId)
			if (current?.child !== child) return

			const wasRequestedShutdown = current.shutdownRequested
			const wasNormalExit = (code === 0 || code === null) && signal === null
			this.instances.delete(profileId)
			this.deps.logger.log(
				'BrowserSupervisor',
				wasRequestedShutdown || wasNormalExit ? 'info' : 'error',
				`profile ${profileId} exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`,
			)
			this.setProfileStatus(profileId, wasRequestedShutdown || wasNormalExit ? 'idle' : 'error')
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

	private profileStatus(profileId: string): BrowserStatus {
		return this.statusValues.get(profileId) ?? 'idle'
	}

	private setProfileStatus(profileId: string, next: BrowserStatus): void {
		if (next === this.profileStatus(profileId)) return

		const previousAggregate = this.status()
		this.statusValues.set(profileId, next)
		this.profileListeners.forEach((listener) => {
			listener(profileId, next)
		})
		const nextAggregate = this.status()
		if (previousAggregate !== nextAggregate) {
			this.listeners.forEach((listener) => {
				listener(nextAggregate)
			})
		}
	}
}

function defaultSpawnBrowser(binary: string, argv: string[]): BrowserProcessLike {
	return spawn(binary, argv, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

function defaultFocusExisting(binary: string, argv: string[]): void {
	const process = spawn(binary, argv, { detached: true, stdio: 'ignore' })
	process.unref()
}
