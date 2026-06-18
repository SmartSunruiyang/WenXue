/**
 * 超星「agent 端」RPC 客户端，与 {@link RemotePageController} 完全平行：
 * 活在 agent 域（扩展页 / 内容脚本），把对内容脚本适配层的调用打包成
 * `{ type:'CHAOXING_CONTROL', action, payload, targetTabId }` 经 service worker 转发到
 * 目标标签页，再把内容端的返回原样取回。仅做消息编排，无任何 DOM / LLM / 模糊匹配。
 *
 * 通道与 `PAGE_CONTROL` 同构但独立（见 `adapter.content.ts` 接收端 / background 路由），
 * 故无需改动通用的 `RemotePageController`。
 */

import type { ChaoxingControlAction } from './adapter.content'
import type { FillResult } from './fill'
import type { ChaoxingAnswer, ChaoxingQuestion } from './types'

const PREFIX = '[ChaoxingBridge]'

/** 经 service worker 发一条 `CHAOXING_CONTROL`；失败记录并返回 null（与 RemotePageController 同策略）。 */
function sendMessage(message: {
	type: 'CHAOXING_CONTROL'
	action: ChaoxingControlAction
	targetTabId: number
	payload?: unknown
}): Promise<any> {
	return chrome.runtime.sendMessage(message).catch((error) => {
		console.error(PREFIX, message.action, error)
		return null
	})
}

/**
 * 超星答题内容脚本的类型化遥控器。给定一个 `targetTabId`，四个方法分别对应适配层的
 * 四个动作。读题与回填是两次独立 RPC——不跨边界传 DOM 引用，靠 `q${i}` 序号在内容端
 * 重新配对（见 `adapter.content.ts`）。
 */
export class ChaoxingBridge {
	readonly targetTabId: number

	constructor(targetTabId: number) {
		this.targetTabId = targetTabId
	}

	/** 读题：返回当前页（含同源 iframe）所有题目，id 为 `q0, q1, …`。 */
	async extractQuestions(): Promise<ChaoxingQuestion[]> {
		const res = await sendMessage({
			type: 'CHAOXING_CONTROL',
			action: 'extract_questions',
			targetTabId: this.targetTabId,
		})
		return (res as ChaoxingQuestion[] | null) ?? []
	}

	/** 回填：按 `questionId === 'q'+i` 把答案写回第 i 个题目，返回逐题结果。 */
	async fillAnswers(answers: ChaoxingAnswer[]): Promise<FillResult[]> {
		const res = await sendMessage({
			type: 'CHAOXING_CONTROL',
			action: 'fill_answers',
			targetTabId: this.targetTabId,
			payload: answers,
		})
		return (res as FillResult[] | null) ?? []
	}

	/** 翻到下一题：点到返回 true，无按钮返回 false。 */
	async gotoNextPage(): Promise<boolean> {
		const res = await sendMessage({
			type: 'CHAOXING_CONTROL',
			action: 'goto_next_page',
			targetTabId: this.targetTabId,
		})
		return res === true
	}

	/** 探测人脸识别 / 疑似自定义字体反爬两类中断。 */
	async probeInterrupts(): Promise<{ faceRecognition: boolean; suspiciousFont: boolean }> {
		const res = await sendMessage({
			type: 'CHAOXING_CONTROL',
			action: 'probe_interrupts',
			targetTabId: this.targetTabId,
		})
		return (
			(res as { faceRecognition: boolean; suspiciousFont: boolean } | null) ?? {
				faceRecognition: false,
				suspiciousFont: false,
			}
		)
	}
}
