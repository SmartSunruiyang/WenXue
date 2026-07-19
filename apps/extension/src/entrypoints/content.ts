import { initQuestionSolverAdapterHost } from '@/agent/questionSolver/adapterHost.content'
import { initPageController } from '@/agent/RemotePageController.content'

const DEBUG_PREFIX = '[Content]'

export default defineContentScript({
	matches: ['<all_urls>'],
	allFrames: true,
	matchOriginAsFallback: true,
	runAt: 'document_end',

	main() {
		console.debug(`${DEBUG_PREFIX} Loaded on ${window.location.href}`)
		initPageController()
		initQuestionSolverAdapterHost()
	},
})
