export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise
	signal.throwIfAborted()
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			cleanup()
			reject(signal.reason)
		}
		const cleanup = () => signal.removeEventListener('abort', onAbort)
		signal.addEventListener('abort', onAbort, { once: true })
		promise.then(
			(value) => {
				cleanup()
				resolve(value)
			},
			(error: unknown) => {
				cleanup()
				reject(error)
			},
		)
	})
}

export function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason)
			return
		}
		const onAbort = () => {
			clearTimeout(timer)
			cleanup()
			reject(signal?.reason)
		}
		const cleanup = () => signal?.removeEventListener('abort', onAbort)
		const timer = setTimeout(() => {
			cleanup()
			resolve()
		}, ms)
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}
