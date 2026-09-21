import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { AppLogger } from './AppLogger'
import type { BrowserResources } from './BrowserResources'
import { BrowserSupervisor, type BrowserStatus } from './BrowserSupervisor'
import type { ProfileStore } from './ProfileStore'

class FakeBrowserProcess extends EventEmitter {
	stdout = new PassThrough()
	stderr = new PassThrough()
	killCalls = 0
	killSignals: Array<NodeJS.Signals | undefined> = []

	constructor(
		private readonly exitOnKill: {
			code: number | null
			signal: NodeJS.Signals | null
		} | null = { code: 0, signal: null },
	) {
		super()
	}

	kill(signal?: NodeJS.Signals): boolean {
		this.killCalls += 1
		this.killSignals.push(signal)
		if (this.exitOnKill) {
			this.emit('exit', this.exitOnKill.code, this.exitOnKill.signal)
		}
		return true
	}
}

function createSupervisorHarness(
	options: {
		child?: FakeBrowserProcess
	} = {},
) {
	const firstChild = options.child ?? new FakeBrowserProcess()
	const queuedChildren: FakeBrowserProcess[] = [firstChild]
	const spawns: Array<{ binary: string; argv: string[] }> = []
	const focusCalls: Array<{ binary: string; argv: string[] }> = []
	const events: BrowserStatus[] = []
	const profileEvents: Array<{ profileId: string; status: BrowserStatus }> = []
	const resources: BrowserResources = {
		browserBinary: () => '/browsers/cft',
		extensionDir: () => '/extensions/wenxue',
		browserVersion: () => '149.0.7827.55',
	}
	const profiles = {
		ensureProfile: vi.fn(async (profileId = 'default') => `/profiles/${profileId}`),
		prepareForUnpackedExtension: vi.fn(async (profileId = 'default') => `/profiles/${profileId}`),
		markProfileLaunching: vi.fn(async () => undefined),
		clearProfileLaunching: vi.fn(async () => undefined),
		isProfileInUse: vi.fn(async () => false),
		profilePath: vi.fn((profileId = 'default') => `/profiles/${profileId}`),
		listProfiles: vi.fn(() => ['default']),
	} as unknown as ProfileStore
	const logger: AppLogger = {
		log: vi.fn(),
		attachStream: vi.fn(),
	}
	const supervisor = new BrowserSupervisor({
		resources,
		profiles,
		logger,
		spawnBrowser: (binary, argv) => {
			spawns.push({ binary, argv })
			return queuedChildren.shift() ?? new FakeBrowserProcess()
		},
		focusExisting: async (binary, argv) => {
			focusCalls.push({ binary, argv })
		},
	})

	supervisor.onStatusChange((status) => events.push(status))
	supervisor.onProfileStatusChange((profileId, status) => profileEvents.push({ profileId, status }))

	return {
		supervisor,
		child: firstChild,
		queueChild(next: FakeBrowserProcess) {
			queuedChildren.push(next)
			return next
		},
		spawns,
		focusCalls,
		events,
		profileEvents,
		logger,
		profiles,
	}
}

