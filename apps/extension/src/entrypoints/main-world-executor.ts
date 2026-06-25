import { serializeResult } from '@page-agent/page-controller/serializeResult'

export default defineUnlistedScript(() => {
	window.addEventListener('message', async (e) => {
		if (e.source !== window) return
		const data = e.data
		if (typeof data !== 'object' || data === null) return
		if (data.channel !== 'PAGE_AGENT_EXEC_REQUEST') return

		const { id, script } = data
		try {
			const fn = eval(`(async () => { ${script} })`)
			const result = await fn()
			window.postMessage(
				{ channel: 'PAGE_AGENT_EXEC_RESPONSE', id, ok: true, result: serializeResult(result) },
				'*',
			)
		} catch (error) {
			window.postMessage(
				{ channel: 'PAGE_AGENT_EXEC_RESPONSE', id, ok: false, error: String(error) },
				'*',
			)
		}
	})
})
