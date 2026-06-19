import { afterEach, describe, expect, it, vi } from 'vitest'

import { HubWs } from './hub-ws'

class FakeWebSocket {
	static OPEN = 1
	static instances: FakeWebSocket[] = []

	readyState = FakeWebSocket.OPEN
	sent: string[] = []
	listeners = new Map<string, ((event: { data?: string }) => void)[]>()

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this)
	}

	addEventListener(type: string, listener: (event: { data?: string }) => void) {
		const listeners = this.listeners.get(type) ?? []
		listeners.push(listener)
		this.listeners.set(type, listeners)
	}

	send(message: string) {
		this.sent.push(message)
	}

	close() {
		this.emit('close')
	}

	emit(type: string, data?: string) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener({ data })
		}
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
	FakeWebSocket.instances = []
})

describe('HubWs result protocol', () => {
	it('forwards paused execution state to the caller', async () => {
		vi.stubGlobal('WebSocket', FakeWebSocket)
		vi.stubGlobal('chrome', {
			storage: {
				local: {
					get: vi.fn().mockResolvedValue({ allowAllHubConnection: true }),
				},
			},
		})

		const hub = new HubWs(
			3210,
			{
				onExecute: vi.fn().mockResolvedValue({
					success: false,
					data: 'User paused the task.',
					state: 'paused',
				}),
				onStop: vi.fn(),
			},
			vi.fn(),
		)

		hub.connect()
		const socket = FakeWebSocket.instances[0]
		socket.emit('open')
		socket.emit('message', JSON.stringify({ type: 'execute', task: 'Continue after login' }))

		await vi.waitFor(() => expect(socket.sent).toHaveLength(2))
		expect(JSON.parse(socket.sent[1])).toEqual({
			type: 'result',
			success: false,
			data: 'User paused the task.',
			state: 'paused',
		})
	})
})
