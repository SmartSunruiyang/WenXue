# 问学扩展可观测性 / 持久化日志 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

关联 spec：[../specs/2026-06-21-extension-observability-design.md](../specs/2026-06-21-extension-observability-design.md)

**Goal:** 给问学插件域一套统一、持久化、可在设置里查看与导出的日志系统，覆盖所有插件操作，默认本地保留 3 天（可配）+ 体积上限，自动清理。

**Architecture:** background 独占 IndexedDB 日志库、是唯一写入者；通用 `logger` 在 background 直写、在其它上下文经 `LOG_APPEND` 消息批量送达；查询/导出/清空经 `LOG_QUERY/EXPORT/CLEAR` 消息；LLM 请求/响应正文经作用域 fetch 拦截器在 agent 上下文捕获；写入前一律脱敏（API Key 永不入库）。

**Tech Stack:** TypeScript、WXT（MV3）、React、`idb`、Zod（已有）、Vitest + `fake-indexeddb`（测试）、`chrome.alarms`。

## Global Constraints

- 运行/测试：Node 22 + pnpm 9；测试用 `pnpm -F extension test`（**不要** `pnpm -r test`，desktop 缺 Electron 会假性失败）；`pnpm -F extension build` 是 esbuild **不做类型检查**，类型校验单独跑 `pnpm -F extension exec tsc --noEmit`。
- **不得修改 `packages/*`**（vendored 上游快照，不变量 I5）；所有埋点只在 `apps/extension`。
- **API Key / Authorization / Bearer 永不入库**（不变量 I2）——脱敏是硬要求。
- 不破插件域↔桌面域零运行时通信（I3）：本期只做插件域。
- 命名禁用 `Manager/Helper/Util/Common/Misc/Tools`（SELF_CONSTRAINTS B1）。
- 新增模块/依赖/通道 → 同 commit 更新 `ARCHITECTURE.md`；新功能 → 同 commit 更新 `PRD.md`（B3）。
- TDD：每个逻辑单元先写失败测试；频繁提交；日志失败绝不影响主流程（旁路、吞错）。
- 日志系统自身的 fetch/写库**不得再触发日志**（防递归）。

---

## 文件结构

新增（均在 `apps/extension/src/`）：
- `lib/logTypes.ts` — `LogLevel`/`LogSource`/`LogContext`/`LogEntry`/`LogQueryFilter`/`LogMessage` 类型（被多处消费，单独成文件避免循环依赖）。
- `lib/logRedaction.ts` — `redact(data)`：密钥剥离 + base64/超长截断。
- `lib/logStore.ts` — background idb 读写：`appendBatch/query/exportAll/clear/purge`。
- `lib/logger.ts` — 通用 emit + 批量 + 路由。
- `lib/log.background.ts` — `handleLogControlMessage`。
- `lib/loggingFetch.ts` — `installLlmFetchLogging`。
- `components/LogViewer.tsx` — 设置内查看器。

修改：
- `lib/db.ts`（v1→v2，加 `logs` 库 + `by-ts` 索引）
- `entrypoints/background.ts`（注册 `LOG_*` + 启动清理 + `chrome.alarms`）
- `lib/settingsConfig.ts` + `agent/useAgent.ts`（`ExtConfig` 加 `logRetentionDays`/`logMaxEntries`）
- `components/SettingsForm.tsx`（加 `logs` 节）
- `lib/i18n.tsx`（文案键）
- `wxt.config.js`（`permissions` 加 `alarms`）
- 埋点：`entrypoints/sidepanel/main.tsx` + `entrypoints/hub/main.tsx`（装拦截器）、`agent/MultiPageAgent.ts`（钩子接 logger）、`agent/chaoxing/{solve,images,adapter.content}.ts`、`agent/{TabsController,RemotePageController}.ts`（接 logger）

---

## Task 1: 日志类型 + 脱敏（纯函数，TDD）

**Files:**
- Create: `apps/extension/src/lib/logTypes.ts`
- Create: `apps/extension/src/lib/logRedaction.ts`
- Test: `apps/extension/src/lib/logRedaction.test.ts`

**Interfaces:**
- Produces: `LogLevel`、`LogSource`、`LogContext`、`LogEntry`、`LogQueryFilter`、`LogControlMessage`；`redact(value: unknown): unknown`、`REDACTED = '***'`。

