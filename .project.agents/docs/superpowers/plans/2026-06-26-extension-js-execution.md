# execute_javascript 全覆盖增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [../specs/2026-06-26-extension-js-execution-design.md](../specs/2026-06-26-extension-js-execution-design.md)

**Goal:** 把 `execute_javascript` 增强为 DevTools-Console 式万能执行器——默认启用、结构化返回、可选 `world`（isolated/main）与 `frame_id`，并新增 `list_frames`，覆盖动态 DOM、同源/跨域 iframe、页面运行时变量。

**Architecture:** 主 Agent 单循环经 MacroTool 调用工具；工具调 `pageController.executeJavascript(script,{world,frameId})`。extension 侧 `RemotePageController` 把 `world` 放进 payload、`frameId` 放进消息路由维度，经 background `chrome.tabs.sendMessage(tabId,msg,{frameId})` 投递到目标 frame 的 content script；content script 按 world 分发：isolated 走现有 `PageController` eval，main 走新建的 main-world executor（postMessage 桥接 eval）。frame 发现经 `chrome.webNavigation.getAllFrames`。

**Tech Stack:** TypeScript, WXT (MV3), zod/v4, vitest, Chrome `runtime`/`tabs`/`webNavigation` APIs。

## Global Constraints

- pnpm monorepo；Node 22 LTS + pnpm 9。
- vendor 改动（`@page-agent/core`、`@page-agent/page-controller`）属本地补丁：`pnpm -r test` 必须保持绿；每处改动配套回归测试；偏离记入 `UPSTREAM.md`（不变量 I5）。
- 文档同步与代码改动在**同一个 commit**：加/改功能 → `PRD.md`；加模块/依赖 → `ARCHITECTURE.md`；权限/安全 → `TECH-INFRA.md`（SELF_CONSTRAINTS §B3）。
- 错误处理仅在系统边界；**工具内可恢复错误一律 `return` 文本字符串，不 `throw`**（throw 会被主循环当 task error 中断，PageAgentCore.ts:452）。
- 禁止 `Manager`/`Helper`/`Util`/`Common`/`Misc`/`Tools` 等空语义新模块名（§B1）；命名用动词+名词。
- zod 一律 `import * as z from 'zod/v4'`。
- 工具 `execute` 返回 `string`。
- commit 用 conventional commits 前缀，正文末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 测试 mock chrome API 用 `vi.stubGlobal('chrome', {...})`，`afterEach(() => vi.unstubAllGlobals())`。
- 完成后按 §B6 写执行日志（Task 8）。

---

### Task 1: 结构化结果序列化 `serializeResult`（page-controller, vendor）

修掉 `execute_javascript` 返回 `[object Object]` 的 bug，并供 main-world executor 复用。

**Files:**
- Create: `packages/page-controller/src/serializeResult.ts`
- Test: `packages/page-controller/src/serializeResult.test.ts`
- Modify: `packages/page-controller/src/PageController.ts:381-389`（`executeJavascript` 返回值）
- Modify: `packages/page-controller/src/PageController.ts`（在 `export * from './actions'` 旁导出）

**Interfaces:**
- Produces: `serializeResult(value: unknown): string`

- [ ] **Step 1: 写失败测试**

`packages/page-controller/src/serializeResult.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { serializeResult } from './serializeResult'

describe('serializeResult', () => {
	it('passes strings through and stringifies primitives', () => {
		expect(serializeResult('hi')).toBe('hi')
		expect(serializeResult(42)).toBe('42')
		expect(serializeResult(true)).toBe('true')
		expect(serializeResult(undefined)).toBe('undefined')
		expect(serializeResult(null)).toBe('null')
	})

	it('JSON-stringifies objects and arrays (no [object Object])', () => {
		expect(serializeResult({ a: 1 })).toContain('"a": 1')
		expect(serializeResult([{ name: 'x' }])).toContain('"name": "x"')
	})

	it('handles circular references without throwing', () => {
		const o: any = { a: 1 }
		o.self = o
		expect(serializeResult(o)).toContain('[Circular]')
	})

	it('renders functions and DOM nodes as summaries', () => {
		expect(serializeResult({ fn: () => 1 })).toContain('[Function]')
		const el = document.createElement('div')
		el.id = 'main'
		el.className = 'a b'
		expect(serializeResult({ el })).toContain('<div#main.a.b>')
	})

	it('formats Error as name: message', () => {
		expect(serializeResult(new TypeError('boom'))).toBe('TypeError: boom')
	})

	it('truncates beyond 8KB and annotates length', () => {
		const out = serializeResult('x'.repeat(9000))
		expect(out).toMatch(/…\(truncated, 9000 chars\)$/)
		expect(out.length).toBeLessThan(8300)
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @page-agent/page-controller test -- serializeResult`
Expected: FAIL（`serializeResult` 未定义 / 模块不存在）

- [ ] **Step 3: 实现**

