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

	constructor(
		private readonly exitOnKill: {
			code: number | null
			signal: NodeJS.Signals | null
		} = { code: 0, signal: null },
	) {
		super()
	}

	kill(): boolean {
		this.killCalls += 1
		this.emit('exit', this.exitOnKill.code, this.exitOnKill.signal)
		return true
	}
}

function createSupervisorHarness(options: { child?: FakeBrowserProcess } = {}) {
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
		const { supervisor, child, events } = createSupervisorHarness()

		expect(supervisor.status()).toBe('idle')
		await supervisor.launch()
		expect(events).toEqual(['launching'])

		child.emit('spawn')
		expect(supervisor.status()).toBe('running')
		expect(events).toEqual(['launching', 'running'])
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

	it('focuses the existing browser while running without replacing the child', async () => {
		const { supervisor, child, spawns, focusCalls, events } = createSupervisorHarness()

		await supervisor.launch()
		child.emit('spawn')
		await supervisor.launch()

		expect(spawns).toHaveLength(1)
		expect(focusCalls).toEqual(spawns)
		expect(events).toEqual(['launching', 'running'])
	})

	it('requests browser shutdown and resolves after exit', async () => {
		const { supervisor, child } = createSupervisorHarness()

		await supervisor.launch()
		child.emit('spawn')
		await supervisor.requestShutdown()

		expect(child.killCalls).toBe(1)
		expect(supervisor.status()).toBe('idle')
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

	it('resolves shutdown without throwing when idle', async () => {
		const { supervisor } = createSupervisorHarness()

		await expect(supervisor.requestShutdown()).resolves.toBeUndefined()
	})
})
