# 新标签引导页 NewTabHome 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为问学浏览器接管新标签页，提供「液态玻璃之门」入场 + 快捷入口仪表盘 + 4 步 onboarding + 设置入口。

**Architecture:** 插件域新增 L5 模块 `NewTabHome`，落在 WXT 入口 `src/entrypoints/newtab/`（自动注册 `chrome_url_overrides.newtab`）。纯逻辑（两态判定、快捷入口模型、持久化）走 TDD；视觉/动效（Three.js 折射、GSAP 时间线）走构建 + 手动验收（对齐 `UIUX.md` 测试边界）。常态零 WebGL，仅复用现有 `MotionOverlay` CSS 流体玻璃包边；入场态懒加载 three/gsap。

**Tech Stack:** WXT 0.20 · React 19 · Tailwind 4（语义 token）· three（懒加载）· gsap（懒加载）· vitest · `chrome.storage.local`。

**Spec:** `../specs/2026-06-13-newtab-home-design.md`

**前置：** 已在分支 `feat/newtab-home` 上（spec 已提交）。所有命令从仓库根运行。改扩展源码后需 `pnpm -F extension build`（见项目 memory）。

---

## 文件结构（先锁定边界）

新增：

- `apps/extension/src/entrypoints/newtab/{index.html,main.tsx,App.tsx}` — 入口与装配根
- `apps/extension/src/lib/quickLinks.ts` (+ `.test.ts`) — 快捷入口纯模型
- `apps/extension/src/lib/quickLinksStorage.ts` (+ `.test.ts`) — 持久化（复用 `ConfigStorageArea` 接口）
- `apps/extension/src/lib/newtabMode.ts` (+ `.test.ts`) — 两态判定 + 会话标志
- `apps/extension/src/components/newtab/BrandHero.tsx` — 字标/slogan
- `apps/extension/src/components/newtab/SettingsEntry.tsx` — 齿轮 → options
- `apps/extension/src/components/newtab/QuickLinksGrid.tsx` — 磁贴网格 + 拖拽
- `apps/extension/src/components/newtab/QuickLinkEditor.tsx` — 增/改对话框
- `apps/extension/src/components/newtab/OnboardingChecklist.tsx` — 4 步清单
- `apps/extension/src/components/newtab/GlassPortalScene.tsx` — Three.js 折射（懒加载）
- `apps/extension/src/components/newtab/IntroSequence.tsx` — GSAP 时间线（懒加载）

修改：

- `apps/extension/src/lib/i18n.tsx` — 追加 newtab 文案 key（zh-CN + en-US）
- `apps/extension/wxt.config.js` — 仅在 WXT 未自动注册 newtab 时显式声明（见 Task 6）；Task 14 加 three/gsap 分包
- `.project.agents/docs/context/{ARCHITECTURE,PRD,UIUX}.md` — 登记模块/功能/视觉方向（Task 1）

---

## Task 1: 上游文档登记（先于代码 —— 硬约束 B1/A3）

**Files:**

- Modify: `.project.agents/docs/context/ARCHITECTURE.md`
- Modify: `.project.agents/docs/context/PRD.md`
- Modify: `.project.agents/docs/context/UIUX.md`

> 项目硬约束：不允许新增未在 ARCHITECTURE 登记的模块。本任务先登记，后续代码才合规。

- [ ] **Step 1: ARCHITECTURE.md §2.2 插件域追加模块卡片**（放在 `SidepanelApp` 卡片之后）

```
## 模块名：NewTabHome（L5）
- 职责：接管新标签页；首次 onboarding、快捷入口仪表盘（增删改排序）、设置入口、液态玻璃入场动效
- 不负责：不实现 Agent 循环 / 不发 LLM 请求 / 不收集 API Key / 不跨域调用桌面端
- 输入：chrome.storage.local（QuickLink、newtabOnboardingDone）、@page-agent/ui、openExtensionOptionsPage
- 输出：用户；经 chrome.tabs 打开站点
- 持有状态：UI 态；读写 QuickLink 与 onboarding 标志
```

- [ ] **Step 2: ARCHITECTURE.md §1.1 实体表追加一行**

```
| QuickLink | id、title、url、icon? | 属于 NewTabHome 仪表盘 | 是：chrome.storage.local（newtabQuickLinks，仅本机，I2） |
```

- [ ] **Step 3: ARCHITECTURE.md §3 DAG 插件域子图加一条边**（在 `ExtensionEntrypoints --> SidepanelApp` 附近）

```
        ExtensionEntrypoints --> NewTabHome
        NewTabHome --> PA_UI["@page-agent/ui"]
```

- [ ] **Step 4: ARCHITECTURE.md §4 持久化表追加一行；并在 `ExtensionEntrypoints` 卡片职责末尾补 “newtab 页面装配”**

```
| 快捷入口与 onboarding 标志 | chrome.storage.local | NewTabHome | 不出本机（I2）；newtabQuickLinks 为非敏感书签数据 |
```

- [ ] **Step 5: PRD.md 增强功能区追加功能条目**（按 PRD 现有功能清单格式插入，归类「增强」）

```
- 新标签引导页（增强）：问学浏览器接管新标签页，提供品牌入场动效、可自定义快捷入口、首次 onboarding 与插件设置入口。仅插件域，不收集 API Key，不与桌面端通信。
  用户故事：作为问学浏览器用户，我打开新标签即可看到上手引导与常用入口，并一键进入设置。
```

- [ ] **Step 6: UIUX.md 末尾追加新小节**

```
## 12. 新标签引导页（NewTabHome）

> 本页是品牌「炫酷首屏·克制日常」的有意偏离面：相对 §1.4/§5 的安静基调，新标签引导页在入场时允许电影级动效，常态回到克制。偏离仅限本页，且严格受下列边界约束。

- 形态：接管新标签页（chrome_url_overrides.newtab），自包含于插件域，桌面端零改动。
- 两态：
  - 入场态（每次启动后的第一个新标签 / 首次打开 / 手动重播）：Three.js + GSAP「液态玻璃之门」——折射玻璃面板由虚到实「开门」，仪表盘内容透出，边缘沿用 §5 流体玻璃流光语言。
  - 常态（同会话后续新标签）：零 WebGL，仅 §5 流体玻璃 CSS 包边（复用 MotionOverlay）+ ≤150ms 过渡。
- 内容：字标 hero、快捷入口磁贴（增删改排序）、4 步 onboarding（可折叠）、设置齿轮入口。
- 约束：跟随系统深浅色；prefers-reduced-motion 时跳过 WebGL 与时间线，直接静态合成；入场后释放 GPU 上下文；中性黑白灰主调 + 低饱和流光点缀，不铺满彩色渐变。
```