`packages/page-controller/src/serializeResult.ts`:
```ts
const MAX_LEN = 8192

/** Turn an arbitrary JS execution result into a readable, bounded string for the LLM. */
export function serializeResult(value: unknown): string {
	let text: string
	if (value === undefined) text = 'undefined'
	else if (value === null) text = 'null'
	else if (typeof value === 'string') text = value
	else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
		text = String(value)
	else if (value instanceof Error) text = `${value.name}: ${value.message}`
	else text = safeStringify(value)

	return text.length > MAX_LEN
		? `${text.slice(0, MAX_LEN)}…(truncated, ${text.length} chars)`
		: text
}

function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>()
	try {
		return (
			JSON.stringify(
				value,
				(_key, val) => {
					if (typeof val === 'function') return '[Function]'
					if (typeof Node !== 'undefined' && val instanceof Node) return describeNode(val)
					if (typeof val === 'object' && val !== null) {
						if (seen.has(val)) return '[Circular]'
						seen.add(val)
					}
					return val
				},
				2,
			) ?? String(value)
		)
	} catch (error) {
		return `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`
	}
}

function describeNode(node: Node): string {
	if (node instanceof Element) {
		const id = node.id ? `#${node.id}` : ''
		const cls =
			typeof node.className === 'string' && node.className.trim()
				? `.${node.className.trim().split(/\s+/).join('.')}`
				: ''
		return `<${node.tagName.toLowerCase()}${id}${cls}>`
	}
	return `[${node.nodeName}]`
}
```

In `packages/page-controller/src/PageController.ts`, change `executeJavascript` (line ~386-389) result line and import:
```ts
// near top imports
import { serializeResult } from './serializeResult'

