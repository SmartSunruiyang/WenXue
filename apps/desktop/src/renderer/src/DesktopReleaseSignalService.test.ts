import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopReleaseSignalService } from './DesktopReleaseSignalService'

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('DesktopReleaseSignalService', () => {
	it('checks only after revision changes while the main process owns periodic checks', async () => {
		const checkForUpdates = vi.fn(async () => undefined)
		let callbacks:
			| { onChange: (snapshot: unknown) => void; onError: (error: unknown) => void }
			| undefined
		const close = vi.fn()
		const watchSignal = vi.fn(
			(
				documentId: string,
				nextCallbacks: {
					onChange: (snapshot: unknown) => void
					onError: (error: unknown) => void
				},
			) => {
				expect(documentId).toBe('electron:stable')
				callbacks = nextCallbacks
				return { close }
			},
		)
		const service = new DesktopReleaseSignalService({
			checkForUpdates,
			watchSignal,
			random: () => 0,
		})

		service.start('electron', 'stable')
		callbacks?.onChange({ docs: [{ revision: 10 }] })
		expect(checkForUpdates).not.toHaveBeenCalled()
		callbacks?.onChange({ docs: [{ revision: 10 }] })
		expect(checkForUpdates).not.toHaveBeenCalled()
		callbacks?.onChange({ docs: [{ revision: 11 }] })
		await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledWith('signal'))

		service.stop()
		expect(close).toHaveBeenCalledOnce()
	})

	it('ignores queued callbacks from a watcher replaced during a channel switch', async () => {
		const checkForUpdates = vi.fn(async () => undefined)
		const callbacks: Array<{
			onChange: (snapshot: unknown) => void
			onError: (error: unknown) => void
		}> = []
		const closes = [vi.fn(), vi.fn()]
		const watchSignal = vi.fn(
			(
				_documentId: string,
				nextCallbacks: {
					onChange: (snapshot: unknown) => void
					onError: (error: unknown) => void
				},
			) => {
				callbacks.push(nextCallbacks)
				return { close: closes[callbacks.length - 1] }
			},
		)
		const service = new DesktopReleaseSignalService({
			checkForUpdates,
			watchSignal,
			random: () => 0,
		})

		service.start('electron', 'stable')
		service.start('electron', 'beta')
		callbacks[0].onChange({ docs: [{ revision: 1 }] })
		callbacks[0].onError(new Error('stale watcher'))
		callbacks[1].onChange({ docs: [{ revision: 4 }] })
		callbacks[1].onChange({ docs: [{ revision: 5 }] })

		await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce())
		expect(checkForUpdates).toHaveBeenCalledWith('signal')
		expect(closes[0]).toHaveBeenCalledOnce()
		expect(closes[1]).not.toHaveBeenCalled()
		service.stop()
	})

	it('jitters and coalesces a burst of release revisions', async () => {
		vi.useFakeTimers()
		const checkForUpdates = vi.fn(async () => undefined)
		let callbacks:
			| { onChange: (snapshot: unknown) => void; onError: (error: unknown) => void }
			| undefined
		const service = new DesktopReleaseSignalService({
			checkForUpdates,
			random: () => 0.5,
			watchSignal: (_documentId, nextCallbacks) => {
				callbacks = nextCallbacks
				return { close: vi.fn() }
			},
		})

		service.start('electron', 'stable')
		callbacks?.onChange({ docs: [{ revision: 1 }] })
		callbacks?.onChange({ docs: [{ revision: 2 }] })
		callbacks?.onChange({ docs: [{ revision: 3 }] })
		await vi.advanceTimersByTimeAsync(29_999)
		expect(checkForUpdates).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(checkForUpdates).toHaveBeenCalledOnce()
		service.stop()
	})
})
