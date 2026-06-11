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
	const child = options.child ?? new FakeBrowserProcess()
	const spawns: Array<{ binary: string; argv: string[] }> = []
	const focusCalls: Array<{ binary: string; argv: string[] }> = []
	const events: BrowserStatus[] = []
	const resources: BrowserResources = {
		browserBinary: () => '/browsers/cft',
		extensionDir: () => '/extensions/wenxue',
		browserVersion: () => '149.0.7827.55',
	}
	const profiles = {
		ensureProfile: vi.fn(async () => '/profiles/default'),
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
			return child
		},
		focusExisting: async (binary, argv) => {
			focusCalls.push({ binary, argv })
		},
	})

	supervisor.onStatusChange((status) => events.push(status))
	return { supervisor, child, spawns, focusCalls, events, logger, profiles }
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