// inside executeJavascript success branch
return {
	success: true,
	message: `✅ Executed JavaScript. Result: ${serializeResult(result)}`,
}
```
And export it alongside actions (bottom of file, next to `export * from './actions'`):
```ts
export { serializeResult } from './serializeResult'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @page-agent/page-controller test -- serializeResult`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add packages/page-controller/src/serializeResult.ts packages/page-controller/src/serializeResult.test.ts packages/page-controller/src/PageController.ts
git commit -m "$(printf 'fix(page-controller): structured serializeResult for executeJavascript\n\nReplaces template-string interpolation that produced [object Object].\nExported for reuse by the main-world executor.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: core 工具 schema + gate 默认开（@page-agent/core, vendor）

`execute_javascript` 加 `world`/`frame_id` 参数、改 gate 为默认启用、重写描述。

**Files:**
- Modify: `packages/core/src/tools/index.ts:212-225`（`execute_javascript` 定义）
- Modify: `packages/core/src/PageAgentCore.ts:157-159`（gate）
- Test: `packages/core/src/PageAgentCore.test.ts`（gate 行为）

**Interfaces:**
- Consumes: `PageController.executeJavascript(script, opts?)`（Task 3 在 extension 侧实现；core 侧 `PageController` 类型 Task 3 Step 调整为接受可选 opts）
- Produces: 工具 `execute_javascript`，inputSchema `{ script: string; world: 'isolated'|'main'; frame_id?: number }`

- [ ] **Step 1: 写失败测试**（gate 默认开）

Append to `packages/core/src/PageAgentCore.test.ts`:
```ts
describe('execute_javascript gate', () => {
	const baseConfig = {
		baseURL: 'http://x', model: 'm', apiKey: 'k',
		pageController: {} as any,
	}

	it('is enabled by default (no experimentalScriptExecutionTool)', () => {
		const agent = new PageAgentCore(baseConfig as any)
		expect(agent.tools.has('execute_javascript')).toBe(true)
	})

	it('is removed only when explicitly disabled', () => {
		const agent = new PageAgentCore({ ...baseConfig, experimentalScriptExecutionTool: false } as any)
		expect(agent.tools.has('execute_javascript')).toBe(false)
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @page-agent/core test -- PageAgentCore`
Expected: FAIL（默认态当前会删除 execute_javascript，第一个用例失败）

- [ ] **Step 3: 实现**

`packages/core/src/PageAgentCore.ts:157-159` 改为：
```ts
		if (this.config.experimentalScriptExecutionTool === false) {
			this.tools.delete('execute_javascript')
		}
```

`packages/core/src/tools/index.ts` 替换 `execute_javascript` 定义：
```ts
tools.set(
	'execute_javascript',
	tool({
		description:
			'Execute JavaScript in the current tab like a DevTools console and return the (structured) result. ' +
			'Use it to read content the simplified DOM tree misses: dynamically rendered nodes, iframe contents, etc. ' +
			'world: "isolated" (default) reads the live DOM incl. same-origin iframes via contentDocument; ' +
			'"main" runs in the page JS runtime (globals/framework state) but may be blocked by the page CSP. ' +
			'frame_id: target a specific frame (call list_frames first to discover ids); omit for the top frame. ' +
			'Supports async/await. Do NOT write synchronous infinite loops — the timeout cannot interrupt them.',
		inputSchema: z.object({
			script: z.string(),
			world: z.enum(['isolated', 'main']).default('isolated'),
			frame_id: z.int().min(0).optional(),
		}),
		execute: async function (this: PageAgentCore, input) {
			const result = await this.pageController.executeJavascript(input.script, {
				world: input.world,
				frameId: input.frame_id,
			})
			return result.message
		},
	}),
)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @page-agent/core test -- PageAgentCore`
Expected: PASS（含原有用例与新增 2 个）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/index.ts packages/core/src/PageAgentCore.ts packages/core/src/PageAgentCore.test.ts
git commit -m "$(printf 'feat(core): execute_javascript world/frame_id params, default-on\n\nAdds world + frame_id to the tool schema and flips the gate so the tool\nis enabled unless experimentalScriptExecutionTool is explicitly false.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: RemotePageController — world/frameId 透传 + listFrames（extension）

**Files:**
- Modify: `apps/extension/src/agent/RemotePageController.ts`（`sendMessage` 类型、`executeJavascript`、`remoteCallDomAction`、新增 `listFrames` + `FrameInfo`）
- Modify: `packages/page-controller/src/PageController.ts:381`（`executeJavascript` 形参加可选 opts，类型对齐）
- Test: `apps/extension/src/agent/RemotePageController.test.ts`（消息格式 + listFrames）

**Interfaces:**
- Consumes: background `list_frames` handler（Task 4）；`{ frameId }` 路由（Task 4）
- Produces:
  - `RemotePageController.executeJavascript(script: string, opts?: { world?: 'isolated'|'main'; frameId?: number }): Promise<{success:boolean;message:string}>`
  - `RemotePageController.listFrames(): Promise<FrameInfo[]>`
  - `export interface FrameInfo { frameId: number; url: string; origin: string; sameOriginWithTop: boolean; parentFrameId: number }`

- [ ] **Step 1: 写失败测试**

Append to `apps/extension/src/agent/RemotePageController.test.ts`:
```ts
describe('RemotePageController js execution routing', () => {
	afterEach(() => vi.unstubAllGlobals())

	function stubChrome(sendMessage: ReturnType<typeof vi.fn>) {
		vi.stubGlobal('chrome', {
			runtime: { sendMessage },
			storage: { local: { set: vi.fn(async () => {}) } },
		})
	}

	it('puts world in payload and frameId on the message', async () => {
		const sendMessage = vi.fn(async () => ({ success: true, message: 'ok' }))
		stubChrome(sendMessage)
		const tabs = { currentTabId: 5, getTabInfo: async () => ({ url: 'https://a.com', title: '' }) }
		const c = new RemotePageController(tabs as unknown as TabsController)

		await c.executeJavascript('return 1', { world: 'main', frameId: 9 })

		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'PAGE_CONTROL',
				action: 'execute_javascript',
				targetTabId: 5,
				frameId: 9,
				payload: ['return 1', { world: 'main' }],
			}),
		)
	})

	it('listFrames returns [] when no current tab', async () => {
		stubChrome(vi.fn())
		const c = new RemotePageController({ currentTabId: null } as unknown as TabsController)
		expect(await c.listFrames()).toEqual([])
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F extension test -- RemotePageController`
Expected: FAIL（`executeJavascript` 不接受 opts / 未带 frameId；`listFrames` 不存在）

- [ ] **Step 3: 实现**

In `apps/extension/src/agent/RemotePageController.ts`:

Extend `sendMessage` message type with optional `frameId`:
```ts
function sendMessage(message: {
	type: 'PAGE_CONTROL'
	action: string
	targetTabId: number
	frameId?: number
	payload?: any
}): Promise<any> {
	return chrome.runtime.sendMessage(message).catch((error) => {
		console.error(PREFIX, message.action, error)
		return null
	})
}
```

Replace `executeJavascript` and `remoteCallDomAction`, add `listFrames`:
```ts
	async executeJavascript(
		script: string,
		opts?: { world?: 'isolated' | 'main'; frameId?: number },
	): Promise<DomActionReturn> {
		return this.remoteCallDomAction(
			'execute_javascript',
			[script, { world: opts?.world ?? 'isolated' }],
			opts?.frameId,
		)
	}

	async listFrames(): Promise<FrameInfo[]> {
		if (!this.currentTabId) return []
		const frames = await sendMessage({
			type: 'PAGE_CONTROL',
			action: 'list_frames',
			targetTabId: this.currentTabId,
		})
		return Array.isArray(frames) ? frames : []
	}

	private async remoteCallDomAction(
		action: string,
		payload: any[],
		frameId?: number,
	): Promise<DomActionReturn> {
		if (!this.currentTabId) {
			return { success: false, message: 'RemotePageController not initialized.' }
		}
		if (!isContentScriptAllowed(await this.getCurrentUrl())) {
			return {
				success: false,
				message:
					'Operation not allowed on this page. Use open_new_tab to navigate to a web page first.',
			}
		}
		return sendMessage({
			type: 'PAGE_CONTROL',
			action,
			targetTabId: this.currentTabId,
			frameId,
			payload,
		})
	}
```

Add the exported type (near `DomActionReturn`):
```ts
export interface FrameInfo {
	frameId: number
	url: string
	origin: string
	sameOriginWithTop: boolean
	parentFrameId: number
}
```

In `packages/page-controller/src/PageController.ts`, align the signature (opts ignored here — isolated eval already runs in the target frame; main world is split in the content script):
```ts
	async executeJavascript(
		script: string,
		_opts?: { world?: 'isolated' | 'main'; frameId?: number },
	): Promise<ActionResult> {
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F extension test -- RemotePageController` 然后 `pnpm -F @page-agent/page-controller test`
Expected: PASS（新增 2 用例 + 原 mask 用例；page-controller 仍绿）

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/agent/RemotePageController.ts apps/extension/src/agent/RemotePageController.test.ts packages/page-controller/src/PageController.ts
git commit -m "$(printf 'feat(ext): RemotePageController world/frameId passthrough + listFrames\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: background — frameId 路由 + list_frames（webNavigation）+ manifest 权限（extension）

**Files:**
- Modify: `apps/extension/src/agent/RemotePageController.background.ts`（`frameId` 透传 + `list_frames` 分支）
- Modify: `apps/extension/wxt.config.js:48`（`permissions` 加 `webNavigation`）
- Test: `apps/extension/src/agent/RemotePageController.background.test.ts`（新建）

**Interfaces:**
- Consumes: `chrome.webNavigation.getAllFrames`, `chrome.tabs.sendMessage(tabId, msg, { frameId })`
- Produces: `list_frames` 响应 `FrameInfo[]`；DOM action 消息按 `frameId` 投递

- [ ] **Step 1: 写失败测试**

`apps/extension/src/agent/RemotePageController.background.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handlePageControlMessage } from './RemotePageController.background'

afterEach(() => vi.unstubAllGlobals())

describe('handlePageControlMessage frame routing', () => {
	it('forwards frameId to chrome.tabs.sendMessage', async () => {
		const sendMessage = vi.fn(async () => ({ success: true, message: 'ok' }))
		vi.stubGlobal('chrome', { tabs: { sendMessage } })
		const respond = vi.fn()

		handlePageControlMessage(
			{ type: 'PAGE_CONTROL', action: 'execute_javascript', payload: ['x', {}], targetTabId: 3, frameId: 7 } as any,
			{} as any,
			respond,
		)
		await new Promise((r) => setTimeout(r, 0))

		expect(sendMessage).toHaveBeenCalledWith(
			3,
			{ type: 'PAGE_CONTROL', action: 'execute_javascript', payload: ['x', {}] },
			{ frameId: 7 },
		)
	})

	it('defaults to the top frame (frameId 0) when no frameId given', async () => {
		const sendMessage = vi.fn(async () => ({ success: true, message: 'ok' }))
		vi.stubGlobal('chrome', { tabs: { sendMessage } })
		const respond = vi.fn()

		handlePageControlMessage(
			{ type: 'PAGE_CONTROL', action: 'click_element', payload: [1], targetTabId: 3 } as any,
			{} as any,
			respond,
		)
		await new Promise((r) => setTimeout(r, 0))

		expect(sendMessage).toHaveBeenCalledWith(
			3,
			{ type: 'PAGE_CONTROL', action: 'click_element', payload: [1] },
			{ frameId: 0 },
		)
	})

	it('answers list_frames via webNavigation with sameOriginWithTop', async () => {
		vi.stubGlobal('chrome', {
			webNavigation: {
				getAllFrames: vi.fn(async () => [
					{ frameId: 0, parentFrameId: -1, url: 'https://top.com/a' },
					{ frameId: 7, parentFrameId: 0, url: 'https://other.com/b' },
				]),
			},
		})
		const respond = vi.fn()

		handlePageControlMessage(
			{ type: 'PAGE_CONTROL', action: 'list_frames', payload: undefined, targetTabId: 3 } as any,
			{} as any,
			respond,
		)
		await new Promise((r) => setTimeout(r, 0))

		expect(respond).toHaveBeenCalledWith([
			{ frameId: 0, url: 'https://top.com/a', origin: 'https://top.com', sameOriginWithTop: true, parentFrameId: -1 },
			{ frameId: 7, url: 'https://other.com/b', origin: 'https://other.com', sameOriginWithTop: false, parentFrameId: 0 },
		])
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F extension test -- RemotePageController.background`
Expected: FAIL（无 `frameId` 透传 / 无 `list_frames` 分支）

- [ ] **Step 3: 实现**

Rewrite `apps/extension/src/agent/RemotePageController.background.ts`:
```ts
export function handlePageControlMessage(
	message: { type: 'PAGE_CONTROL'; action: string; payload: any; targetTabId: number; frameId?: number },
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
): true | undefined {
	const PREFIX = '[RemotePageController.background]'
	const { action, payload, targetTabId, frameId } = message

	if (action === 'get_my_tab_id') {
		sendResponse({ tabId: sender.tab?.id || null })
		return
	}

	if (action === 'list_frames') {
		chrome.webNavigation
			.getAllFrames({ tabId: targetTabId })
			.then((frames) => {
				const list = frames ?? []
				const topOrigin = originOf(list.find((f) => f.frameId === 0)?.url)
				sendResponse(
					list.map((f) => {
						const origin = originOf(f.url)
						return {
							frameId: f.frameId,
							url: f.url,
							origin,
							sameOriginWithTop: origin !== '' && origin === topOrigin,
							parentFrameId: f.parentFrameId,
						}
					}),
				)
			})
			.catch((error) => {
				console.error(PREFIX, error)
				sendResponse([])
			})
		return true
	}

	// Default to the top frame (0). With allFrames injection (Task 5) every frame
	// has a listener, so omitting frameId would broadcast to ALL frames and corrupt
	// click/input/get_browser_state. frame_id from execute_javascript overrides this.
	chrome.tabs
		.sendMessage(targetTabId, { type: 'PAGE_CONTROL', action, payload }, { frameId: frameId ?? 0 })
		.then((result) => sendResponse(result))
		.catch((error) => {
			console.error(PREFIX, error)
			sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) })
		})

	return true
}

function originOf(url: string | undefined): string {
	if (!url) return ''
	try {
		return new URL(url).origin
	} catch {
		return ''
	}
}
```

In `apps/extension/wxt.config.js:48`:
```js
		permissions: ['tabs', 'tabGroups', 'sidePanel', 'storage', 'alarms', 'webNavigation'],
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F extension test -- RemotePageController.background`
Expected: PASS（2 用例）

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/agent/RemotePageController.background.ts apps/extension/src/agent/RemotePageController.background.test.ts apps/extension/wxt.config.js
git commit -m "$(printf 'feat(ext): background frameId routing + list_frames via webNavigation\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: content script — allFrames 注入 + top-frame guard + world 分发（extension）

**Files:**
- Modify: `apps/extension/src/entrypoints/content.ts`（`allFrames: true` + top-frame guard）
- Modify: `apps/extension/src/agent/RemotePageController.content.ts`（`execute_javascript` 按 world 分发 + 超时）
- Test: `apps/extension/src/agent/RemotePageController.content.test.ts`（如已存在则追加）

**Interfaces:**
- Consumes: `executeInMainWorld(script): Promise<{success;message}>`（Task 6 提供；本任务先以 stub 占位并在 Task 6 接通）
- Produces: content 端 `execute_javascript` 分支按 `payload[1].world` 路由

- [ ] **Step 1: 写失败测试**（world 分发选择）

`apps/extension/src/agent/RemotePageController.content.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'

import { dispatchJsExecution } from './RemotePageController.content'

describe('dispatchJsExecution', () => {
	it('routes isolated to the PageController eval', async () => {
		const pc = { executeJavascript: vi.fn(async () => ({ success: true, message: 'iso' })) }
		const main = vi.fn(async () => ({ success: true, message: 'main' }))
		const r = await dispatchJsExecution(pc as any, main, ['return 1', { world: 'isolated' }])
		expect(pc.executeJavascript).toHaveBeenCalledWith('return 1')
		expect(main).not.toHaveBeenCalled()
		expect(r.message).toBe('iso')
	})

	it('routes main to the main-world executor', async () => {
		const pc = { executeJavascript: vi.fn() }
		const main = vi.fn(async () => ({ success: true, message: 'main' }))
		const r = await dispatchJsExecution(pc as any, main, ['return 1', { world: 'main' }])
		expect(main).toHaveBeenCalledWith('return 1')
		expect(pc.executeJavascript).not.toHaveBeenCalled()
		expect(r.message).toBe('main')
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F extension test -- RemotePageController.content`
Expected: FAIL（`dispatchJsExecution` 未导出）

- [ ] **Step 3: 实现**

In `apps/extension/src/agent/RemotePageController.content.ts` export the pure dispatcher and a timeout helper, and wire the `execute_javascript` case to it:
```ts
type JsResult = { success: boolean; message: string }

export async function dispatchJsExecution(
	pc: { executeJavascript: (script: string) => Promise<JsResult> },
	runInMainWorld: (script: string) => Promise<JsResult>,
	payload: [string, { world?: 'isolated' | 'main' }] | undefined,
): Promise<JsResult> {
	const [script, opts] = payload ?? ['', {}]
	const world = opts?.world ?? 'isolated'
	const run = world === 'main' ? runInMainWorld(script) : pc.executeJavascript(script)
	return withTimeout(run, 10_000)
}

function withTimeout(p: Promise<JsResult>, ms: number): Promise<JsResult> {
	let timer: ReturnType<typeof setTimeout>
	const timeout = new Promise<JsResult>((resolve) => {
		timer = setTimeout(() => resolve({ success: false, message: `❌ 执行超时（${ms / 1000}s）` }), ms)
	})
	return Promise.race([p.finally(() => clearTimeout(timer)), timeout])
}
```
Replace the existing `case 'execute_javascript':` so it no longer goes through `pc[methodName](...payload)` but calls the dispatcher (keep the other cases as-is):
```ts
			case 'execute_javascript':
				dispatchJsExecution(pc, executeInMainWorld, payload)
					.then((result: any) => sendResponse(result))
					.catch((error: any) =>
						sendResponse({ success: false, message: `❌ ${error instanceof Error ? error.message : String(error)}` }),
					)
				break
```
> `executeInMainWorld` is added in Task 6. Until then, add a temporary stub `const executeInMainWorld = async (_s: string) => ({ success: false, message: 'main world not wired yet' })` at the top of `initPageController` so this task's build/tests pass; Task 6 replaces the stub.

In `apps/extension/src/entrypoints/content.ts`, add `allFrames` and guard non-DOM init to the top frame:
```ts
export default defineContentScript({
	matches: ['<all_urls>'],
	allFrames: true,
	runAt: 'document_end',

	main() {
		console.debug(`${DEBUG_PREFIX} Loaded on ${window.location.href}`)
		initPageController()

		// Agent singleton + Chaoxing adapter + page-facing API only belong on the top frame.
		if (window.top !== window) return

		initChaoxingAdapter()

		chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
			// ...unchanged body...
		})
	},
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F extension test -- RemotePageController.content`
Expected: PASS（2 分发用例）

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/entrypoints/content.ts apps/extension/src/agent/RemotePageController.content.ts apps/extension/src/agent/RemotePageController.content.test.ts
git commit -m "$(printf 'feat(ext): allFrames inject with top-frame guard + world dispatch\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: main-world executor + isolated↔main 桥接（extension, 运行时）

> 跨执行上下文 + postMessage 时序，单测只能覆盖纯逻辑；真实行为靠手动验证（Step 5）。

**Files:**
- Create: `apps/extension/src/entrypoints/main-world-executor.ts`（unlisted script）
- Modify: `apps/extension/wxt.config.js`（`web_accessible_resources` 加 `main-world-executor.js`）
- Modify: `apps/extension/src/agent/RemotePageController.content.ts`（`executeInMainWorld` 真正实现，替换 Task 5 的 stub）

**Interfaces:**
- Consumes: `serializeResult`（Task 1，main world 内序列化后经 postMessage 传 string）；WXT `injectScript`
- Produces: `executeInMainWorld(script: string): Promise<{success:boolean;message:string}>`；postMessage 协议 `PAGE_AGENT_EXEC_REQUEST`/`PAGE_AGENT_EXEC_RESPONSE`

- [ ] **Step 1: 实现 main-world executor**

`apps/extension/src/entrypoints/main-world-executor.ts`:
```ts
import { serializeResult } from '@page-agent/page-controller'

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
```

In `apps/extension/wxt.config.js`, register the resource:
```js
		web_accessible_resources: [
			{
				resources: ['main-world.js', 'main-world-executor.js'],
				matches: ['*://*/*'],
			},
		],
```

> **Bundle 隔离**：`serializeResult` 必须保持零运行时依赖（它已是纯函数）。若 `import { serializeResult } from '@page-agent/page-controller'` 把整个 `PageController`（含 mask 的 CSS 动态 import）拉进 main-world bundle，改用子路径导入——在 `packages/page-controller/package.json` 的 `exports` 增加 `"./serializeResult"` 指向该文件，再 `import { serializeResult } from '@page-agent/page-controller/serializeResult'`。

- [ ] **Step 2: 实现 isolated 侧桥接**（替换 Task 5 的 stub）

In `apps/extension/src/agent/RemotePageController.content.ts`, inside `initPageController` (so it closes over a per-frame injection flag):
```ts
	let mainWorldExecutorInjected = false
	let mainExecId = 0

	async function ensureMainWorldExecutor(): Promise<void> {
		if (mainWorldExecutorInjected) return
		mainWorldExecutorInjected = true
		await injectScript('/main-world-executor.js', { keepInDom: true })
	}

	async function executeInMainWorld(script: string): Promise<{ success: boolean; message: string }> {
		try {
			await ensureMainWorldExecutor()
		} catch (error) {
			return { success: false, message: `❌ 无法注入 main world executor: ${String(error)}` }
		}
		const id = ++mainExecId
		return new Promise((resolve) => {
			const onMessage = (e: MessageEvent) => {
				if (e.source !== window) return
				const d = e.data
				if (typeof d !== 'object' || d === null) return
				if (d.channel !== 'PAGE_AGENT_EXEC_RESPONSE' || d.id !== id) return
				window.removeEventListener('message', onMessage)
				resolve(
					d.ok
						? { success: true, message: `✅ Executed JavaScript (main world). Result: ${d.result}` }
						: { success: false, message: `❌ main world 执行失败（可能被页面 CSP 阻止）: ${d.error}` },
				)
			}
			window.addEventListener('message', onMessage)
			window.postMessage({ channel: 'PAGE_AGENT_EXEC_REQUEST', id, script }, '*')
		})
	}
```
Add the WXT import at the top of the file (mirror how `content.ts` resolves `injectScript`; if `agent/` modules already use WXT auto-import, this explicit line may be unnecessary):
```ts
import { injectScript } from '#imports'
```
Remove the temporary stub added in Task 5.

- [ ] **Step 3: typecheck + 构建**

Run: `pnpm -F extension exec tsc --noEmit` 然后 `pnpm -F extension build`
Expected: 类型通过（忽略 memory 记录的 3 个预存 misc.test.ts 错误）；build 产出含 `main-world-executor.js`

- [ ] **Step 4: 全包回归**

Run: `pnpm -F @page-agent/core test && pnpm -F @page-agent/page-controller test && pnpm -F extension test`
Expected: 全绿

- [ ] **Step 5: 手动验证**（加载未打包扩展）

加载 `apps/extension` 构建产物，打开 side panel，对以下页面发任务让 agent 用 `execute_javascript`：
1. **main world 变量**：在任意定义了全局变量的页面，`world:'main'` 执行 `return Object.keys(window).filter(k=>k.startsWith('__')).slice(0,20)` —— 能读到页面全局；isolated 下读不到。
2. **严格 CSP 页面**（如 github.com）：`world:'main'` 应返回"❌ main world 执行失败（可能被页面 CSP 阻止）"，且 agent 能据此改用 isolated。
3. **超时**：`while(true){}` 应在 ~10s 后返回超时（注意：同步死循环仍会卡满 10s，符合已知边界）。

- [ ] **Step 6: 提交**

```bash
git add apps/extension/src/entrypoints/main-world-executor.ts apps/extension/wxt.config.js apps/extension/src/agent/RemotePageController.content.ts
git commit -m "$(printf 'feat(ext): main-world JS executor with postMessage bridge\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: `list_frames` 工具 + MultiPageAgent 注入（extension）

**Files:**
- Create: `apps/extension/src/agent/frameTools.ts`
- Modify: `apps/extension/src/agent/MultiPageAgent.ts:98`（`customTools` 合并）
- Test: `apps/extension/src/agent/frameTools.test.ts`

**Interfaces:**
- Consumes: `RemotePageController.listFrames()`（Task 3）
- Produces: `createFrameTools(pageController): Record<string, FrameTool>`，含 `list_frames`

- [ ] **Step 1: 写失败测试**

`apps/extension/src/agent/frameTools.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'

import { createFrameTools } from './frameTools'

describe('list_frames tool', () => {
	it('formats frames with origin and same/cross-origin marker', async () => {
		const pageController = {
			listFrames: vi.fn(async () => [
				{ frameId: 0, url: 'https://top.com/', origin: 'https://top.com', sameOriginWithTop: true, parentFrameId: -1 },
				{ frameId: 7, url: 'https://x.com/i', origin: 'https://x.com', sameOriginWithTop: false, parentFrameId: 0 },
			]),
		}
		const tools = createFrameTools(pageController as any)
		const out = await tools.list_frames.execute({})
		expect(out).toContain('frameId=0')
		expect(out).toContain('(same-origin)')
		expect(out).toContain('frameId=7')
		expect(out).toContain('(cross-origin)')
	})

	it('reports when there are no frames', async () => {
		const tools = createFrameTools({ listFrames: async () => [] } as any)
		expect(await tools.list_frames.execute({})).toBe('No frames found.')
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F extension test -- frameTools`
Expected: FAIL（`createFrameTools` 不存在）

- [ ] **Step 3: 实现**

`apps/extension/src/agent/frameTools.ts`:
```ts
import * as z from 'zod/v4'

import type { RemotePageController } from './RemotePageController'

/** Tool definition compatible with PageAgentCore customTools */
interface FrameTool {
	description: string
	inputSchema: z.ZodType
	execute: (input: unknown) => Promise<string>
}

export function createFrameTools(pageController: RemotePageController): Record<string, FrameTool> {
	return {
		list_frames: {
			description:
				'List all frames (including cross-origin iframes) in the current tab: frameId, url, origin, ' +
				'and whether each is same-origin with the top frame. Pass a frameId to execute_javascript ' +
				'(frame_id) to run code inside that specific frame — the way to reach cross-origin iframe content.',
			inputSchema: z.object({}),
			execute: async () => {
				const frames = await pageController.listFrames()
				if (!frames.length) return 'No frames found.'
				return frames
					.map(
						(f) =>
							`frameId=${f.frameId} ${f.sameOriginWithTop ? '(same-origin)' : '(cross-origin)'} parent=${f.parentFrameId} ${f.url}`,
					)
					.join('\n')
			},
		},
	}
}
```

In `apps/extension/src/agent/MultiPageAgent.ts`, import and merge (line ~11 import, line ~98 customTools):
```ts
import { createFrameTools } from './frameTools'
// ...
		const customTools = {
			...createTabTools(tabsController),
			...createFrameTools(pageController),
			...chaoxingTools,
		}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F extension test -- frameTools`
Expected: PASS（2 用例）

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/agent/frameTools.ts apps/extension/src/agent/frameTools.test.ts apps/extension/src/agent/MultiPageAgent.ts
git commit -m "$(printf 'feat(ext): list_frames tool wired into MultiPageAgent\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: 上游文档同步 + 执行日志

按 SELF_CONSTRAINTS §B3/§B6。本任务不含代码，只更新文档；与前序代码同分支收尾。

**Files:**
- Modify: `.project.agents/docs/context/PRD.md`
- Modify: `.project.agents/docs/context/ARCHITECTURE.md`
- Modify: `.project.agents/docs/context/TECH-INFRA.md`
- Modify: `.project.agents/docs/context/UPSTREAM.md`
- Create: `.project.agents/log/2026-06-26-extension-js-execution.md`

- [ ] **Step 1: PRD.md**
  - §7.2（line ~167）：将"跨域 iframe 内容…无法被 DOM 文本化方案操作"改为"DOM 文本化方案不覆盖跨域 iframe；可经 `execute_javascript`（`world`/`frame_id` + `list_frames`）在目标 frame 内执行读取，但 `<iframe sandbox>` 与严格 CSP 页面仍受限"。
  - §3 Agent 循环动作（line ~79）：动作集追加"执行任意 JavaScript（isolated/main world、可指定 frame）"，并加一行安全说明：默认启用、可经 `experimentalScriptExecutionTool:false` 关闭。

- [ ] **Step 2: ARCHITECTURE.md**
  - `@page-agent/core`（L4，line ~173）职责补"`execute_javascript` 的 world/frame 参数"。
  - `@page-agent/page-controller`（L3，line ~167）职责补"JS 执行结果结构化序列化（`serializeResult`）"。
  - `ExtensionEntrypoints`（L6，line ~250）职责补"按 frameId 路由 PAGE_CONTROL、main-world JS 执行通道、`webNavigation` frame 发现、`list_frames` 工具"。
  - 依赖图（line ~290 区块）加 `ExtensionEntrypoints --> webNavigation["chrome.webNavigation"]`。

- [ ] **Step 3: TECH-INFRA.md**
  - 权限审计表（改造清单 #4，line ~171）新增一行：`webNavigation | frame 发现（list_frames），支撑跨 frame JS 执行 | 保留`。
  - 改造清单 #5（line ~172）追注：main-world executor 为独立 eval 通道，不启用 `window.PAGE_AGENT_EXT`。
  - 安全条目（line ~232 区域）补：`execute_javascript` 默认启用（保留 `experimentalScriptExecutionTool` 开关）的权衡说明。

- [ ] **Step 4: UPSTREAM.md** — 记录 vendor 偏离：`@page-agent/core`（execute_javascript schema + gate）、`@page-agent/page-controller`（serializeResult + executeJavascript 签名），均配套回归测试。

- [ ] **Step 5: 执行日志** — `.project.agents/log/2026-06-26-extension-js-execution.md`：按 log 模板写本特性的目标、改动模块、Task 1–8 的提交哈希列表、手动验证结论、已知边界（sandbox/CSP/同步死循环）、下一步。

- [ ] **Step 6: 最终回归 + 提交**

```bash
pnpm -F @page-agent/core test && pnpm -F @page-agent/page-controller test && pnpm -F extension test
git add .project.agents/docs/context/PRD.md .project.agents/docs/context/ARCHITECTURE.md .project.agents/docs/context/TECH-INFRA.md .project.agents/docs/context/UPSTREAM.md .project.agents/log/2026-06-26-extension-js-execution.md
git commit -m "$(printf 'docs(ext): sync PRD/ARCHITECTURE/TECH-INFRA/UPSTREAM + execution log\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 完成判定

- 三包测试全绿：`pnpm -F @page-agent/core test && pnpm -F @page-agent/page-controller test && pnpm -F extension test`。
- 手动验证清单（Task 6 Step 5 + spec §9）全部走过：同源 iframe、跨域 iframe（list_frames → frame_id）、main world 变量、严格 CSP 友好报错、`<iframe sandbox>` 如实失败。
- 上游文档与代码在同一分支同步（PRD/ARCHITECTURE/TECH-INFRA/UPSTREAM）。
- 执行日志含全部提交哈希。
