import type { ClientAnnouncementView } from '@wenxue/client-operations'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	DesktopAnnouncementService,
	type DesktopAnnouncementSnapshot,
} from './DesktopAnnouncementService'

const session = {
	userId: 'user-1',
	accessToken: 'access-token',
	gatewayBaseUrl: 'https://gateway.example/',
}

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('DesktopAnnouncementService', () => {
	it('calls the default browser fetch with the global receiver', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async function (
			this: unknown,
		) {
			expect(this).toBe(globalThis)
			return Response.json({ announcements: [] })
		})
		const service = new DesktopAnnouncementService({
			watchSignal: () => ({ close: vi.fn() }),
		})

		await service.start(session, 'darwin', '0.1.0')

		expect(fetchSpy).toHaveBeenCalledOnce()
		expect(service.current()).toBeNull()
		service.stop()
	})

	it('calls the default browser timers with the global receiver', async () => {
		const receivers = new Map<string, unknown>()
		vi.spyOn(globalThis, 'setTimeout').mockImplementation(function (this: unknown) {
			receivers.set('setTimeout', this)
			return 1 as unknown as ReturnType<typeof setTimeout>
		})
		vi.spyOn(globalThis, 'clearTimeout').mockImplementation(function (this: unknown) {
			receivers.set('clearTimeout', this)
		})
		vi.spyOn(globalThis, 'setInterval').mockImplementation(function (this: unknown) {
			receivers.set('setInterval', this)
			return 2 as unknown as ReturnType<typeof setInterval>
		})
		vi.spyOn(globalThis, 'clearInterval').mockImplementation(function (this: unknown) {
			receivers.set('clearInterval', this)
		})
		const service = new DesktopAnnouncementService({
			fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ announcements: [] })),
			watchSignal: () => ({ close: vi.fn() }),
		})

		await service.start(session, 'darwin', '0.1.0')
		service.stop()

		expect(Object.fromEntries(receivers)).toEqual({
			setTimeout: globalThis,
			clearTimeout: globalThis,
			setInterval: globalThis,
			clearInterval: globalThis,
		})
	})

	it('orders important messages first, acknowledges them, and removes withdrawn messages on signal', async () => {
		let queue = [
			announcement('normal-new', 'normal', '2026-07-17T12:02:00.000Z'),
			announcement('important-new', 'important', '2026-07-17T12:03:00.000Z'),
			announcement('important-old', 'important', '2026-07-17T12:01:00.000Z'),
		]
		const signalCallbacks = new Map<
			string,
			{ onChange: (snapshot: unknown) => void; onError: (error: unknown) => void }
		>()
		const close = vi.fn()
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			const url = new URL(String(input))
			if (url.pathname.endsWith('/pending')) {
				expect(url.searchParams.get('platform')).toBe('darwin')
				expect(url.searchParams.get('version')).toBe('0.1.0')
				expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token')
				return Response.json({ announcements: queue })
			}
			if (url.pathname.endsWith('/announcement-ack')) {
				const body = JSON.parse(String(init?.body)) as { announcementId: string }
				queue = queue.filter((item) => item.id !== body.announcementId)
				return new Response(null, { status: 204 })
			}
			throw new Error(`Unexpected URL: ${url.toString()}`)
		})
		const service = new DesktopAnnouncementService({
			fetchImpl,
			watchSignal: (documentId, callbacks) => {
				signalCallbacks.set(documentId, callbacks)
				return { close }
			},
		})
		let snapshot: DesktopAnnouncementSnapshot | undefined
		service.subscribe((next) => {
			snapshot = next
		})

		await service.start(session, 'darwin', '0.1.0')
		expect(snapshot).toMatchObject({ current: { id: 'important-old' }, queueLength: 3 })
		expect(Array.from(signalCallbacks.keys())).toEqual([
			'global',
			`user:${createHash('sha256').update(session.userId).digest('hex')}`,
		])

		await service.acknowledge('important-old')
		expect(snapshot).toMatchObject({ current: { id: 'important-new' }, queueLength: 2 })
		queue = queue.filter((item) => item.id !== 'important-new')
		signalCallbacks
			.get(`user:${createHash('sha256').update(session.userId).digest('hex')}`)
			?.onChange({ docs: [{ revision: 1 }] })
		await vi.waitFor(() =>
			expect(snapshot).toMatchObject({ current: { id: 'normal-new' }, queueLength: 1 }),
		)

		queue = []
		signalCallbacks.get('global')?.onChange({ docs: [{ revision: 2 }] })
		await vi.waitFor(() => expect(snapshot).toMatchObject({ current: null, queueLength: 0 }))

		service.stop()
		expect(close).toHaveBeenCalledTimes(2)
		expect(snapshot).toMatchObject({ current: null, queueLength: 0 })
	})

	it('reconnects with exponential backoff and retains 15-minute polling as a fallback', async () => {
		vi.useFakeTimers()
		const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ announcements: [] }))
		const callbacks: Array<{
			onChange: (snapshot: unknown) => void
			onError: (error: unknown) => void
		}> = []
		const close = vi.fn()
		const watchSignal = vi.fn(
			(
				_documentId: string,
				nextCallbacks: {
					onChange: (snapshot: unknown) => void
					onError: (error: unknown) => void
				},
			) => {
				callbacks.push(nextCallbacks)
				return { close }
			},
		)
		const service = new DesktopAnnouncementService({ fetchImpl, watchSignal })
		await service.start(session, 'win32', '0.1.0')
		expect(fetchImpl).toHaveBeenCalledOnce()
		expect(watchSignal).toHaveBeenCalledTimes(2)

		callbacks[0].onError(new Error('watch offline'))
		await vi.advanceTimersByTimeAsync(999)
		expect(watchSignal).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(watchSignal).toHaveBeenCalledTimes(3)

		callbacks[2].onError(new Error('watch offline again'))
		await vi.advanceTimersByTimeAsync(1_999)
		expect(watchSignal).toHaveBeenCalledTimes(3)
		await vi.advanceTimersByTimeAsync(1)
		expect(watchSignal).toHaveBeenCalledTimes(4)

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		expect(fetchImpl.mock.calls.length).toBeGreaterThan(1)
		service.stop()
	})

	it('resumes immediately, coalesces repeated recovery intents, and follows a revision during fetch', async () => {
		vi.useFakeTimers()
		const callbacks = new Map<
			string,
			{ onChange: (snapshot: unknown) => void; onError: (error: unknown) => void }
		>()
		const watchSignal = vi.fn(
			(
				documentId: string,
				next: { onChange: (snapshot: unknown) => void; onError: (error: unknown) => void },
			) => {
				callbacks.set(documentId, next)
				return { close: vi.fn() }
			},
		)
		let completePending: ((response: Response) => void) | undefined
		const fetchImpl = vi.fn<typeof fetch>(
			async () =>
				new Promise<Response>((resolve) => {
					completePending = resolve
				}),
		)
		const service = new DesktopAnnouncementService({ fetchImpl, watchSignal })
		await service.resume()
		expect(fetchImpl).not.toHaveBeenCalled()
		const started = service.start(session, 'darwin', '0.1.0')
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
		completePending?.(Response.json({ announcements: [] }))
		await started

		callbacks.get('global')?.onError(new Error('offline'))
		const resumed = service.resume()
		void service.resume()
		void service.resume()
		expect(watchSignal).toHaveBeenCalledTimes(3)
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		completePending?.(Response.json({ announcements: [] }))
		await resumed
		expect(fetchImpl).toHaveBeenCalledTimes(2)

		const revisionRun = service.resume()
		expect(fetchImpl).toHaveBeenCalledTimes(3)
		callbacks.get('global')?.onChange({ docs: [{ revision: 2 }] })
		completePending?.(Response.json({ announcements: [] }))
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4))
		completePending?.(
			Response.json({ announcements: [announcement('new', 'normal', '2026-07-17T12:00:00.000Z')] }),
		)
		await revisionRun
		expect(service.current()?.id).toBe('new')
		service.stop()
	})

	it('keeps a successful ack removed when an older pending response arrives, and retries failed ack', async () => {
		let finishPending: ((response: Response) => void) | undefined
		let ackFails = true
		let pendingCalls = 0
		const item = announcement('message-1', 'normal', '2026-07-17T12:00:00.000Z')
		const fetchImpl = vi.fn<typeof fetch>(async (input) => {
			if (String(input).includes('/announcement-ack')) {
				return ackFails ? new Response(null, { status: 500 }) : new Response(null, { status: 204 })
			}
			pendingCalls += 1
			if (pendingCalls === 2) {
				return new Promise<Response>((resolve) => {
					finishPending = resolve
				})
			}
			return Response.json({ announcements: [item] })
		})
		const service = new DesktopAnnouncementService({
			fetchImpl,
			watchSignal: () => ({ close: vi.fn() }),
		})
		const observed: Array<string | null> = []
		service.subscribe((snapshot) => observed.push(snapshot.current?.id ?? null))
		await service.start(session, 'darwin', '0.1.0')
		void service.resume()
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
		await expect(service.acknowledge(item.id)).rejects.toThrow()
		expect(service.current()?.id).toBe(item.id)
		ackFails = false
		await service.acknowledge(item.id)
		expect(service.current()).toBeNull()
		observed.length = 0
		expect(finishPending).toBeDefined()
		finishPending?.(Response.json({ announcements: [item] }))
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(5))
		expect(service.current()).toBeNull()
		expect(observed).not.toContain(item.id)
		service.stop()
	})

	it('does not carry an acknowledged ID into another account session', async () => {
		const item = announcement('shared-id', 'normal', '2026-07-17T12:00:00.000Z')
		const fetchImpl = vi.fn<typeof fetch>(async (input) =>
			String(input).includes('/announcement-ack')
				? new Response(null, { status: 204 })
				: Response.json({ announcements: [item] }),
		)
		const service = new DesktopAnnouncementService({
			fetchImpl,
			watchSignal: () => ({ close: vi.fn() }),
		})
		await service.start(session, 'darwin', '0.1.0')
		await service.acknowledge(item.id)
		expect(service.current()).toBeNull()
		await service.start({ ...session, userId: 'user-2' }, 'darwin', '0.1.0')
		expect(service.current()?.id).toBe(item.id)
		service.stop()
	})

	it.each([
		['success', 'switch'],
		['failure', 'switch'],
		['network rejection', 'switch'],
		['success', 'stop'],
		['failure', 'stop'],
		['network rejection', 'stop'],
	] as const)('ignores stale ack %s after %s', async (result, transition) => {
		const item = announcement('shared-id', 'normal', '2026-07-17T12:00:00.000Z')
		let resolveAck!: (response: Response) => void
		let rejectAck!: (error: Error) => void
		const deferredAck = new Promise<Response>((resolve, reject) => {
			resolveAck = resolve
			rejectAck = reject
		})
		const fetchImpl = vi.fn<typeof fetch>(async (input) =>
			String(input).includes('/announcement-ack')
				? deferredAck
				: Response.json({ announcements: [item] }),
		)
		const service = new DesktopAnnouncementService({
			fetchImpl,
			watchSignal: () => ({ close: vi.fn() }),
		})
		await service.start(session, 'darwin', '0.1.0')
		const oldAck = service.acknowledge(item.id)
		if (transition === 'switch') {
			await service.start({ ...session, userId: 'user-2' }, 'darwin', '0.1.0')
		} else {
			service.stop()
		}
		if (result === 'network rejection') rejectAck(new Error('offline'))
		else resolveAck(new Response(null, { status: result === 'success' ? 204 : 500 }))
		await expect(oldAck).resolves.toBeUndefined()
		expect(service.current()?.id ?? null).toBe(transition === 'switch' ? item.id : null)
		service.stop()
	})

	it('ignores stale account watcher callbacks after switching users', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ announcements: [] }))
		const subscriptions: Array<{
			documentId: string
			callbacks: {
				onChange: (snapshot: unknown) => void
				onError: (error: unknown) => void
			}
		}> = []
		const watchSignal = vi.fn(
			(
				documentId: string,
				callbacks: {
					onChange: (snapshot: unknown) => void
					onError: (error: unknown) => void
				},
			) => {
				subscriptions.push({ documentId, callbacks })
				return { close: vi.fn() }
			},
		)
		const service = new DesktopAnnouncementService({ fetchImpl, watchSignal })

		await service.start(session, 'darwin', '0.1.0')
		const oldAccountSubscription = subscriptions[1]
		await service.start({ ...session, userId: 'user-2' }, 'darwin', '0.1.0')
		expect(fetchImpl).toHaveBeenCalledTimes(2)

		oldAccountSubscription.callbacks.onChange({ docs: [{ revision: 99 }] })
		oldAccountSubscription.callbacks.onError(new Error('stale watcher'))
		await Promise.resolve()
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		expect(watchSignal).toHaveBeenCalledTimes(4)

		subscriptions[3].callbacks.onChange({ docs: [{ revision: 1 }] })
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3))
		service.stop()
	})

	it('caps long expiry timers and reschedules until a 30-day announcement expires', async () => {
		vi.useFakeTimers()
		vi.setSystemTime('2026-07-01T00:00:00.000Z')
		const expiresAt = '2026-07-31T00:00:00.000Z'
		const setTimeoutSpy = vi.fn((callback: () => void, delay?: number) =>
			globalThis.setTimeout(callback, delay),
		)
		const setTimeoutImpl = setTimeoutSpy as unknown as typeof setTimeout
		const service = new DesktopAnnouncementService({
			fetchImpl: vi.fn<typeof fetch>(async () =>
				Response.json({
					announcements: [
						announcement('long-lived', 'normal', '2026-07-01T00:00:00.000Z', expiresAt),
					],
				}),
			),
			watchSignal: () => ({ close: vi.fn() }),
			setTimeoutImpl,
		})

		await service.start(session, 'darwin', '0.1.0')
		expect(service.current()).toMatchObject({ id: 'long-lived' })
		expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 2_147_483_647)).toBe(true)
		expect(
			setTimeoutSpy.mock.calls.every(
				([, delay]) => typeof delay !== 'number' || delay <= 2_147_483_647,
			),
		).toBe(true)

		await vi.advanceTimersByTimeAsync(2_147_483_647)
		expect(service.current()).toMatchObject({ id: 'long-lived' })
		await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000 - 2_147_483_647)
		expect(service.current()).toBeNull()
		service.stop()
	})

	it('immediately refills the ten-message window after an acknowledgement', async () => {
		let pending = Array.from({ length: 11 }, (_, index) =>
			announcement(
				`message-${index + 1}`,
				'normal',
				`2026-07-17T${String(index).padStart(2, '0')}:00:00.000Z`,
			),
		)
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			const url = new URL(String(input))
			if (url.pathname.endsWith('/pending')) {
				return Response.json({ announcements: pending.slice(0, 10) })
			}
			if (url.pathname.endsWith('/announcement-ack')) {
				const body = JSON.parse(String(init?.body)) as { announcementId: string }
				pending = pending.filter((item) => item.id !== body.announcementId)
				return new Response(null, { status: 204 })
			}
			throw new Error(`Unexpected URL: ${url.toString()}`)
		})
		const service = new DesktopAnnouncementService({
			fetchImpl,
			watchSignal: () => ({ close: vi.fn() }),
		})
		let snapshot: DesktopAnnouncementSnapshot | undefined
		service.subscribe((next) => (snapshot = next))

		await service.start(session, 'darwin', '0.1.0')
		expect(snapshot?.queueLength).toBe(10)
		await service.acknowledge('message-1')
		await vi.waitFor(() => expect(snapshot?.queueLength).toBe(10))
		expect(fetchImpl).toHaveBeenCalledTimes(3)
		service.stop()
	})

	it('refreshes an expired access token once and retries the authorized request', async () => {
		const refreshSession = vi.fn(async () => ({
			...session,
			accessToken: 'fresh-access-token',
			refreshToken: 'fresh-refresh-token',
		}))
		const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
			const authorization = new Headers(init?.headers).get('authorization')
			if (authorization === 'Bearer access-token') {
				return new Response(null, { status: 401 })
			}
			expect(authorization).toBe('Bearer fresh-access-token')
			return Response.json({
				announcements: [announcement('refreshed', 'normal', '2026-07-17T12:00:00.000Z')],
			})
		})
		const service = new DesktopAnnouncementService({
			fetchImpl,
			refreshSession,
			watchSignal: () => ({ close: vi.fn() }),
		})

		await service.start(session, 'darwin', '0.1.0')
		expect(service.current()).toMatchObject({ id: 'refreshed' })
		expect(refreshSession).toHaveBeenCalledOnce()
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		service.stop()
	})

	it('removes an announcement at its local expiry and treats an expired ack as complete', async () => {
		vi.useFakeTimers()
		let now = Date.parse('2026-07-17T12:00:00.000Z')
		const queue = [
			announcement(
				'expiring-important',
				'important',
				'2026-07-17T11:00:00.000Z',
				'2026-07-17T12:00:01.000Z',
			),
			announcement(
				'already-expired',
				'normal',
				'2026-07-17T10:00:00.000Z',
				'2026-07-17T11:59:59.000Z',
			),
			announcement(
				'withdrawn-before-ack',
				'normal',
				'2026-07-17T11:30:00.000Z',
				'2026-07-18T12:00:00.000Z',
			),
		]
		const fetchImpl = vi.fn<typeof fetch>(async (input) => {
			const url = new URL(String(input))
			if (url.pathname.endsWith('/pending')) return Response.json({ announcements: queue })
			if (url.pathname.endsWith('/announcement-ack')) {
				return Response.json({ message: 'announcement expired' }, { status: 404 })
			}
			throw new Error(`Unexpected URL: ${url.toString()}`)
		})
		const service = new DesktopAnnouncementService({
			fetchImpl,
			now: () => now,
			watchSignal: () => ({ close: vi.fn() }),
		})

		await service.start(session, 'darwin', '0.1.0')
		expect(service.current()).toMatchObject({ id: 'expiring-important' })
		now += 1_000
		await vi.advanceTimersByTimeAsync(1_000)
		expect(service.current()).toMatchObject({ id: 'withdrawn-before-ack' })

		await expect(service.acknowledge('withdrawn-before-ack')).resolves.toBeUndefined()
		expect(service.current()).toBeNull()
		service.stop()
	})
})

function announcement(
	id: string,
	importance: ClientAnnouncementView['importance'],
	publishedAt: string,
	expiresAt = '2099-12-31T23:59:59.000Z',
): ClientAnnouncementView {
	return {
		id,
		importance,
		title: `消息 ${id}`,
		body: '消息正文',
		publishedAt,
		expiresAt,
	}
}