- [ ] **Step 7: Commit**

```bash
git add .project.agents/docs/context/ARCHITECTURE.md .project.agents/docs/context/PRD.md .project.agents/docs/context/UIUX.md
git commit -m "docs: 登记 NewTabHome 模块、功能与视觉方向

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 引入 three / gsap 依赖

**Files:**

- Modify: `apps/extension/package.json`（pnpm 自动写入）

- [ ] **Step 1: 安装依赖**

Run: `pnpm -F extension add -D three gsap && pnpm -F extension add -D @types/three`
Expected: `package.json` devDependencies 出现 `three`、`gsap`、`@types/three`；`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 验证构建未破坏**

Run: `pnpm -F extension build`
Expected: 构建成功，产出 `.output/chrome-mv3/`（此时还没用到 three/gsap，仅确认装包不破坏现状）。

- [ ] **Step 3: Commit**

```bash
git add apps/extension/package.json pnpm-lock.yaml
git commit -m "chore(ext): 新增 three/gsap 依赖（newtab 入场用）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: QuickLinks 纯模型（TDD）

**Files:**

- Create: `apps/extension/src/lib/quickLinks.ts`
- Test: `apps/extension/src/lib/quickLinks.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/extension/src/lib/quickLinks.test.ts
import { describe, expect, it } from 'vitest'

import {
	addQuickLink,
	DEFAULT_QUICK_LINKS,
	normalizeQuickLinks,
	normalizeUrl,
	removeQuickLink,
	reorderQuickLinks,
	updateQuickLink,
} from '@/lib/quickLinks'

describe('normalizeUrl', () => {
	it('prepends https when protocol missing', () => {
		expect(normalizeUrl('example.com')).toBe('https://example.com/')
	})
	it('keeps existing protocol', () => {
		expect(normalizeUrl('http://a.test/')).toBe('http://a.test/')
	})
	it('returns null for blank or invalid', () => {
		expect(normalizeUrl('   ')).toBeNull()
		expect(normalizeUrl('http://')).toBeNull()
	})
})

describe('normalizeQuickLinks', () => {
	it('falls back to defaults for non-array', () => {
		expect(normalizeQuickLinks(undefined)).toEqual(DEFAULT_QUICK_LINKS)
	})
	it('drops entries without title or valid url, normalizes url', () => {
		const out = normalizeQuickLinks([
			{ id: 'a', title: 'A', url: 'a.com' },
			{ id: 'b', title: '', url: 'b.com' },
			{ id: 'c', title: 'C', url: 'not a url ::' },
		])
		expect(out).toHaveLength(1)
		expect(out[0]).toMatchObject({ id: 'a', title: 'A', url: 'https://a.com/' })
	})
})