- [ ] **Step 1: 写类型文件** `logTypes.ts`

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'agent' | 'llm' | 'tabs' | 'page' | 'chaoxing' | 'config' | 'system'
export type LogContext = 'background' | 'sidepanel' | 'newtab' | 'hub' | 'content'

export interface LogEntry {
	id: number
	ts: number
	level: LogLevel
	source: LogSource
	context: LogContext
	message: string
	data?: unknown
}

/** 落库前的条目（id 由 background 分配）。 */
export type LogDraft = Omit<LogEntry, 'id'>

export interface LogQueryFilter {
	level?: LogLevel[]
	source?: LogSource[]
	sinceTs?: number
	untilTs?: number
	text?: string
	limit?: number
	beforeId?: number
}

export type LogControlMessage =
	| { type: 'LOG_APPEND'; entries: LogDraft[] }
	| { type: 'LOG_QUERY'; filter: LogQueryFilter }
	| { type: 'LOG_EXPORT'; filter?: LogQueryFilter }
	| { type: 'LOG_CLEAR' }
```

- [ ] **Step 2: 写失败测试** `logRedaction.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { redact } from './logRedaction'

describe('redact', () => {
	it('strips apiKey / authorization / bearer values', () => {
		const out = redact({
			apiKey: 'sk-secret', api_key: 'sk-2',
			headers: { Authorization: 'Bearer sk-xyz' },
			nested: { token: 'Bearer abc' },
		}) as any
		expect(JSON.stringify(out)).not.toContain('sk-secret')
		expect(JSON.stringify(out)).not.toContain('sk-2')
		expect(JSON.stringify(out)).not.toContain('sk-xyz')
		expect(out.apiKey).toBe('***')
		expect(out.headers.Authorization).toBe('***')
	})

	it('truncates data: URIs and very long strings to a length marker', () => {
		const long = 'data:image/png;base64,' + 'A'.repeat(5000)
		const out = redact({ url: long }) as any
		expect(out.url).toMatch(/^data:image\/png;base64,…\[\d+字符\]$/)
		expect(out.url.length).toBeLessThan(80)
	})

	it('handles arrays and is non-mutating', () => {
		const input = { messages: [{ content: 'x' }] }
		const out = redact(input) as any
		expect(out.messages[0].content).toBe('x')
		expect(input.messages[0].content).toBe('x') // original untouched
	})
})
```

- [ ] **Step 3: 运行确认失败** — `pnpm -F extension exec vitest run src/lib/logRedaction.test.ts` → FAIL（`redact` 未定义）。

- [ ] **Step 4: 实现** `logRedaction.ts`

```ts
export const REDACTED = '***'
const MAX_STRING = 2000
const SECRET_KEY_RE = /^(api[_-]?key|authorization|token|secret|bearer)$/i

function redactString(s: string): string {
	if (/^Bearer\s+/i.test(s)) return REDACTED
	if (s.startsWith('data:')) {
		const head = s.slice(0, s.indexOf(',') + 1) || s.slice(0, 24)
		return `${head}…[${s.length}字符]`
	}
	if (s.length > MAX_STRING) return `${s.slice(0, MAX_STRING)}…[${s.length}字符]`
	return s
}

export function redact(value: unknown): unknown {
	if (typeof value === 'string') return redactString(value)
	if (Array.isArray(value)) return value.map(redact)
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value)) {
			out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redact(v)
		}
		return out
	}
	return value
}
```

- [ ] **Step 5: 运行确认通过** — 同命令 → PASS。
- [ ] **Step 6: Commit** — `feat(ext): add log types + secret redaction`

---

## Task 2: IndexedDB v2 — 新增 `logs` 库

**Files:**
- Modify: `apps/extension/src/lib/db.ts`
- Test: `apps/extension/src/lib/db.test.ts`（若无则新建）

**Interfaces:**
- Produces: `db` 升级到 v2，含对象库 `logs`（`keyPath:'id'`、`autoIncrement`）+ 索引 `by-ts`；导出 `getDB()`（已有）继续可用。

- [ ] **Step 1: 写失败测试**（`fake-indexeddb`）

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { getDB } from './db'

describe('db v2', () => {
	it('has both sessions and logs stores with by-ts index', async () => {
		const db = await getDB()
		expect(db.objectStoreNames.contains('sessions')).toBe(true)
		expect(db.objectStoreNames.contains('logs')).toBe(true)
		const tx = db.transaction('logs')
		expect([...tx.store.indexNames]).toContain('by-ts')
	})
})
```

