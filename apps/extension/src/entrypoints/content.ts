import { initChaoxingAdapter } from '@/agent/chaoxing/adapter.content'
import { initPageController } from '@/agent/RemotePageController.content'

// import { DEMO_CONFIG } from '@/agent/constants'

const DEBUG_PREFIX = '[Content]'

export default defineContentScript({
	matches: ['<all_urls>'],
	runAt: 'document_end',

	main() {
		console.debug(`${DEBUG_PREFIX} Loaded on ${window.location.href}`)
		initPageController()
		initChaoxingAdapter()

		// if auth token matches, expose agent to page
		chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
			// extension side token.
			// @note this is isolated world. it is safe to assume user script cannot access it
			const extToken = result.PageAgentExtUserAuthToken
			if (!extToken) return

			// page side token
			const pageToken = localStorage.getItem('PageAgentExtUserAuthToken')
			if (!pageToken) return

			if (pageToken !== extToken) return

			console.log('[PageAgentExt]: Auth tokens match. Exposing agent to page.')

			// add isolated world script
			exposeAgentToPage().then(
				// add main-world script
				() => injectScript('/main-world.js'),
			)
		})
	},
})

async function exposeAgentToPage() {
	const { MultiPageAgent } = await import('@/agent/MultiPageAgent')
	console.log('[PageAgentExt]: MultiPageAgent loaded')

	/**
	 * singleton MultiPageAgent to handle requests from the page
	 */
	let multiPageAgent: InstanceType<typeof MultiPageAgent> | null = null
	let activeRequestId: unknown = null

	const postResponse = (action: string, payload?: unknown, error?: string) => {
		window.postMessage(
			{
				channel: 'PAGE_AGENT_EXT_RESPONSE',
				id: activeRequestId,
				action,
				...(payload === undefined ? {} : { payload }),
				...(error === undefined ? {} : { error }),
			},
			'*',
		)
	}

	window.addEventListener('message', async (e) => {
		if (e.source !== window) return

		const data = e.data
		if (typeof data !== 'object' || data === null) return
		if (data.channel !== 'PAGE_AGENT_EXT_REQUEST') return

		const { action, payload, id } = data

		switch (action) {
			case 'execute': {
				// singleton check
				if (
					multiPageAgent &&
					['running', 'waiting_for_user', 'paused'].includes(multiPageAgent.status)
				) {
					activeRequestId = id
					postResponse(
						'execute_result',
						undefined,
						'Agent already has an active task. Stop it or resume the paused task first.',
					)
					return
				}

				try {
					activeRequestId = id
					const { task, config } = payload
					const { systemInstruction, ...agentConfig } = config

					// Dispose old instance before creating new one
					multiPageAgent?.dispose()

					multiPageAgent = new MultiPageAgent({
						...agentConfig,
						instructions: systemInstruction ? { system: systemInstruction } : undefined,
					})

					// events

					multiPageAgent.addEventListener('statuschange', (event) => {
						if (!multiPageAgent) return
						postResponse('status_change_event', multiPageAgent.status)
					})

					multiPageAgent.addEventListener('activity', (event) => {
						if (!multiPageAgent) return
						postResponse('activity_event', (event as CustomEvent).detail)
					})

					multiPageAgent.addEventListener('historychange', (event) => {
						if (!multiPageAgent) return
						postResponse('history_change_event', multiPageAgent.history)
					})

					// result

					const result = await multiPageAgent.execute(task)

					postResponse('execute_result', result)
				} catch (error) {
					postResponse('execute_result', undefined, (error as Error).message)
				}

				break
			}

			case 'resume': {
				activeRequestId = id
				if (!multiPageAgent || multiPageAgent.status !== 'paused') {
					postResponse('resume_result', undefined, 'No paused task to resume.')
					break
				}

				try {
					postResponse('resume_result', await multiPageAgent.resume())
				} catch (error) {
					postResponse('resume_result', undefined, (error as Error).message)
				}
				break
			}

			case 'stop': {
				multiPageAgent?.stop()
				break
			}

			default:
				console.warn(`${DEBUG_PREFIX} Unknown action from page:`, action)
				break
		}
	})
}
