/**
 * 超星学习通旧工具的代码级兼容 facade。
 *
 * 新 Agent 不再注册 `chaoxing_solve`；唯一公开入口是 visual_observe.question_solver。
 * 仍直接导入本模块的旧调用方可通过 `runLegacyChaoxingSolve` 转发到统一内核，且
 * 始终**不自动提交**。本模块不再导出任何 PageAgent tool schema。
 */
import type { LLMConfig } from '@page-agent/llms'
import type { TabsController } from '../TabsController'
import { QuestionSolverOrchestrator } from '../questionSolver/orchestrator'

export interface ChaoxingToolsDeps {
	tabsController: TabsController
	getModels: () => { text?: LLMConfig; vision?: LLMConfig }
}

/** @deprecated 新代码应调用 visual_observe 的 question_solver capability。 */
export async function runLegacyChaoxingSolve(
	deps: ChaoxingToolsDeps,
	scope: 'current_page' | 'all_pages' = 'all_pages',
	signal?: AbortSignal,
): Promise<string> {
	try {
		const solver = new QuestionSolverOrchestrator({
			getLease: () => deps.tabsController.getQuestionSolverLease(),
			getModels: deps.getModels,
		})
		const result = await solver.execute(
			{ action: 'fill', scope },
			signal ?? new AbortController().signal,
		)
		if (result.platform !== 'chaoxing' && result.platform !== 'unknown') {
			return '❌ 当前页面不是超星学习通题目环境'
		}
		return JSON.stringify(result, null, 2)
	} catch (error) {
		return `❌ 解题失败：${error instanceof Error ? error.message : String(error)}`
	}
}