- [ ] **Step 2: 运行确认失败** — `pnpm -F extension exec vitest run src/lib/db.test.ts`（需 `fake-indexeddb` 依赖；若缺 `pnpm -F extension add -D fake-indexeddb`）→ FAIL。
- [ ] **Step 3: 实现** —— `db.ts`：`DB_VERSION = 2`；schema 接口加 `logs`；`upgrade(db, oldVersion)` 中 `if (oldVersion < 2) { const s = db.createObjectStore('logs', { keyPath:'id', autoIncrement:true }); s.createIndex('by-ts','ts') }`，保留 v1 的 `sessions` 创建（`if (oldVersion < 1)`）。

```ts
interface PageAgentDB extends DBSchema {
	sessions: { key: string; value: SessionRecord; indexes: { 'by-created': number } }
	logs: { key: number; value: import('./logTypes').LogEntry; indexes: { 'by-ts': number } }
}
// DB_VERSION = 2
// upgrade(db, oldVersion) {
//   if (oldVersion < 1) { /* 既有 sessions 创建 */ }
//   if (oldVersion < 2) { const s = db.createObjectStore('logs',{keyPath:'id',autoIncrement:true}); s.createIndex('by-ts','ts') }
// }
```

- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** — `feat(ext): bump idb to v2 with logs store`

---

## Task 3: logStore 读写（append / query / exportAll / clear）

**Files:**
- Create: `apps/extension/src/lib/logStore.ts`
- Test: `apps/extension/src/lib/logStore.test.ts`

**Interfaces:**
- Consumes: `getDB()`（Task 2）、`LogEntry`/`LogDraft`/`LogQueryFilter`（Task 1）。
- Produces: `appendBatch(entries: LogDraft[]): Promise<void>`、`query(filter: LogQueryFilter): Promise<LogEntry[]>`、`exportAll(filter?: LogQueryFilter): Promise<LogEntry[]>`、`clear(): Promise<void>`。

- [ ] **Step 1: 写失败测试** — 覆盖：appendBatch 后 query 全量倒序；按 `level`/`source`/`text`/时间窗筛选；`limit`/`beforeId` 分页；`clear` 清空。（用 `fake-indexeddb/auto`，每个测试前 `await clear()`。）

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { appendBatch, clear, query } from './logStore'

const draft = (over = {}) => ({ ts: 1000, level: 'info', source: 'system', context: 'background', message: 'm', ...over }) as any

beforeEach(async () => { await clear() })