describe('CRUD + reorder', () => {
	const base = [
		{ id: '1', title: 'One', url: 'https://1.test/' },
		{ id: '2', title: 'Two', url: 'https://2.test/' },
	]
	it('adds a normalized link', () => {
		const out = addQuickLink(base, { title: ' Three ', url: '3.test' })
		expect(out).toHaveLength(3)
		expect(out[2]).toMatchObject({ title: 'Three', url: 'https://3.test/' })
		expect(out[2].id).toBeTruthy()
	})
	it('ignores invalid add', () => {
		expect(addQuickLink(base, { title: '', url: '3.test' })).toEqual(base)
		expect(addQuickLink(base, { title: 'x', url: '' })).toEqual(base)
	})
	it('updates fields, keeping old url on invalid', () => {
		const out = updateQuickLink(base, '1', { title: 'Uno', url: 'bad ::' })
		expect(out[0]).toMatchObject({ title: 'Uno', url: 'https://1.test/' })
	})
	it('removes by id', () => {
		expect(removeQuickLink(base, '1')).toHaveLength(1)
	})
	it('reorders to index', () => {
		expect(reorderQuickLinks(base, '2', 0).map((l) => l.id)).toEqual(['2', '1'])
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F extension exec vitest run src/lib/quickLinks.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现模型**

```ts
// apps/extension/src/lib/quickLinks.ts
export interface QuickLink {
	id: string
	title: string
	url: string
	icon?: string
}

export const DEFAULT_QUICK_LINKS: QuickLink[] = [
	{ id: 'doc', title: '问学文档', url: 'https://alibaba.github.io/page-agent' },
	{ id: 'github', title: 'GitHub', url: 'https://github.com/alibaba/page-agent' },
	{ id: 'bing', title: '必应', url: 'https://www.bing.com' },
]

export function normalizeUrl(input: string): string | null {
	const trimmed = input.trim()
	if (!trimmed) return null
	const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
	try {
		const u = new URL(withProto)
		if (!u.hostname) return null
		return u.toString()
	} catch {
		return null
	}
}

function clampTitle(title: string): string {
	return title.trim().slice(0, 40)
}

export function normalizeQuickLinks(raw: unknown): QuickLink[] {
	if (!Array.isArray(raw)) return DEFAULT_QUICK_LINKS.map((l) => ({ ...l }))
	const out: QuickLink[] = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const rec = item as Record<string, unknown>
		const title = clampTitle(typeof rec.title === 'string' ? rec.title : '')
		const url = normalizeUrl(typeof rec.url === 'string' ? rec.url : '')
		if (!title || !url) continue
		out.push({
			id: typeof rec.id === 'string' ? rec.id : crypto.randomUUID(),
			title,
			url,
			icon: typeof rec.icon === 'string' && rec.icon.trim() ? rec.icon.trim() : undefined,
		})
	}
	return out
}

export function addQuickLink(
	list: QuickLink[],
	input: { title: string; url: string; icon?: string },
): QuickLink[] {
	const title = clampTitle(input.title)
	const url = normalizeUrl(input.url)
	if (!title || !url) return list
	return [...list, { id: crypto.randomUUID(), title, url, icon: input.icon?.trim() || undefined }]
}

export function updateQuickLink(
	list: QuickLink[],
	id: string,
	patch: { title?: string; url?: string; icon?: string },
): QuickLink[] {
	return list.map((link) => {
		if (link.id !== id) return link
		const next = { ...link }
		if (patch.title !== undefined) next.title = clampTitle(patch.title) || link.title
		if (patch.url !== undefined) next.url = normalizeUrl(patch.url) ?? link.url
		if (patch.icon !== undefined) next.icon = patch.icon.trim() || undefined
		return next
	})
}

export function removeQuickLink(list: QuickLink[], id: string): QuickLink[] {
	return list.filter((link) => link.id !== id)
}

export function reorderQuickLinks(list: QuickLink[], fromId: string, toIndex: number): QuickLink[] {
	const from = list.findIndex((l) => l.id === fromId)
	if (from === -1) return list
	const next = [...list]
	const [moved] = next.splice(from, 1)
	const clamped = Math.max(0, Math.min(toIndex, next.length))
	next.splice(clamped, 0, moved)
	return next
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F extension exec vitest run src/lib/quickLinks.test.ts`
Expected: PASS（全部用例绿）。

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/lib/quickLinks.ts apps/extension/src/lib/quickLinks.test.ts
git commit -m "feat(ext): 快捷入口纯模型（增删改排序 + URL 归一化）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 两态判定 + 会话标志（TDD）

**Files:**

- Create: `apps/extension/src/lib/newtabMode.ts`
- Test: `apps/extension/src/lib/newtabMode.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/extension/src/lib/newtabMode.test.ts
import { describe, expect, it } from 'vitest'

import {
	decideMode,
	hasIntroPlayed,
	markIntroPlayed,
	type SessionFlagStore,
} from '@/lib/newtabMode'

function fakeSession(): SessionFlagStore {
	const m = new Map<string, string>()
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

describe('decideMode', () => {
	it('calm when reduced motion regardless of intro', () => {
		expect(decideMode({ introPlayed: false, reducedMotion: true })).toBe('calm')
	})
	it('intro on first session tab', () => {
		expect(decideMode({ introPlayed: false, reducedMotion: false })).toBe('intro')
	})
	it('calm after intro already played this session', () => {
		expect(decideMode({ introPlayed: true, reducedMotion: false })).toBe('calm')
	})
})

describe('session flag', () => {
	it('reads and marks', () => {
		const s = fakeSession()
		expect(hasIntroPlayed(s)).toBe(false)
		markIntroPlayed(s)
		expect(hasIntroPlayed(s)).toBe(true)
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F extension exec vitest run src/lib/newtabMode.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// apps/extension/src/lib/newtabMode.ts
export type NewTabMode = 'intro' | 'calm'

const SESSION_KEY = 'introPlayedThisSession'

export function decideMode(opts: { introPlayed: boolean; reducedMotion: boolean }): NewTabMode {
	if (opts.reducedMotion) return 'calm'
	return opts.introPlayed ? 'calm' : 'intro'
}

export interface SessionFlagStore {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
}

export function hasIntroPlayed(session: SessionFlagStore = sessionStorage): boolean {
	return session.getItem(SESSION_KEY) === '1'
}

export function markIntroPlayed(session: SessionFlagStore = sessionStorage): void {
	session.setItem(SESSION_KEY, '1')
}

export function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F extension exec vitest run src/lib/newtabMode.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/lib/newtabMode.ts apps/extension/src/lib/newtabMode.test.ts
git commit -m "feat(ext): 新标签两态判定与会话标志

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 快捷入口持久化（TDD，复用 ConfigStorageArea）

**Files:**

- Create: `apps/extension/src/lib/quickLinksStorage.ts`
- Test: `apps/extension/src/lib/quickLinksStorage.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/extension/src/lib/quickLinksStorage.test.ts
import { describe, expect, it } from 'vitest'

import type { ConfigStorageArea } from '@/lib/configStorage'
import { DEFAULT_QUICK_LINKS } from '@/lib/quickLinks'
import {
	loadOnboardingDone,
	loadQuickLinks,
	saveOnboardingDone,
	saveQuickLinks,
} from '@/lib/quickLinksStorage'

function fakeStorage(initial: Record<string, unknown> = {}): ConfigStorageArea {
	const data = { ...initial }
	return {
		async get(keys) {
			const list = Array.isArray(keys) ? keys : [keys]
			const out: Record<string, unknown> = {}
			for (const k of list) if (k in data) out[k] = data[k]
			return out
		},
		async set(values) {
			Object.assign(data, values)
		},
		async remove(key) {
			delete data[key]
		},
	}
}

describe('quickLinksStorage', () => {
	it('returns defaults when empty', async () => {
		expect(await loadQuickLinks(fakeStorage())).toEqual(DEFAULT_QUICK_LINKS)
	})
	it('round-trips a saved list', async () => {
		const s = fakeStorage()
		const list = [{ id: 'x', title: 'X', url: 'https://x.test/' }]
		await saveQuickLinks(s, list)
		expect(await loadQuickLinks(s)).toEqual(list)
	})
	it('onboarding flag defaults false and persists', async () => {
		const s = fakeStorage()
		expect(await loadOnboardingDone(s)).toBe(false)
		await saveOnboardingDone(s, true)
		expect(await loadOnboardingDone(s)).toBe(true)
	})
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F extension exec vitest run src/lib/quickLinksStorage.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/extension/src/lib/quickLinksStorage.ts
import type { ConfigStorageArea } from '@/lib/configStorage'
import { normalizeQuickLinks, type QuickLink } from '@/lib/quickLinks'

const QUICK_LINKS_KEY = 'newtabQuickLinks'
const ONBOARDING_DONE_KEY = 'newtabOnboardingDone'

export async function loadQuickLinks(
	storage: ConfigStorageArea = chrome.storage.local,
): Promise<QuickLink[]> {
	const r = await storage.get(QUICK_LINKS_KEY)
	return normalizeQuickLinks(r[QUICK_LINKS_KEY])
}

export async function saveQuickLinks(storage: ConfigStorageArea, list: QuickLink[]): Promise<void> {
	await storage.set({ [QUICK_LINKS_KEY]: list })
}

export async function loadOnboardingDone(
	storage: ConfigStorageArea = chrome.storage.local,
): Promise<boolean> {
	const r = await storage.get(ONBOARDING_DONE_KEY)
	return r[ONBOARDING_DONE_KEY] === true
}

export async function saveOnboardingDone(storage: ConfigStorageArea, done: boolean): Promise<void> {
	await storage.set({ [ONBOARDING_DONE_KEY]: done })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F extension exec vitest run src/lib/quickLinksStorage.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/lib/quickLinksStorage.ts apps/extension/src/lib/quickLinksStorage.test.ts
git commit -m "feat(ext): 快捷入口与 onboarding 标志持久化

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: newtab 入口骨架 + manifest 注册

**Files:**

- Create: `apps/extension/src/entrypoints/newtab/index.html`
- Create: `apps/extension/src/entrypoints/newtab/main.tsx`
- Create: `apps/extension/src/entrypoints/newtab/App.tsx`
- Maybe modify: `apps/extension/wxt.config.js`（仅当未自动注册时）

- [ ] **Step 1: index.html（镜像 hub，跟随系统深浅色）**

```html
<!doctype html>
<html>
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta name="color-scheme" content="light dark" />
		<link rel="icon" type="image/png" href="/assets/page-agent-64.png" />
		<title>问学 · 新标签页</title>
	</head>
	<body>
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
```

- [ ] **Step 2: main.tsx（跟随系统主题；不启用 StrictMode，避免 WebGL/gsap 副作用双初始化）**

```tsx
// apps/extension/src/entrypoints/newtab/main.tsx
import ReactDOM from 'react-dom/client'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { I18nProvider } from '@/lib/i18n'

import App from './App'

import '@/assets/index.css'

const mq = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (dark: boolean) => document.documentElement.classList.toggle('dark', dark)
applyTheme(mq.matches)
mq.addEventListener('change', (e) => applyTheme(e.matches))

ReactDOM.createRoot(document.getElementById('root')!).render(
	<ErrorBoundary>
		<I18nProvider>
			<App />
		</I18nProvider>
	</ErrorBoundary>,
)
```

- [ ] **Step 3: App.tsx（本任务先放占位骨架，后续任务填充）**

```tsx
// apps/extension/src/entrypoints/newtab/App.tsx
export default function App() {
	return (
		<div className="relative min-h-screen w-full bg-background text-foreground flex items-center justify-center">
			<p className="text-muted-foreground text-sm">问学 · 新标签页</p>
		</div>
	)
}
```

- [ ] **Step 4: 构建并确认 WXT 自动注册了 newtab**

Run: `pnpm -F extension build`
Then: `cat apps/extension/.output/chrome-mv3/manifest.json | python3 -c "import sys,json;print(json.load(sys.stdin).get('chrome_url_overrides'))"`
Expected: 输出 `{'newtab': 'newtab.html'}`，且 `.output/chrome-mv3/newtab.html` 存在。

- [ ] **Step 5（仅当上一步为 None）: 在 wxt.config.js 的 manifest 显式声明**

在 `apps/extension/wxt.config.js` 的 `manifest: {` 内加：

```js
		chrome_url_overrides: { newtab: 'newtab.html' },
```

再次 `pnpm -F extension build` 并重复 Step 4 校验。

- [ ] **Step 6: 手动验收**

加载 `apps/extension/.output/chrome-mv3/` 到 Chrome（或 `pnpm -F extension dev`），开新标签页应显示「问学 · 新标签页」占位。

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/ apps/extension/wxt.config.js
git commit -m "feat(ext): newtab 入口骨架并接管新标签页

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: i18n 文案

**Files:**

- Modify: `apps/extension/src/lib/i18n.tsx`

- [ ] **Step 1: 在 `translations['zh-CN']` 末尾（`copied` 之后）追加**

```ts
		// NewTabHome
		ntSlogan: 'ask for everything',
		ntQuickLinks: '快捷入口',
		ntAddLink: '添加入口',
		ntEditLink: '编辑入口',
		ntLinkTitle: '名称',
		ntLinkUrl: '网址',
		ntLinkIcon: '图标（可选，emoji 或图片链接）',
		ntSave: '保存',
		ntCancel: '取消',
		ntDelete: '删除',
		ntOpenSettings: '打开设置',
		ntReplayIntro: '重播入场',
		ntOnboardingTitle: '第一次使用问学',
		ntOnboardingDone: '知道了',
		ntStep1: '在工具栏点开问学侧边栏，必要时固定它',
		ntStep2: '默认用内置模型即可；要自定义模型就进设置页添加',
		ntStep3: '打开目标网页，在侧边栏用自然语言描述任务',
		ntStep4: '执行中你随时可以停止或人工接管',
```

- [ ] **Step 2: 在 `translations['en-US']` 末尾（`copied` 之后）追加对应英文**

```ts
		ntSlogan: 'ask for everything',
		ntQuickLinks: 'Quick links',
		ntAddLink: 'Add link',
		ntEditLink: 'Edit link',
		ntLinkTitle: 'Name',
		ntLinkUrl: 'URL',
		ntLinkIcon: 'Icon (optional, emoji or image URL)',
		ntSave: 'Save',
		ntCancel: 'Cancel',
		ntDelete: 'Delete',
		ntOpenSettings: 'Open settings',
		ntReplayIntro: 'Replay intro',
		ntOnboardingTitle: 'First time with 问学',
		ntOnboardingDone: 'Got it',
		ntStep1: 'Open the 问学 side panel from the toolbar; pin it if you like',
		ntStep2: 'The built-in model works by default; add a custom one in settings',
		ntStep3: 'Open a target page and describe your task in the side panel',
		ntStep4: 'You can stop or take over at any time while it runs',
```

- [ ] **Step 3: 类型与构建校验**

Run: `pnpm -F extension build`
Expected: 构建通过（`TranslationKey` 自动含新 key，因 zh-CN 为类型来源）。

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/lib/i18n.tsx
git commit -m "feat(ext): newtab 引导页文案（中英）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: BrandHero + SettingsEntry

**Files:**

- Create: `apps/extension/src/components/newtab/BrandHero.tsx`
- Create: `apps/extension/src/components/newtab/SettingsEntry.tsx`

- [ ] **Step 1: BrandHero（复用 Logo 资产 + 现有 slogan 图）**

```tsx
// apps/extension/src/components/newtab/BrandHero.tsx
import { Logo } from '@/components/misc'
import { useI18n } from '@/lib/i18n'

export function BrandHero() {
	const { t } = useI18n()
	return (
		<div className="flex flex-col items-center gap-3 text-center select-none">
			<Logo className="size-16 opacity-90" />
			<img
				src="/assets/wenxue-slogan.png"
				alt="问学 — ask for everything"
				className="w-52 max-w-full pointer-events-none"
			/>
			<p className="text-xs tracking-[0.16em] text-muted-foreground">{t('ntSlogan')}</p>
		</div>
	)
}
```

- [ ] **Step 2: SettingsEntry（复用现有 openExtensionOptionsPage）**

```tsx
// apps/extension/src/components/newtab/SettingsEntry.tsx
import { Settings } from 'lucide-react'

import { openExtensionOptionsPage } from '@/lib/extensionPages'
import { useI18n } from '@/lib/i18n'

export function SettingsEntry() {
	const { t } = useI18n()
	return (
		<button
			type="button"
			onClick={() => openExtensionOptionsPage()}
			aria-label={t('ntOpenSettings')}
			title={t('ntOpenSettings')}
			className="flex size-9 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
		>
			<Settings className="size-4" />
		</button>
	)
}
```

- [ ] **Step 3: 构建校验**

Run: `pnpm -F extension build`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/components/newtab/BrandHero.tsx apps/extension/src/components/newtab/SettingsEntry.tsx
git commit -m "feat(ext): newtab 字标 hero 与设置入口

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: QuickLinksGrid + QuickLinkEditor

**Files:**

- Create: `apps/extension/src/components/newtab/QuickLinkEditor.tsx`
- Create: `apps/extension/src/components/newtab/QuickLinksGrid.tsx`

- [ ] **Step 1: QuickLinkEditor（增/改对话框，受控）**

```tsx
// apps/extension/src/components/newtab/QuickLinkEditor.tsx
import { useState } from 'react'

import { useI18n } from '@/lib/i18n'
import type { QuickLink } from '@/lib/quickLinks'

interface Props {
	initial?: QuickLink
	onSubmit: (value: { title: string; url: string; icon?: string }) => void
	onClose: () => void
}

export function QuickLinkEditor({ initial, onSubmit, onClose }: Props) {
	const { t } = useI18n()
	const [title, setTitle] = useState(initial?.title ?? '')
	const [url, setUrl] = useState(initial?.url ?? '')
	const [icon, setIcon] = useState(initial?.icon ?? '')

	const submit = () => {
		if (!title.trim() || !url.trim()) return
		onSubmit({ title, url, icon })
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="w-80 max-w-[90vw] rounded-xl border bg-card p-4 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<p className="mb-3 text-sm font-semibold">{initial ? t('ntEditLink') : t('ntAddLink')}</p>
				<label className="block space-y-1">
					<span className="text-xs text-muted-foreground">{t('ntLinkTitle')}</span>
					<input
						autoFocus
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</label>
				<label className="mt-3 block space-y-1">
					<span className="text-xs text-muted-foreground">{t('ntLinkUrl')}</span>
					<input
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="example.com"
						className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</label>
				<label className="mt-3 block space-y-1">
					<span className="text-xs text-muted-foreground">{t('ntLinkIcon')}</span>
					<input
						value={icon}
						onChange={(e) => setIcon(e.target.value)}
						className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</label>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent cursor-pointer"
					>
						{t('ntCancel')}
					</button>
					<button
						type="button"
						onClick={submit}
						className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 cursor-pointer"
					>
						{t('ntSave')}
					</button>
				</div>
			</div>
		</div>
	)
}
```

- [ ] **Step 2: QuickLinksGrid（磁贴 + HTML5 拖拽排序 + 增删改；图标用 emoji/图片/首字母单字）**

```tsx
// apps/extension/src/components/newtab/QuickLinksGrid.tsx
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useI18n } from '@/lib/i18n'
import {
	addQuickLink,
	type QuickLink,
	removeQuickLink,
	reorderQuickLinks,
	updateQuickLink,
} from '@/lib/quickLinks'

import { QuickLinkEditor } from './QuickLinkEditor'

interface Props {
	links: QuickLink[]
	onChange: (next: QuickLink[]) => void
}

function Favicon({ link }: { link: QuickLink }) {
	if (link.icon && /^https?:\/\//.test(link.icon)) {
		return <img src={link.icon} alt="" className="size-6 rounded" />
	}
	if (link.icon) return <span className="text-xl leading-none">{link.icon}</span>
	return (
		<span className="flex size-6 items-center justify-center rounded bg-accent text-xs font-semibold text-accent-foreground">
			{link.title.slice(0, 1).toUpperCase()}
		</span>
	)
}

export function QuickLinksGrid({ links, onChange }: Props) {
	const { t } = useI18n()
	const [editing, setEditing] = useState<QuickLink | null>(null)
	const [adding, setAdding] = useState(false)
	const [dragId, setDragId] = useState<string | null>(null)

	return (
		<div className="w-full">
			<p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
				{t('ntQuickLinks')}
			</p>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
				{links.map((link, index) => (
					<div
						key={link.id}
						draggable
						onDragStart={() => setDragId(link.id)}
						onDragOver={(e) => e.preventDefault()}
						onDrop={() => {
							if (dragId && dragId !== link.id) onChange(reorderQuickLinks(links, dragId, index))
							setDragId(null)
						}}
						className="group relative flex flex-col items-center gap-1.5 rounded-xl border bg-card p-3 transition-colors hover:bg-accent"
					>
						<a href={link.url} className="flex flex-col items-center gap-1.5" title={link.url}>
							<Favicon link={link} />
							<span className="line-clamp-1 max-w-full text-xs text-foreground">{link.title}</span>
						</a>
						<div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
							<button
								type="button"
								aria-label={t('ntEditLink')}
								onClick={() => setEditing(link)}
								className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
							>
								<Pencil className="size-3" />
							</button>
							<button
								type="button"
								aria-label={t('ntDelete')}
								onClick={() => onChange(removeQuickLink(links, link.id))}
								className="rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer"
							>
								<Trash2 className="size-3" />
							</button>
						</div>
					</div>
				))}
				<button
					type="button"
					onClick={() => setAdding(true)}
					aria-label={t('ntAddLink')}
					className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
				>
					<Plus className="size-5" />
					<span className="text-xs">{t('ntAddLink')}</span>
				</button>
			</div>

			{adding && (
				<QuickLinkEditor
					onClose={() => setAdding(false)}
					onSubmit={(v) => {
						onChange(addQuickLink(links, v))
						setAdding(false)
					}}
				/>
			)}
			{editing && (
				<QuickLinkEditor
					initial={editing}
					onClose={() => setEditing(null)}
					onSubmit={(v) => {
						onChange(updateQuickLink(links, editing.id, v))
						setEditing(null)
					}}
				/>
			)}
		</div>
	)
}
```

- [ ] **Step 3: 构建校验**

Run: `pnpm -F extension build`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/components/newtab/QuickLinkEditor.tsx apps/extension/src/components/newtab/QuickLinksGrid.tsx
git commit -m "feat(ext): 快捷入口网格与编辑（增删改拖拽）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: OnboardingChecklist

**Files:**

- Create: `apps/extension/src/components/newtab/OnboardingChecklist.tsx`

- [ ] **Step 1: 实现（4 步，可折叠，持久化 done 标志）**

```tsx
// apps/extension/src/components/newtab/OnboardingChecklist.tsx
import { ChevronDown, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { useI18n } from '@/lib/i18n'

interface Props {
	done: boolean
	onDone: (done: boolean) => void
}

export function OnboardingChecklist({ done, onDone }: Props) {
	const { t } = useI18n()
	const [collapsed, setCollapsed] = useState(done)
	const steps = [t('ntStep1'), t('ntStep2'), t('ntStep3'), t('ntStep4')]

	if (collapsed) {
		return (
			<button
				type="button"
				onClick={() => setCollapsed(false)}
				className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
			>
				<Sparkles className="size-3.5" />
				{t('ntOnboardingTitle')}
			</button>
		)
	}

	return (
		<div className="w-full rounded-xl border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<p className="flex items-center gap-2 text-sm font-semibold">
					<Sparkles className="size-4" />
					{t('ntOnboardingTitle')}
				</p>
				<button
					type="button"
					aria-label={t('ntOnboardingDone')}
					onClick={() => {
						setCollapsed(true)
						onDone(true)
					}}
					className="rounded p-1 text-muted-foreground hover:text-foreground cursor-pointer"
				>
					<ChevronDown className="size-4" />
				</button>
			</div>
			<ol className="space-y-2">
				{steps.map((step, i) => (
					<li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground">
						<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] text-muted-foreground">
							{i + 1}
						</span>
						<span>{step}</span>
					</li>
				))}
			</ol>
			<button
				type="button"
				onClick={() => {
					setCollapsed(true)
					onDone(true)
				}}
				className="mt-3 w-full rounded-lg bg-muted px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors cursor-pointer"
			>
				{t('ntOnboardingDone')}
			</button>
		</div>
	)
}
```

- [ ] **Step 2: 构建校验**

Run: `pnpm -F extension build`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/components/newtab/OnboardingChecklist.tsx
git commit -m "feat(ext): newtab onboarding 4 步清单

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: App 常态组装（可用的克制仪表盘，零 WebGL）

**Files:**

- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`

> 本任务交付一个完整可用的常态仪表盘（含流体玻璃包边、快捷入口、onboarding、设置）。入场动效在 Task 12-13 叠加。

- [ ] **Step 1: 用 storage 装配常态 App**

```tsx
// apps/extension/src/entrypoints/newtab/App.tsx
import { useEffect, useState } from 'react'

import { MotionOverlay } from '@/components/misc'
import { BrandHero } from '@/components/newtab/BrandHero'
import { OnboardingChecklist } from '@/components/newtab/OnboardingChecklist'
import { QuickLinksGrid } from '@/components/newtab/QuickLinksGrid'
import { SettingsEntry } from '@/components/newtab/SettingsEntry'
import type { QuickLink } from '@/lib/quickLinks'
import {
	loadOnboardingDone,
	loadQuickLinks,
	saveOnboardingDone,
	saveQuickLinks,
} from '@/lib/quickLinksStorage'

export default function App() {
	const [links, setLinks] = useState<QuickLink[] | null>(null)
	const [onboardingDone, setOnboardingDone] = useState(true)

	useEffect(() => {
		loadQuickLinks().then(setLinks)
		loadOnboardingDone().then(setOnboardingDone)
	}, [])

	const updateLinks = (next: QuickLink[]) => {
		setLinks(next)
		saveQuickLinks(chrome.storage.local, next)
	}
	const markOnboarding = (done: boolean) => {
		setOnboardingDone(done)
		saveOnboardingDone(chrome.storage.local, done)
	}

	return (
		<div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
			<MotionOverlay active />

			<div className="absolute right-5 top-5 z-20">
				<SettingsEntry />
			</div>

			<main className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
				<BrandHero />
				{links && <QuickLinksGrid links={links} onChange={updateLinks} />}
				<OnboardingChecklist done={onboardingDone} onDone={markOnboarding} />
			</main>
		</div>
	)
}
```

- [ ] **Step 2: 构建并手动验收**

Run: `pnpm -F extension build`
Then: 加载扩展，开新标签。Expected：字标 hero + 快捷入口（默认 3 个 + 添加位）+ onboarding 清单 + 右上设置齿轮；四周有流体玻璃包边；增/删/改/拖拽一个入口后刷新仍在；点齿轮打开 options 标签页；切换系统深浅色页面跟随。

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/App.tsx
git commit -m "feat(ext): newtab 常态仪表盘组装（流体玻璃包边 + 入口 + onboarding + 设置）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: GlassPortalScene（Three.js 折射，懒加载）

**Files:**

- Create: `apps/extension/src/components/newtab/GlassPortalScene.tsx`

> 折射/调色是迭代视觉项；以下为可运行基线，手动验收时再调参（厚度、ior、流光饱和度、相机）。`prefers-reduced-motion` 与卸载时必须释放 GPU 上下文。

- [ ] **Step 1: 实现可运行的折射场景**

```tsx
// apps/extension/src/components/newtab/GlassPortalScene.tsx
import { useEffect, useRef } from 'react'

export interface GlassPortalHandle {
	setProgress: (p: number) => void
}

interface Props {
	dark: boolean
	onReady?: (handle: GlassPortalHandle) => void
}

export function GlassPortalScene({ dark, onReady }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const onReadyRef = useRef(onReady)
	onReadyRef.current = onReady

	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		let disposed = false
		let cleanup = () => {}

		;(async () => {
			const THREE = await import('three')
			if (disposed) return

			const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
			renderer.setSize(el.clientWidth, el.clientHeight)
			el.appendChild(renderer.domElement)

			const scene = new THREE.Scene()
			const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100)
			camera.position.set(0, 0, 6)

			// Low-sat color backdrop the glass refracts (UIUX §5 palette)
			const bg = new THREE.Mesh(
				new THREE.PlaneGeometry(20, 12),
				new THREE.MeshBasicMaterial({
					vertexColors: true,
				}),
			)
			const cols = [
				new THREE.Color('#5b86c4'),
				new THREE.Color('#7b6fc9'),
				new THREE.Color('#49b0a8'),
				new THREE.Color('#cf7d5e'),
			]
			const geo = bg.geometry as THREE.PlaneGeometry
			const colorAttr = new Float32Array(geo.attributes.position.count * 3)
			for (let i = 0; i < geo.attributes.position.count; i++) {
				const c = cols[i % cols.length].clone().multiplyScalar(dark ? 0.5 : 0.85)
				colorAttr.set([c.r, c.g, c.b], i * 3)
			}
			geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3))
			bg.position.z = -3
			scene.add(bg)

			scene.add(new THREE.AmbientLight(0xffffff, dark ? 0.5 : 0.9))
			const key = new THREE.DirectionalLight(0xffffff, 1.1)
			key.position.set(3, 2, 5)
			scene.add(key)

			// Refractive glass pane
			const glass = new THREE.Mesh(
				new THREE.PlaneGeometry(4.4, 2.8, 1, 1),
				new THREE.MeshPhysicalMaterial({
					transmission: 1,
					thickness: 1.2,
					roughness: 0.12,
					ior: 1.3,
					metalness: 0,
					clearcoat: 1,
					clearcoatRoughness: 0.2,
					transparent: true,
					opacity: 1,
				}),
			)
			scene.add(glass)

			let progress = 0
			const handle: GlassPortalHandle = { setProgress: (p) => void (progress = p) }
			onReadyRef.current?.(handle)

			let raf = 0
			let t = 0
			const render = () => {
				t += 0.016
				// entrance: frosted+small -> clear+full, driven by progress (0..1)
				const mat = glass.material as THREE.MeshPhysicalMaterial
				mat.roughness = 0.6 - 0.48 * progress
				const s = 0.8 + 0.2 * progress
				glass.scale.setScalar(s)
				glass.rotation.y = Math.sin(t * 0.3) * 0.06
				glass.rotation.x = Math.cos(t * 0.25) * 0.04
				key.position.x = Math.sin(t * 0.6) * 4 // light sweep
				renderer.render(scene, camera)
				raf = requestAnimationFrame(render)
			}
			render()

			const onResize = () => {
				renderer.setSize(el.clientWidth, el.clientHeight)
				camera.aspect = el.clientWidth / el.clientHeight
				camera.updateProjectionMatrix()
			}
			window.addEventListener('resize', onResize)

			cleanup = () => {
				cancelAnimationFrame(raf)
				window.removeEventListener('resize', onResize)
				renderer.dispose()
				glass.geometry.dispose()
				;(glass.material as THREE.Material).dispose()
				bg.geometry.dispose()
				;(bg.material as THREE.Material).dispose()
				renderer.forceContextLoss()
				el.removeChild(renderer.domElement)
			}
		})()

		return () => {
			disposed = true
			cleanup()
		}
	}, [dark])

	return <div ref={containerRef} className="absolute inset-0" aria-hidden />
}
```

- [ ] **Step 2: 构建校验**

Run: `pnpm -F extension build`
Expected: 通过；产物中 three 进入独立或动态 chunk（Task 14 显式分包）。

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/components/newtab/GlassPortalScene.tsx
git commit -m "feat(ext): 液态玻璃折射场景（Three.js，懒加载，含 GPU 释放）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: IntroSequence（GSAP）+ 两态接入 App

**Files:**

- Create: `apps/extension/src/components/newtab/IntroSequence.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`

- [ ] **Step 1: IntroSequence（GSAP 驱动 scene 进度 + DOM 透出 + 完成回调）**

```tsx
// apps/extension/src/components/newtab/IntroSequence.tsx
import { useEffect, useRef, useState } from 'react'

import { GlassPortalScene, type GlassPortalHandle } from './GlassPortalScene'

interface Props {
	dark: boolean
	children: React.ReactNode
	onComplete: () => void
}

export function IntroSequence({ dark, children, onComplete }: Props) {
	const handleRef = useRef<GlassPortalHandle | null>(null)
	const contentRef = useRef<HTMLDivElement>(null)
	const onCompleteRef = useRef(onComplete)
	onCompleteRef.current = onComplete
	const [done, setDone] = useState(false)

	useEffect(() => {
		let killed = false
		let tl: { kill: () => void } | null = null
		;(async () => {
			const { gsap } = await import('gsap')
			if (killed) return
			const proxy = { p: 0 }
			tl = gsap.timeline({
				onComplete: () => {
					setDone(true)
					onCompleteRef.current()
				},
			})
			tl.to(proxy, {
				p: 1,
				duration: 1.2,
				ease: 'power3.out',
				onUpdate: () => handleRef.current?.setProgress(proxy.p),
			})
			if (contentRef.current) {
				tl.fromTo(
					contentRef.current,
					{ autoAlpha: 0, y: 16, filter: 'blur(10px)' },
					{ autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.9, ease: 'power2.out' },
					'-=0.5',
				)
				tl.fromTo(
					contentRef.current.querySelectorAll('[data-stagger]'),
					{ autoAlpha: 0, y: 12 },
					{ autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out' },
					'-=0.4',
				)
			}
		})()
		return () => {
			killed = true
			tl?.kill()
		}
	}, [])

	return (
		<div className="absolute inset-0">
			{!done && <GlassPortalScene dark={dark} onReady={(h) => (handleRef.current = h)} />}
			<div ref={contentRef} className="relative z-10 h-full">
				{children}
			</div>
		</div>
	)
}
```

- [ ] **Step 2: App 接入两态（intro 包裹常态内容；calm 直接渲染；含 reduced-motion 与重播）**

将 Task 11 的 `App.tsx` `return` 替换为下面版本，并在文件顶部补充 import：

```tsx
// 顶部补充：
import { IntroSequence } from '@/components/newtab/IntroSequence'
import { RotateCcw } from 'lucide-react'
import { decideMode, hasIntroPlayed, markIntroPlayed, prefersReducedMotion } from '@/lib/newtabMode'
```

在组件内、`updateLinks` 之后加：

```tsx
const { t } = useI18n() // 顶部已可从 useI18n 引入；若未引入则加 import { useI18n } from '@/lib/i18n'
const [mode, setMode] = useState<'intro' | 'calm'>('calm')
const [introKey, setIntroKey] = useState(0)
const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

useEffect(() => {
	const next = decideMode({
		introPlayed: hasIntroPlayed(),
		reducedMotion: prefersReducedMotion(),
	})
	setMode(next)
}, [])

const finishIntro = () => {
	markIntroPlayed()
	setMode('calm')
}
const replay = () => {
	setMode('intro')
	setIntroKey((k) => k + 1)
}
```

`return` 用：

```tsx
const content = (
	<>
		<div className="absolute right-5 top-5 z-20 flex gap-2">
			<button
				type="button"
				onClick={replay}
				aria-label={t('ntReplayIntro')}
				title={t('ntReplayIntro')}
				className="flex size-9 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
			>
				<RotateCcw className="size-4" />
			</button>
			<SettingsEntry />
		</div>
		<main className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
			<div data-stagger>
				<BrandHero />
			</div>
			{links && (
				<div data-stagger className="w-full">
					<QuickLinksGrid links={links} onChange={updateLinks} />
				</div>
			)}
			<div data-stagger>
				<OnboardingChecklist done={onboardingDone} onDone={markOnboarding} />
			</div>
		</main>
	</>
)

return (
	<div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
		<MotionOverlay active />
		{mode === 'intro' ? (
			<IntroSequence key={introKey} dark={dark} onComplete={finishIntro}>
				{content}
			</IntroSequence>
		) : (
			content
		)}
	</div>
)
```

- [ ] **Step 3: 构建并手动验收**

Run: `pnpm -F extension build`
手动：清掉 sessionStorage（新会话）→ 开第一个新标签应跑完整折射入场并透出仪表盘；同会话再开新标签为常态无 WebGL；点重播可重看；系统开启「减少动态效果」时直接静态常态；深浅色各验一遍；入场结束后 DevTools 中 WebGL 上下文已释放（`mode` 切 calm、scene 卸载）。

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/components/newtab/IntroSequence.tsx apps/extension/src/entrypoints/newtab/App.tsx
git commit -m "feat(ext): 液态玻璃之门入场时间线与两态接入

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: 分包、全量验收与执行日志

**Files:**

- Modify: `apps/extension/wxt.config.js`
- Create: `.project.agents/log/2026-06-13-newtab-home.md`

- [ ] **Step 1: three/gsap 单独分包，避免拖慢常态首屏**

在 `apps/extension/wxt.config.js` 的 `vite: () => ({ ... build: { ... } })` 的 `rollupOptions` 内加：

```js
				output: {
					manualChunks(id) {
						if (id.includes('node_modules/three')) return 'three'
						if (id.includes('node_modules/gsap')) return 'gsap'
					},
				},
```

- [ ] **Step 2: 全量构建 + 单测**

Run: `pnpm -F extension build && pnpm -F extension test`
Expected: 构建产出 `three`/`gsap` 独立 chunk；`newtab.html` 不在首屏静态引入它们（仅入场动态加载）；全部单测绿。

- [ ] **Step 3: 手动验收清单（对照 spec §11）**

- [ ] 首次/新会话首标签：完整入场播放并透出仪表盘
- [ ] 同会话后续新标签：常态、无 WebGL、有流体玻璃包边
- [ ] reduced-motion：静态合成，无入场
- [ ] 深色 / 浅色各一遍
- [ ] 快捷入口增/删/改/拖拽排序并持久化
- [ ] 齿轮进 options；重播可重看
- [ ] 常态新标签首屏可交互 ≤1s；入场后 GPU 上下文释放

- [ ] **Step 4: 写执行日志（硬约束 B6）**

按 `VIBECODING_GUIDE.md` §5.3 模板写 `.project.agents/log/2026-06-13-newtab-home.md`：完成内容、提交列表、架构/需求/UI 文档变更（Task 1）、测试结果、下一步（人工验收待办、spec §14 开放项：必应/Google、图标来源、入场时长微调）。

- [ ] **Step 5: Commit**

```bash
git add apps/extension/wxt.config.js .project.agents/log/2026-06-13-newtab-home.md
git commit -m "chore(ext): three/gsap 分包并补 newtab 执行日志

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 自查记录（写计划时已核对）

- **Spec 覆盖**：§2 两态→Task 4/13；§3 视觉→Task 12/13；§4 模块/入口→Task 1/6；§5 组件→Task 8-13；§6 数据→Task 3/5；§7 默认内容→Task 3/7/10；§8 设置→Task 8；§9 依赖/分包→Task 2/14；§10 文档回写→Task 1；§11 测试→Task 3/4/5 + Task 14 验收；§13 卫生→已在 feat 分支。全部有归属。
- **复用（DRY）**：`MotionOverlay`（流体玻璃包边）、`openExtensionOptionsPage`、`Logo`、`useI18n/t`、`ConfigStorageArea` 接口、lucide/simple-icons —— 均复用现有，不重造。
- **类型一致**：`QuickLink`、`ConfigStorageArea`、`NewTabMode`、`GlassPortalHandle.setProgress`、`SessionFlagStore` 在引用处签名一致。
- **占位符**：无 TODO/TBD；视觉迭代项已显式标注为「手动验收时调参」，非占位。
