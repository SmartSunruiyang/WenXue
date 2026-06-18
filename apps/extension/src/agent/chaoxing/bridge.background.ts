/**
 * 超星 `CHAOXING_CONTROL` 的 background 路由，与 `handlePageControlMessage` 平行：
 * 把来自 agent 域（{@link ChaoxingBridge}）的消息按 `targetTabId` 转发给目标标签页的
 * 内容脚本适配层，再把结果回送。纯代理，无本地动作（不像 PAGE_CONTROL 有 `get_my_tab_id`）。
 */

import type { ChaoxingControlMessage } from './adapter.content'

export function handleChaoxingControlMessage(
	message: ChaoxingControlMessage,
	_sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
): true | undefined {
	const PREFIX = '[ChaoxingBridge.background]'

	const { action, payload, targetTabId } = message

	chrome.tabs
		.sendMessage(targetTabId, {
			type: 'CHAOXING_CONTROL',
			action,
			payload,
		})
		.then((result) => {
			sendResponse(result)
		})
		.catch((error) => {
			console.error(PREFIX, error)
			sendResponse({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			})
		})

	return true // async response
}