describe('BrowserSupervisor', () => {
	it('starts idle and emits launching then running during launch', async () => {
		const { supervisor, child, events, profiles, spawns } = createSupervisorHarness()

		expect(supervisor.status()).toBe('idle')
		expect(supervisor.hasActiveProfiles()).toBe(false)
		await supervisor.launch()
		expect(supervisor.hasActiveProfiles()).toBe(true)
		expect(profiles.prepareForUnpackedExtension).toHaveBeenCalledWith('default')
		expect(spawns[0].argv).not.toContain('--remote-debugging-address=127.0.0.1')
		expect(spawns[0].argv).not.toContain('--remote-debugging-port=0')
		expect(events).toEqual(['launching'])

		child.emit('spawn')
		expect(supervisor.status()).toBe('running')
		expect(events).toEqual(['launching', 'running'])
	})

	it('does not spawn into an occupied profile after launcher restart', async () => {
		const { supervisor, profiles, spawns } = createSupervisorHarness()
		vi.mocked(profiles.isProfileInUse).mockResolvedValueOnce(true)

		await expect(supervisor.launch('research')).rejects.toThrow('已被其他进程占用')
		expect(profiles.markProfileLaunching).not.toHaveBeenCalled()
		expect(spawns).toHaveLength(0)

		await supervisor.launch('research')
		expect(spawns).toHaveLength(1)
	})

	it('returns to idle after normal browser exit', async () => {
		const { supervisor, child, events } = createSupervisorHarness()

		await supervisor.launch()
		child.emit('spawn')
		child.emit('exit', 0, null)

		expect(supervisor.status()).toBe('idle')
		expect(events).toEqual(['launching', 'running', 'idle'])
	})

	it('enters error on child error or non-zero exit', async () => {
		const first = createSupervisorHarness()
		await first.supervisor.launch()
		first.child.emit('error', new Error('spawn failed'))

		expect(first.supervisor.status()).toBe('error')
		expect(first.events).toEqual(['launching', 'error'])

		const second = createSupervisorHarness()
		await second.supervisor.launch()
		second.child.emit('spawn')
		second.child.emit('exit', 11, null)

		expect(second.supervisor.status()).toBe('error')
		expect(second.events).toEqual(['launching', 'running', 'error'])
	})

	it('attaches browser stdout and stderr to the default profile log', async () => {
		const { supervisor, child, logger } = createSupervisorHarness()

		await supervisor.launch()

		expect(logger.attachStream).toHaveBeenCalledWith('default', child.stdout)
		expect(logger.attachStream).toHaveBeenCalledWith('default', child.stderr)
	})

	it('launches different profiles in parallel and reports per-profile statuses', async () => {
		const { supervisor, child, queueChild, spawns, profileEvents, logger } =
			createSupervisorHarness()
		const research = queueChild(new FakeBrowserProcess())

		await supervisor.launch('default')
		child.emit('spawn')
		await supervisor.launch('research')
		research.emit('spawn')

		expect(spawns).toHaveLength(2)
		expect(spawns[0].argv).toContain('--user-data-dir=/profiles/default')
		expect(spawns[1].argv).toContain('--user-data-dir=/profiles/research')
		expect(supervisor.status()).toBe('running')
		expect(supervisor.statuses()).toEqual({
			default: 'running',
			research: 'running',
		})
		expect(profileEvents).toEqual([
			{ profileId: 'default', status: 'launching' },
			{ profileId: 'default', status: 'running' },
			{ profileId: 'research', status: 'launching' },
			{ profileId: 'research', status: 'running' },
		])
		expect(logger.attachStream).toHaveBeenCalledWith('research', research.stdout)
	})

	it('focuses only the requested running profile and can stop it without affecting others', async () => {
		const { supervisor, child, queueChild, spawns, focusCalls, profileEvents } =
			createSupervisorHarness()
		const research = queueChild(new FakeBrowserProcess())

		await supervisor.launch('default')
		child.emit('spawn')
		await supervisor.launch('research')
		research.emit('spawn')
		await supervisor.launch('research')
		await supervisor.stop('research')

		expect(spawns).toHaveLength(2)
		expect(focusCalls).toEqual([spawns[1]])
		expect(research.killCalls).toBe(1)
		expect(child.killCalls).toBe(0)
		expect(supervisor.statuses()).toEqual({
			default: 'running',
			research: 'idle',
		})
		expect(supervisor.status()).toBe('running')
		expect(profileEvents.at(-1)).toEqual({ profileId: 'research', status: 'idle' })
	})

	it('does not spawn twice while launch is in progress', async () => {
		const { supervisor, spawns, events } = createSupervisorHarness()

		await supervisor.launch()
		await supervisor.launch()

		expect(spawns).toHaveLength(1)
		expect(events).toEqual(['launching'])
	})

	it('claims the profile before awaiting preparation so concurrent launches cannot race', async () => {
		const { supervisor, spawns, events, profiles } = createSupervisorHarness()
		let finishPreparation!: (dir: string) => void
		vi.mocked(profiles.prepareForUnpackedExtension).mockImplementation(
			() =>
				new Promise((resolve) => {
					finishPreparation = resolve
				}),
		)

		const first = supervisor.launch()
		const second = supervisor.launch()
		await vi.waitFor(() => expect(profiles.prepareForUnpackedExtension).toHaveBeenCalledOnce())
		expect(events).toEqual(['launching'])

		finishPreparation('/profiles/default')
		await Promise.all([first, second])

		expect(spawns).toHaveLength(1)
	})

	it('cancels a pending launch when the profile is stopped during preparation', async () => {
		const { supervisor, spawns, events, profiles } = createSupervisorHarness()
		let finishPreparation!: (dir: string) => void
		vi.mocked(profiles.prepareForUnpackedExtension).mockImplementation(
			() =>
				new Promise((resolve) => {
					finishPreparation = resolve
				}),
		)

		const launch = supervisor.launch()
		await vi.waitFor(() => expect(profiles.prepareForUnpackedExtension).toHaveBeenCalledOnce())
		await supervisor.stop('default')
		expect(supervisor.status()).toBe('idle')

		finishPreparation('/profiles/default')
		await launch

		expect(spawns).toHaveLength(0)
		expect(events).toEqual(['launching', 'idle'])
	})

	it('cancels and clears a cross-process launch marker before spawning', async () => {
		const { supervisor, spawns, profiles } = createSupervisorHarness()
		let finishMarker!: () => void
		vi.mocked(profiles.markProfileLaunching).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishMarker = () => resolve(undefined)
				}),
		)

		const launch = supervisor.launch('research')
		await vi.waitFor(() => expect(profiles.markProfileLaunching).toHaveBeenCalledWith('research'))
		await supervisor.stop('research')
		finishMarker()
		await launch

		expect(profiles.clearProfileLaunching).toHaveBeenCalledWith('research')
		expect(spawns).toHaveLength(0)
		expect(supervisor.statuses()).toEqual({ research: 'idle' })
	})

	it('cancels pending launches during application shutdown', async () => {
		const { supervisor, spawns, profiles } = createSupervisorHarness()
		let finishPreparation!: (dir: string) => void
		vi.mocked(profiles.prepareForUnpackedExtension).mockImplementation(
			() =>
				new Promise((resolve) => {
					finishPreparation = resolve
				}),
		)

		const launch = supervisor.launch()
		await vi.waitFor(() => expect(profiles.prepareForUnpackedExtension).toHaveBeenCalledOnce())
		await supervisor.requestShutdown()
		finishPreparation('/profiles/default')
		await launch

		expect(spawns).toHaveLength(0)
		expect(supervisor.status()).toBe('idle')
	})

	it('focuses the existing browser while running without replacing the child', async () => {
		const { supervisor, child, spawns, focusCalls, events } = createSupervisorHarness()

		await supervisor.launch()
		child.emit('spawn')
		await supervisor.launch()

		expect(spawns).toHaveLength(1)
		expect(focusCalls).toEqual(spawns)
		expect(events).toEqual(['launching', 'running'])
	})

	it('opens requested URLs in order when focusing an already running profile', async () => {
		const { supervisor, child, spawns, focusCalls } = createSupervisorHarness()

		await supervisor.launch('default', { startUrls: ['chrome://newtab'] })
		child.emit('spawn')
		await supervisor.launch('default', {
			startUrls: ['chrome://newtab', 'http://127.0.0.1:4321/wenxue-user-session-handoff/test'],
		})

		expect(spawns).toHaveLength(1)
		expect(focusCalls).toHaveLength(1)
		expect(focusCalls[0].argv.slice(-2)).toEqual([
			'chrome://newtab',
			'http://127.0.0.1:4321/wenxue-user-session-handoff/test',
		])
	})

	it('requests browser shutdown and resolves after exit', async () => {
		const { supervisor, child } = createSupervisorHarness()

		await supervisor.launch()
		child.emit('spawn')
		await supervisor.requestShutdown()

		expect(child.killCalls).toBe(1)
		expect(child.killSignals).toEqual(['SIGTERM'])
		expect(supervisor.status()).toBe('idle')
	})

	it('reports an untracked profile idle only after two inactive checks', async () => {
		vi.useFakeTimers()
		try {
			const { supervisor, profiles } = createSupervisorHarness()
			vi.mocked(profiles.isProfileInUse).mockResolvedValue(false)

			const stop = supervisor.stop('research')
			await vi.advanceTimersByTimeAsync(100)
			await expect(stop).resolves.toBeUndefined()

			expect(profiles.isProfileInUse).toHaveBeenCalledTimes(2)
			expect(profiles.isProfileInUse).toHaveBeenCalledWith('research')
			expect(supervisor.statuses()).toEqual({})
		} finally {
			vi.useRealTimers()
		}
	})

	it('rechecks an apparently idle untracked profile before accepting the account boundary', async () => {
		vi.useFakeTimers()
		try {
			const { supervisor, profiles } = createSupervisorHarness()
			vi.mocked(profiles.isProfileInUse).mockResolvedValueOnce(false).mockResolvedValue(true)

			const stopResult = expect(supervisor.stop('research')).rejects.toThrow(
				'浏览器配置 research 仍在运行，无法安全退出账号。',
			)
			await vi.advanceTimersByTimeAsync(100)
			await stopResult

			expect(profiles.isProfileInUse).toHaveBeenCalledTimes(2)
			expect(supervisor.statuses()).toEqual({ research: 'error' })
		} finally {
			vi.useRealTimers()
		}
	})

	it('rejects account switch while an untracked browser still owns the profile', async () => {
		const { supervisor, profiles, child } = createSupervisorHarness()
		vi.mocked(profiles.isProfileInUse).mockResolvedValue(true)

		await expect(supervisor.stop('research')).rejects.toThrow(
			'浏览器配置 research 仍在运行，无法安全退出账号。',
		)

		expect(profiles.isProfileInUse).toHaveBeenCalledOnce()
		expect(child.killSignals).toEqual([])
		expect(supervisor.statuses()).toEqual({ research: 'error' })
	})
	it('force kills a profile when graceful shutdown does not exit', async () => {
		vi.useFakeTimers()
		try {
			const child = new FakeBrowserProcess(null)
			child.kill = vi.fn((signal?: NodeJS.Signals) => {
				child.killCalls += 1
				child.killSignals.push(signal)
				if (signal === 'SIGKILL') {
					child.emit('exit', null, 'SIGKILL')
				}
				return true
			})
			const { supervisor } = createSupervisorHarness({ child })

			await supervisor.launch()
			child.emit('spawn')
			const stopPromise = supervisor.stop('default')

			expect(child.killSignals).toEqual(['SIGTERM'])
			await vi.advanceTimersByTimeAsync(2000)
			await stopPromise

			expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL'])
			expect(supervisor.status()).toBe('idle')
		} finally {
			vi.useRealTimers()
		}
	})

	it('does not relaunch over a process that remains live after shutdown timeout', async () => {
		vi.useFakeTimers()
		try {
			const child = new FakeBrowserProcess(null)
			const { supervisor, spawns } = createSupervisorHarness({ child })
			await supervisor.launch('research')
			child.emit('spawn')

			const stopResult = expect(supervisor.stop('research')).rejects.toThrow(
				'浏览器配置 research 未能安全关闭，请重试。',
			)
			await vi.advanceTimersByTimeAsync(5000)
			await stopResult

			expect(supervisor.hasActiveProfiles()).toBe(true)
			await expect(supervisor.launch('research')).rejects.toThrow(
				'浏览器配置 research 仍在关闭中，请先重试停止。',
			)
			expect(spawns).toHaveLength(1)

			child.emit('exit', null, 'SIGKILL')
			expect(supervisor.hasActiveProfiles()).toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})

	it('retains the live handle when process signals cannot be delivered', async () => {
		vi.useFakeTimers()
		try {
			const child = new FakeBrowserProcess(null)
			child.kill = vi.fn(() => false)
			const { supervisor, spawns } = createSupervisorHarness({ child })
			await supervisor.launch('research')
			child.emit('spawn')

			const stopResult = expect(supervisor.stop('research')).rejects.toThrow(
				'浏览器配置 research 未能安全关闭，请重试。',
			)
			await vi.advanceTimersByTimeAsync(5000)
			await stopResult

			expect(supervisor.hasActiveProfiles()).toBe(true)
			await expect(supervisor.launch('research')).rejects.toThrow('仍在关闭中')
			expect(spawns).toHaveLength(1)

			child.emit('exit', 0, null)
			expect(supervisor.hasActiveProfiles()).toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})

	it('retains a spawned child handle when it emits an error before exit', async () => {
		const { supervisor, child, spawns } = createSupervisorHarness()
		await supervisor.launch('research')
		child.emit('spawn')

		child.emit('error', new Error('kill failed'))

		expect(supervisor.hasActiveProfiles()).toBe(true)
		expect(supervisor.statuses()).toEqual({ research: 'error' })
		await expect(supervisor.launch('research')).rejects.toThrow('仍有未退出进程')
		expect(spawns).toHaveLength(1)

		child.emit('exit', 0, null)
		expect(supervisor.hasActiveProfiles()).toBe(false)
	})

	it('handles launch-marker cleanup rejection after child exit without an unhandled rejection', async () => {
		const { supervisor, child, logger, profiles } = createSupervisorHarness()
		vi.mocked(profiles.clearProfileLaunching).mockRejectedValue(new Error('disk denied'))
		await supervisor.launch('research')
		child.emit('spawn')

		child.emit('exit', 0, null)

		await vi.waitFor(() => expect(supervisor.statuses()).toEqual({ research: 'error' }))
		expect(logger.log).toHaveBeenCalledWith(
			'BrowserSupervisor',
			'error',
			'failed to clear launch marker for research: disk denied',
		)
	})

	it('waits for one shared exit cleanup before relaunching the same profile', async () => {
		const { supervisor, child, queueChild, profiles, spawns } = createSupervisorHarness()
		queueChild(new FakeBrowserProcess())
		let finishCleanup!: () => void
		vi.mocked(profiles.clearProfileLaunching).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishCleanup = () => resolve(undefined)
				}),
		)

		await supervisor.launch('research')
		child.emit('spawn')
		const stop = supervisor.stop('research')
		await vi.waitFor(() => expect(profiles.clearProfileLaunching).toHaveBeenCalledOnce())

		const relaunch = supervisor.launch('research')
		await Promise.resolve()
		expect(profiles.markProfileLaunching).toHaveBeenCalledOnce()
		expect(spawns).toHaveLength(1)

		finishCleanup()
		await Promise.all([stop, relaunch])

		expect(profiles.clearProfileLaunching).toHaveBeenCalledOnce()
		expect(profiles.markProfileLaunching).toHaveBeenCalledTimes(2)
		expect(spawns).toHaveLength(2)
	})

	it('treats signal exit during requested shutdown as idle', async () => {
		const child = new FakeBrowserProcess({ code: null, signal: 'SIGTERM' })
		const { supervisor, events } = createSupervisorHarness({ child })

		await supervisor.launch()
		child.emit('spawn')
		await supervisor.requestShutdown()

		expect(supervisor.status()).toBe('idle')
		expect(events).toEqual(['launching', 'running', 'idle'])
	})

	it('treats a non-zero exit code during requested shutdown as a completed stop', async () => {
		const child = new FakeBrowserProcess({ code: 1, signal: null })
		const { supervisor } = createSupervisorHarness({ child })

		await supervisor.launch()
		child.emit('spawn')
		await expect(supervisor.requestShutdown()).resolves.toBeUndefined()
		expect(supervisor.status()).toBe('idle')
	})

	it('resolves shutdown without throwing when idle', async () => {
		const { supervisor } = createSupervisorHarness()

		await expect(supervisor.requestShutdown()).resolves.toBeUndefined()
	})
})
