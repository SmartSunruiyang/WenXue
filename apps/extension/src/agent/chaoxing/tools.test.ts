import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TabsController } from '../TabsController'
import { QuestionSolverOrchestrator } from '../questionSolver/orchestrator'
import { runLegacyChaoxingSolve } from './tools'

describe('legacy Chaoxing solver facade', () => {
	afterEach(() => vi.restoreAllMocks())

	it('forwards to the unified capability and preserves manual final submission', async () => {
		const execute = vi.spyOn(QuestionSolverOrchestrator.prototype, 'execute').mockResolvedValue({
			platform: 'chaoxing',
			finalSubmissionPerformed: false,
		} as never)
		const signal = new AbortController().signal

		const output = await runLegacyChaoxingSolve(deps(), 'current_page', signal)

		expect(execute).toHaveBeenCalledWith({ action: 'fill', scope: 'current_page' }, signal)
		expect(JSON.parse(output)).toMatchObject({
			platform: 'chaoxing',
			finalSubmissionPerformed: false,
		})
	})

	it('refuses to present a non-Chaoxing result as a legacy success', async () => {
		vi.spyOn(QuestionSolverOrchestrator.prototype, 'execute').mockResolvedValue({
			platform: 'zhs',
			finalSubmissionPerformed: false,
		} as never)

		await expect(runLegacyChaoxingSolve(deps())).resolves.toContain('不是超星学习通')
	})
})

function deps() {
	return {
		tabsController: {} as TabsController,
		getModels: () => ({}),
	}
}