describe('logStore', () => {
	it('appends and queries newest-first', async () => {
		await appendBatch([draft({ ts: 1 }), draft({ ts: 2 })])
		const rows = await query({})
		expect(rows.map((r) => r.ts)).toEqual([2, 1])
	})
	it('filters by level and source and text', async () => {
		await appendBatch([
			draft({ level: 'error', source: 'llm', message: 'boom' }),
			draft({ level: 'info', source: 'tabs', message: 'ok' }),
		])
		expect((await query({ level: ['error'] })).length).toBe(1)
		expect((await query({ source: ['tabs'] }))[0].message).toBe('ok')
		expect((await query({ text: 'boo' }))[0].message).toBe('boom')
	})
	it('respects time window and limit', async () => {
		await appendBatch([draft({ ts: 10 }), draft({ ts: 20 }), draft({ ts: 30 })])
		expect((await query({ sinceTs: 15, untilTs: 25 })).map((r) => r.ts)).toEqual([20])
		expect((await query({ limit: 2 })).length).toBe(2)
	})
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** `logStore.ts` —— 用 `by-ts` 索引取一段时间窗（或全量游标倒序），在内存里按 level/source/text 过滤，应用 `beforeId`/`limit`。append 用一个读写事务批量 `add`。

```ts
import type { LogDraft, LogEntry, LogQueryFilter } from './logTypes'
import { getDB } from './db'

export async function appendBatch(entries: LogDraft[]): Promise<void> {
	if (entries.length === 0) return
	const db = await getDB()
	const tx = db.transaction('logs', 'readwrite')
	await Promise.all(entries.map((e) => tx.store.add(e as LogEntry)))
	await tx.done
}

function matches(e: LogEntry, f: LogQueryFilter): boolean {
	if (f.level && !f.level.includes(e.level)) return false
	if (f.source && !f.source.includes(e.source)) return false
	if (f.sinceTs !== undefined && e.ts < f.sinceTs) return false
	if (f.untilTs !== undefined && e.ts > f.untilTs) return false
	if (f.text && !e.message.toLowerCase().includes(f.text.toLowerCase())) return false
	if (f.beforeId !== undefined && e.id >= f.beforeId) return false
	return true
}

export async function query(filter: LogQueryFilter): Promise<LogEntry[]> {
	const db = await getDB()
	const out: LogEntry[] = []
	let cursor = await db.transaction('logs').store.index('by-ts').openCursor(null, 'prev')
	const limit = filter.limit ?? 500
	while (cursor && out.length < limit) {
		if (matches(cursor.value, filter)) out.push(cursor.value)
		cursor = await cursor.continue()
	}
	return out
}

export async function exportAll(filter: LogQueryFilter = {}): Promise<LogEntry[]> {
	return query({ ...filter, limit: Number.MAX_SAFE_INTEGER })
}

export async function clear(): Promise<void> {
	const db = await getDB()
	await db.clear('logs')
}
```

- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** — `feat(ext): log store append/query/clear`

---

## Task 4: logStore.purge（时间 + 体积清理）

**Files:**
- Modify: `apps/extension/src/lib/logStore.ts`
- Test: `apps/extension/src/lib/logStore.test.ts`（追加）

**Interfaces:**
- Produces: `purge(opts: { retentionDays: number; maxEntries: number; now: number }): Promise<{ removed: number }>`（`now` 注入便于测试）。

- [ ] **Step 1: 写失败测试** — 过期（`ts < now - days`）删除；超量按最旧优先删至 `maxEntries`。

```ts
import { appendBatch, clear, purge, query } from './logStore'
const DAY = 86_400_000
it('purges entries older than retentionDays', async () => {
	await clear()
	const now = 10 * DAY
	await appendBatch([draft({ ts: now - 4 * DAY }), draft({ ts: now - 1 * DAY })])
	const { removed } = await purge({ retentionDays: 3, maxEntries: 9999, now })
	expect(removed).toBe(1)
	expect((await query({})).length).toBe(1)
})
it('trims oldest beyond maxEntries', async () => {
	await clear()
	const now = 10 * DAY
	await appendBatch([draft({ ts: now - 1 }), draft({ ts: now - 2 }), draft({ ts: now - 3 })])
	await purge({ retentionDays: 9999, maxEntries: 2, now })
	const rows = await query({})
	expect(rows.length).toBe(2)
	expect(rows.map((r) => r.ts)).toEqual([now - 1, now - 2]) // newest kept
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** `purge` —— 一个 readwrite 事务：用 `by-ts` 删 `ts < now - retentionDays*DAY`；再统计剩余条数，超出 `maxEntries` 时从最旧（`by-ts` 正序）删差额。返回 `{removed}`。

```ts
const DAY_MS = 86_400_000
export async function purge(opts: { retentionDays: number; maxEntries: number; now: number }): Promise<{ removed: number }> {
	const db = await getDB()
	const tx = db.transaction('logs', 'readwrite')
	const idx = tx.store.index('by-ts')
	let removed = 0
	const cutoff = opts.now - opts.retentionDays * DAY_MS
	let c = await idx.openCursor(IDBKeyRange.upperBound(cutoff, true))
	while (c) { await c.delete(); removed++; c = await c.continue() }
	const remaining = await tx.store.count()
	let over = remaining - opts.maxEntries
	if (over > 0) {
		let c2 = await idx.openCursor(null, 'next') // oldest first
		while (c2 && over > 0) { await c2.delete(); removed++; over--; c2 = await c2.continue() }
	}
	await tx.done
	return { removed }
}
```

- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** — `feat(ext): log retention purge (time + size)`

---

## Task 5: background 消息处理 `log.background.ts`

**Files:**
- Create: `apps/extension/src/lib/log.background.ts`
- Test: `apps/extension/src/lib/log.background.test.ts`

**Interfaces:**
- Consumes: `logStore` 全部导出、`LogControlMessage`。
- Produces: `handleLogControlMessage(message, sender, sendResponse): true | undefined`（异步分支返回 `true` 保通道开放，与 `bridge.background` 同构）。

- [ ] **Step 1: 写失败测试** — `LOG_APPEND` 调 appendBatch；`LOG_QUERY` 回 `query` 结果；`LOG_CLEAR` 调 clear；未知 type 返回 `undefined`。用 `vi.mock('./logStore', …)` 注入 spy。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** —— `switch(message.type)` 调对应 store 方法，`.then(sendResponse, (e)=>sendResponse({error:String(e)}))`，返回 `true`；非 `LOG_*` 返回 `undefined`。**注意：所有写库/查询绝不经 logger，避免递归。**
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** — `feat(ext): LOG_* message handlers`

---

## Task 6: 通用 `logger`（emit + 批量 + 路由）

**Files:**
- Create: `apps/extension/src/lib/logger.ts`
- Test: `apps/extension/src/lib/logger.test.ts`

**Interfaces:**
- Consumes: `redact`（Task 1）、`appendBatch`（直写分支）、`chrome.runtime.sendMessage`（消息分支）、`LogDraft`/`LogSource`。
- Produces: `logger.debug/info/warn/error(source, message, data?)`；`configureLogger({ context, sink, flushSize?, flushMs? })`（`sink: 'direct' | 'message'`，便于测试与按上下文设定）。

- [ ] **Step 1: 写失败测试** — 攒够 `flushSize` 触发刷新；超时刷新（用 vitest fake timers）；每条都先 `redact(data)`；`direct` 分支调 `appendBatch`、`message` 分支调 `sendMessage({type:'LOG_APPEND'})`；写库/发消息抛错被吞、不抛给调用方。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** —— 模块内 buffer + 定时器；`emit(level,source,message,data)` push `{ts:Date.now(), level, source, context, message, data:redact(data)}`，到阈值/超时/`pagehide` 刷新；`flush()` 按 sink 直写或发消息，整体 try/catch 吞错。`configureLogger` 在各上下文入口调用一次（background→direct，其余→message）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** — `feat(ext): universal batched logger`

---

## Task 7: background 接线 + 定时清理

**Files:**
- Modify: `apps/extension/src/entrypoints/background.ts`
- Modify: `apps/extension/wxt.config.js`（`permissions` 加 `'alarms'`）

**Interfaces:**
- Consumes: `handleLogControlMessage`、`purge`、`configureLogger`。

- [ ] **Step 1:** `wxt.config.js` `permissions: ['tabs','tabGroups','sidePanel','storage','alarms']`。
- [ ] **Step 2:** `background.ts`：`onMessage` 链加 `else if (message.type?.startsWith('LOG_')) return handleLogControlMessage(...)`；启动时 `configureLogger({ context:'background', sink:'direct' })` 并 `purge(currentRetention)` 一次；`chrome.alarms.create('log-purge',{periodInMinutes:30})` + `chrome.alarms.onAlarm` 调 `purge`。保留天数/上限从 `chrome.storage.local` 读（缺省 3 / 5000）。
- [ ] **Step 3: 类型检查 + 构建冒烟** — `pnpm -F extension exec tsc --noEmit`（仅看 background/log* 无新错），`pnpm -F extension build` 成功。
- [ ] **Step 4: Commit** — `feat(ext): wire LOG_* dispatch + scheduled purge`

> 备选（见 spec §17）：若不想加 `alarms` 权限，可改为「启动清理 + append 后超量裁剪」，删去 alarms 步骤；二选一在执行时与用户确认。

---

## Task 8: 保留设置进配置

**Files:**
- Modify: `apps/extension/src/lib/settingsConfig.ts`、`apps/extension/src/agent/useAgent.ts`
- Test: `apps/extension/src/lib/settingsConfig.test.ts`（追加）

**Interfaces:**
- Produces: `ExtConfig.logRetentionDays?: number`、`ExtConfig.logMaxEntries?: number`；`buildSettingsConfig` 透传，缺省 3 / 5000。

- [ ] **Step 1: 写失败测试** — `buildSettingsConfig({logRetentionDays:7})` 保留 7；缺省回 3。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** — `ExtConfig` 加两字段；`buildSettingsConfig`/`settingsConfigKey` 纳入；`useAgent` 把两值写入 `chrome.storage.local`（供 background 读）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** — `feat(ext): log retention settings`

---

## Task 9: LLM fetch 拦截器 `loggingFetch.ts`

**Files:**
- Create: `apps/extension/src/lib/loggingFetch.ts`
- Test: `apps/extension/src/lib/loggingFetch.test.ts`

**Interfaces:**
- Consumes: `logger`、`redact`。
- Produces: `installLlmFetchLogging(opts?: { isLlmUrl?: (url: string) => boolean }): () => void`（返回卸载函数）。

- [ ] **Step 1: 写失败测试** — 注入 fake `globalThis.fetch`；命中 `…/chat/completions` 的调用记一条 `source:'llm'`（含 redacted 请求体、status、durationMs），返回原始响应不被消费破坏；非 LLM URL 不记、原样透传；fake timers 控 duration。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** — 保存原 `fetch`，替换为 wrapper：非命中直接 `orig(...)`；命中则读请求体（clone 或入参）→ `redact` → `orig` → 计时 → 若响应可读则 `clone()` 读 body（流式用 `tee`，组装文本）→ `logger.info('llm', …, {request,response,status,durationMs})` → 返回**原始** response。整段 try/catch，**失败必须仍返回真实响应**。卸载函数还原原 `fetch`。**wrapper 内部对 logger 的依赖不得再触发 fetch 日志**（logger 走 sendMessage，不经 fetch）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** — `feat(ext): scoped LLM fetch logging`

---

## Task 10: 埋点接线（agent / chaoxing / tabs / page + 安装拦截器）

**Files:**
- Modify: `entrypoints/sidepanel/main.tsx`、`entrypoints/hub/main.tsx`（`configureLogger({context:'sidepanel'|'hub', sink:'message'})` + `installLlmFetchLogging()`）
- Modify: `entrypoints/content.ts`（`configureLogger({context:'content', sink:'message'})`）
- Modify: `agent/MultiPageAgent.ts`（在 `onBeforeTask/onAfterTask/onAfterStep/onDispose` 调 `logger`，记 task 起止/步骤 action+reflection/接管/错误）
- Modify: `agent/chaoxing/solve.ts`（记每题路由 text/vision、needsReview 原因、汇总）、`agent/chaoxing/images.ts`（记图片内联成功/失败计数）、`agent/chaoxing/adapter.content.ts`（记 extract 题数/题型）
- Modify: `agent/TabsController.ts`、`agent/RemotePageController.ts`（把现有 `console.error/debug` 补一条 `logger`）

**Interfaces:**
- Consumes: `logger`、`configureLogger`、`installLlmFetchLogging`。

- [ ] **Step 1:** 各入口装 `configureLogger` + （agent 上下文）`installLlmFetchLogging()`。
- [ ] **Step 2:** 逐个埋点（保留既有 `console.*`，新增 `logger.*` 旁路；不改业务逻辑）。`solve.ts` 在 `answerQuestion`/`solvePage` 出入口记 `source:'chaoxing'`；`images.ts` 在 `resolveQuestionImages` 末记成功/失败数；`MultiPageAgent` 钩子内记 `source:'agent'`。
- [ ] **Step 3: 回归** — `pnpm -F extension test`（全绿，280+），`pnpm -F extension exec tsc --noEmit`（无新错）。注意：埋点不得改变任何现有测试的断言（纯旁路）。
- [ ] **Step 4: Commit** — `feat(ext): instrument agent/chaoxing/tabs with logger`

> 执行注意：先做一处埋点（如 `chaoxing/solve.ts`）跑通测试，再铺开，避免一次性大改难定位。

---

## Task 11: 查看器组件 `LogViewer.tsx`

**Files:**
- Create: `apps/extension/src/components/LogViewer.tsx`
- Modify: `apps/extension/src/lib/i18n.tsx`（加 `settingsSectionLogs`/`settingsSectionLogsDesc` + 查看器文案键，中英）
- Test: `apps/extension/src/components/LogViewer.test.ts`

**Interfaces:**
- Consumes: 经 `chrome.runtime.sendMessage` 发 `LOG_QUERY`/`LOG_EXPORT`/`LOG_CLEAR`；`useI18n`。
- Produces: `export function LogViewer(): JSX.Element`。

- [ ] **Step 1: 写失败测试** — 注入 fake `chrome.runtime.sendMessage` 回固定 entries；断言渲染出条目、级别筛选改变请求 filter、导出触发下载（spy `URL.createObjectURL`）。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** — 受控筛选状态（level 多选 / source 多选 / 关键词 / 时间）→ 防抖发 `LOG_QUERY` → 列表（时序倒序、点开看详情 `data`）；导出按钮发 `LOG_EXPORT` → `Blob` → `a[download]`；清空按钮二次确认发 `LOG_CLEAR`。数据多时分页（`beforeId` 取下一页）。不在组件里直连 idb（统一走消息）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** — `feat(ext): log viewer component`

---

## Task 12: 设置里挂上「日志」节

**Files:**
- Modify: `apps/extension/src/components/SettingsForm.tsx`
- Test: `apps/extension/src/entrypoints/sidepanel/App.test.ts` 或 `SettingsForm` 相关测试（追加冒烟）

**Interfaces:**
- Consumes: `LogViewer`、`SETTINGS_SECTIONS`。

- [ ] **Step 1:** `SETTINGS_SECTIONS` 加 `{ id:'logs', labelKey:'settingsSectionLogs', descriptionKey:'settingsSectionLogsDesc' }`。
- [ ] **Step 2:** 在 model/advanced 之间或 about 之前加 `<SettingsSection id="logs" …><LogViewer/>（+ 保留天数/上限输入，绑 logRetentionDays/logMaxEntries）</SettingsSection>`。
- [ ] **Step 3: 冒烟测试** — 渲染设置含「日志」节标题；保留天数输入变更触发 `onSave`。
- [ ] **Step 4: 运行确认通过 + 构建** — `pnpm -F extension test`、`tsc --noEmit`、`build`。
- [ ] **Step 5: Commit** — `feat(ext): logs section in settings`

---

## Task 13: 同步上游文档（与功能同 commit 收尾）

**Files:**
- Modify: `.project.agents/docs/context/ARCHITECTURE.md`、`.project.agents/docs/context/PRD.md`
- Modify: `.project.agents/log/`（新增本次执行日志，按模板）

- [ ] **Step 1:** `ARCHITECTURE.md` 插件域模块清单加「Logging（logger/logStore/redaction/loggingFetch）」「LogViewer」；依赖图标出 background 独占 idb、`LOG_*` 通道；记 idb v2。
- [ ] **Step 2:** `PRD.md` 加「日志查看/导出 + 本地保留（默认 3 天可配 + 体积上限）」功能条目。
- [ ] **Step 3:** 写 `.project.agents/log/` 执行日志（含提交列表）。
- [ ] **Step 4: Commit** — `docs: register logging module + retention feature`

---

## Self-Review（计划对照 spec）

- **spec §4 架构**：Task 5/6/7（单写入者 + 路由 + 通道）✓
- **spec §5 数据模型**：Task 1 `logTypes` ✓
- **spec §6 来源/级别**：Task 10 埋点 ✓
- **spec §7 LLM 全文**：Task 9 拦截器 + Task 10 安装 ✓
- **spec §8 脱敏**：Task 1 `redact` + Task 6/9 调用 ✓
- **spec §9 存储 v2**：Task 2 ✓
- **spec §10 保留**：Task 4 purge + Task 7 调度 + Task 8 设置 ✓
- **spec §11 查看器**：Task 11 + Task 12 ✓
- **spec §13 权限**：Task 7（`alarms`）✓
- **spec §14 文档**：Task 13 ✓
- **spec §15 测试**：各 Task 内置 TDD ✓
- 类型一致性：`LogDraft`/`LogEntry`/`LogQueryFilter`/`LogControlMessage`、`appendBatch/query/exportAll/clear/purge`、`logger.{level}(source,message,data)`、`installLlmFetchLogging`、`configureLogger` 全计划统一 ✓
- 占位符扫描：无 TBD/TODO；UI/埋点任务给出文件/接口/测试意图与关键代码骨架（React/埋点全量 JSX 不在计划展开，执行时按骨架补全）。
