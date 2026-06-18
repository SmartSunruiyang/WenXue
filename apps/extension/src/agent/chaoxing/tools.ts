/**
 * 超星学习通「agent 工具」(Spec §7)。
 *
 * 暴露单个 agent 工具 `chaoxing_solve`：在超星作业 / 考试页一次性「读全部题 → LLM 生成
 * 结构化答案 → 自动回填」，由 {@link solveChaoxing} 流水线完成，**不自动提交**。
 *
 * 与 `tabTools.ts` 同构(自带一个本地的工具接口而非耦合 core 内部类型)。工具被
 * PageAgentCore 以 `execute.bind(this)(input, { signal })` 调用，故第二参 ctx 携带
 * 取消信号；这里把它透传给流水线，让 LLM 请求可随任务取消而中止。
 */
import type { LLMConfig } from '@page-agent/llms'
import * as z from 'zod/v4'

import type { TabsController } from '../TabsController'
import { ChaoxingBridge } from './bridge'
import { solveChaoxing } from './solve'

/** 与 PageAgentCore customTools 兼容的工具形状(对齐 tabTools 的本地接口)。 */
interface ChaoxingTool {
	description: string
	inputSchema: z.ZodType
	execute: (input: unknown, ctx?: { signal?: AbortSignal }) => Promise<string>
}

export interface ChaoxingToolsDeps {
	tabsController: TabsController
	getModels: () => { text?: LLMConfig; vision?: LLMConfig }
}

/**
 * 构造超星工具集，绑定到一个 {@link TabsController} 与模型提供器。
 * 经 MultiPageAgent 的 customTools 注入。
 */
export function createChaoxingTools(deps: ChaoxingToolsDeps): Record<string, ChaoxingTool> {
	return {
		chaoxing_solve: {
			description:
				'在超星学习通(chaoxing.com)作业/考试页：读取全部题目→用 LLM 生成结构化答案→自动回填。不会自动提交，最终提交由用户完成。',
			inputSchema: z.object({
				scope: z
					.enum(['current_page', 'all_pages'])
					.default('all_pages')
					.describe('current_page 只做当前页；all_pages 自动翻页直至最后一页。'),
			}),
			execute: async (input: unknown, ctx?: { signal?: AbortSignal }) => {
				const tabId = deps.tabsController.currentTabId
				if (!tabId) return '❌ 没有可操作的标签页'

				const { scope } = input as { scope: 'current_page' | 'all_pages' }
				const bridge = new ChaoxingBridge(tabId)

				try {
					return await solveChaoxing(
						{ bridge, getModels: deps.getModels, signal: ctx?.signal },
						{ scope },
					)
				} catch (error) {
					return `❌ 解题失败：${error instanceof Error ? error.message : String(error)}`
				}
			},
		},
	}
}
