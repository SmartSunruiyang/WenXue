# M3 — 启动链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ROADMAP Demo M3: clicking the desktop control button launches Chrome for Testing with the WXT extension, keeps BrowserStatus synchronized through typed IPC, and handles duplicate launch/quit behavior.

**Architecture:** Build on M2 modules. `BrowserSupervisor` owns process state and spawn; `DesktopBridge` is the only renderer-to-main IPC surface; `ConsoleUI` consumes bridge state only; `MainBootstrap` composes Electron lifecycle without embedding service logic. No desktop-plugin runtime communication is introduced.

**Tech Stack:** Electron main/preload/renderer · React 19 · TypeScript strict · vitest · child_process · Chrome for Testing · WXT MV3 extension

**Spec:** `../specs/2026-06-11-m3-startup-chain.md`

---

## File Map

- Create: `apps/desktop/src/main/BrowserSupervisor.ts`
- Create: `apps/desktop/src/main/BrowserSupervisor.test.ts`
- Create: `apps/desktop/src/main/DesktopBridge.ts`
- Create: `apps/desktop/src/main/DesktopBridge.test.ts`
- Create: `apps/desktop/src/main/MainBootstrap.ts`
- Create: `apps/desktop/src/main/MainBootstrap.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/strings.ts`
- Create: `apps/desktop/src/renderer/src/wenxue.d.ts`
- Modify: `.project.agents/docs/context/ROADMAP.md`
- Create: `.project.agents/log/YYYY-MM-DD-m3-startup-chain.md`

## Task 1: Preflight gate

**Files:** read-only unless a prerequisite fails and the user explicitly approves fixing it.

- [ ] **Step 1: Confirm branch and clean state**

```bash
git status --short
git branch --show-current
. "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null && node -v && pnpm -v
```

Expected:

- clean status;
- branch is an implementation branch, not `main`;
- Node is `v22.x`;
- pnpm is `9.x`.

- [ ] **Step 2: Verify M1 and M2 prerequisites**

```bash
. "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null
pnpm -r test
pnpm -F extension build
pnpm -F desktop fetch-browser
pnpm -F desktop build
```

Expected:

- all commands pass.

If `pnpm -F extension build` fails, stop and fix M1/vendor first. If `pnpm -F desktop fetch-browser` fails, stop and fix M2 supply chain first.

- [ ] **Step 3: Check root build before M3 implementation**

```bash
. "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null && pnpm build
```

Expected: pass.

If it fails with `packages/* build: sh: vite: command not found`, stop and fix that vendor package build dependency before touching M3 code. M3 must not hide a pre-existing build failure behind new work.

- [ ] **Step 4: Re-read M3 authority**

```bash
sed -n '45,55p' .project.agents/docs/context/ROADMAP.md
sed -n '24,34p' .project.agents/docs/context/ARCHITECTURE.md
sed -n '103,140p' .project.agents/docs/context/ARCHITECTURE.md
sed -n '240,266p' .project.agents/docs/context/ARCHITECTURE.md
sed -n '119,142p' .project.agents/docs/context/TECH-INFRA.md
sed -n '44,76p' .project.agents/docs/context/UIUX.md
```

Expected: confirms M3 scope is BrowserSupervisor, DesktopBridge, ConsoleUI, MainBootstrap only.

## Task 2: BrowserSupervisor state machine

**Files:**
- Create: `apps/desktop/src/main/BrowserSupervisor.ts`
- Create: `apps/desktop/src/main/BrowserSupervisor.test.ts`
- Modify: `.project.agents/docs/context/ROADMAP.md`

- [ ] **Step 1: Write fake child-process test scaffold**

Create a test-local fake child process:

```ts
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

class FakeBrowserProcess extends EventEmitter {
	stdout = new PassThrough()
	stderr = new PassThrough()
	killCalls = 0

	kill(): boolean {
		this.killCalls += 1
		this.emit('exit', 0, null)
		return true
	}
}
```

Use fake `BrowserResources`, `ProfileStore`, and `AppLogger` objects. The fake `spawnBrowser` should push `{ binary, argv }` into an array and return a `FakeBrowserProcess`.

Wrap those fakes in a test helper:

```ts
function createSupervisorHarness() {
	const child = new FakeBrowserProcess()
	const spawns: Array<{ binary: string; argv: string[] }> = []
	const events: BrowserStatus[] = []
	const supervisor = new BrowserSupervisor({
		resources: fakeResources,
		profiles: fakeProfiles,
		logger: fakeLogger,
		spawnBrowser: (binary, argv) => {
			spawns.push({ binary, argv })
			return child
		},
	})

	supervisor.onStatusChange((status) => events.push(status))
	return { supervisor, child, spawns, events }
}
```

- [ ] **Step 2: Write RED tests for status transitions**

Add tests for:

```ts
it('starts idle and emits idle -> launching -> running during launch', async () => {
	const { supervisor, child, events } = createSupervisorHarness()

	await supervisor.launch()
	expect(events).toEqual(['launching'])

	child.emit('spawn')
	expect(supervisor.status()).toBe('running')
	expect(events).toEqual(['launching', 'running'])
})
```

Also test:

- normal child `exit` returns to `idle`;
- child `error` changes to `error`;
- non-zero exit changes to `error`;
- stdout/stderr are attached to logger for profile `default`.

Run:

```bash
pnpm -F desktop test -- src/main/BrowserSupervisor.test.ts
```

Expected: fail because `BrowserSupervisor.ts` does not exist.

- [ ] **Step 3: Implement types and constructor**

`BrowserSupervisor.ts` should export:

```ts
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import type { BrowserResources } from './BrowserResources'
import type { AppLogger } from './AppLogger'
import type { ProfileStore } from './ProfileStore'
import { buildArgv } from './launchConfig'

export type BrowserStatus = 'idle' | 'launching' | 'running' | 'error'

export interface BrowserProcessLike {
	stdout?: NodeJS.ReadableStream | null
	stderr?: NodeJS.ReadableStream | null
	kill(signal?: NodeJS.Signals): boolean
	on(event: 'spawn', listener: () => void): this
	on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
	on(event: 'error', listener: (error: Error) => void): this
}

export interface BrowserSupervisorDeps {
	resources: BrowserResources
	profiles: ProfileStore
	logger: AppLogger
	spawnBrowser?: (binary: string, argv: string[]) => BrowserProcessLike
	focusExisting?: (binary: string, argv: string[]) => void | Promise<void>
}

export class BrowserSupervisor {
	constructor(deps: BrowserSupervisorDeps) {}
	launch(profileId?: string): Promise<void>
	status(): BrowserStatus
	onStatusChange(cb: (status: BrowserStatus) => void): () => void
	requestShutdown(): Promise<void>
}
```

Default `spawnBrowser`:

```ts
(binary, argv) => spawn(binary, argv, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
```

- [ ] **Step 4: Implement minimal launch behavior**

Rules:

- `statusValue` starts `idle`;
- `launch()` during `launching` returns immediately;
- `launch()` during `running` calls `focusExisting` with the current binary/argv and returns;
- `launch()` from `idle`/`error`:
  - `ensureProfile(profileId)`;
  - set status `launching`;
  - compute binary and extension paths;
  - build argv;
  - spawn child;
  - attach streams to logger;
  - on `spawn`, set `running`;
  - on `error`, clear child and set `error`;
  - on `exit`, clear child and set `idle` for code `0`/`null`, otherwise `error`.

Keep `focusExisting` default as a one-shot spawn with same args and ignored stdio, then `unref()` if available.

- [ ] **Step 5: Verify BrowserSupervisor tests**

```bash
pnpm -F desktop test -- src/main/BrowserSupervisor.test.ts
```

Expected: pass.

- [ ] **Step 6: Add RED tests for duplicate launch and requestShutdown**

Add tests:

- launch while `launching` does not call `spawnBrowser` twice;
- launch while `running` calls `focusExisting` once and does not replace the tracked child;
- `requestShutdown()` calls `kill()` on the tracked child and returns after exit;
- `requestShutdown()` from `idle` resolves without throwing.

Run the same test command. Expected: fail until behavior exists.

- [ ] **Step 7: Implement duplicate launch and shutdown behavior**

Implementation details:

- store `currentBinary` and `currentArgv` when launch succeeds far enough to spawn;
- `setStatus(next)` emits only when `next !== current`;
- `requestShutdown()`:
  - if no child, return;
  - call `kill()`;
  - resolve on the next `exit`;
  - include a bounded fallback timeout of 2000 ms so shutdown does not hang forever.

- [ ] **Step 8: Verify and commit**

```bash
pnpm -F desktop test -- src/main/BrowserSupervisor.test.ts
pnpm -F desktop test
```

Change the first M3 checkbox in `ROADMAP.md` to `[x]`, then:

```bash
git add apps/desktop/src/main/BrowserSupervisor.ts apps/desktop/src/main/BrowserSupervisor.test.ts .project.agents/docs/context/ROADMAP.md
git commit -m "feat(desktop): BrowserSupervisor 启动状态机"
```

## Task 3: DesktopBridge IPC

**Files:**
- Create: `apps/desktop/src/main/DesktopBridge.ts`
- Create: `apps/desktop/src/main/DesktopBridge.test.ts`

- [ ] **Step 1: Write RED tests for IPC handlers**

Fake `ipcMain` should record handlers:

```ts
class FakeIpcMain {
	handlers = new Map<string, (...args: unknown[]) => unknown>()
	handle(channel: string, handler: (...args: unknown[]) => unknown) {
		this.handlers.set(channel, handler)
	}
}
```

Test:

- registered handler names include only `browser:launch`, `browser:getStatus`, `app:getVersions`;
- launch success returns `{ ok: true }`;
- launch failure returns `{ ok: false, error: 'boom' }` when the supervisor rejects with `new Error('boom')`;
- `browser:getStatus` returns supervisor status;
- `app:getVersions` returns app/browser/extension strings.

Run:

```bash
pnpm -F desktop test -- src/main/DesktopBridge.test.ts
```

Expected: fail because `DesktopBridge.ts` does not exist.

- [ ] **Step 2: Implement main bridge registration**

Export:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserResources } from './BrowserResources'
import type { BrowserSupervisor, BrowserStatus } from './BrowserSupervisor'

export interface IpcMainLike {
	handle(channel: string, handler: (...args: unknown[]) => unknown): void
}

export interface DesktopBridgeOptions {
	ipcMain: IpcMainLike
	supervisor: BrowserSupervisor
	resources: BrowserResources
	getAppVersion: () => string
	sendStatus: (status: BrowserStatus) => void
}

export function registerDesktopBridge(options: DesktopBridgeOptions): () => void
```

Behavior:

- register handlers for `browser:launch`, `browser:getStatus`, `app:getVersions`;
- subscribe to `supervisor.onStatusChange(sendStatus)`;
- return an unregister function from the supervisor subscription;
- read extension version from `${resources.extensionDir()}/manifest.json`, returning `"unknown"` when missing or invalid.

- [ ] **Step 3: Verify bridge tests**

```bash
pnpm -F desktop test -- src/main/DesktopBridge.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
pnpm -F desktop test
git add apps/desktop/src/main/DesktopBridge.ts apps/desktop/src/main/DesktopBridge.test.ts
git commit -m "feat(desktop): register typed desktop IPC bridge"
```

## Task 4: Preload bridge surface and renderer types

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/src/wenxue.d.ts`
- Modify: `.project.agents/docs/context/ROADMAP.md`

- [ ] **Step 1: Replace preload exposure**

Expose only:

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('wenxue', {
	browser: {
		launch: () => ipcRenderer.invoke('browser:launch'),
		getStatus: () => ipcRenderer.invoke('browser:getStatus'),
		onStatusChange: (cb: (status: string) => void) => {
			const listener = (_event: Electron.IpcRendererEvent, status: string) => cb(status)
			ipcRenderer.on('browser:status-changed', listener)
			return () => ipcRenderer.off('browser:status-changed', listener)
		},
	},
	app: {
		getVersions: () => ipcRenderer.invoke('app:getVersions'),
	},
})
```

Do not expose `process.versions` directly.

- [ ] **Step 2: Add renderer global types**

Create:

```ts
export type BrowserStatus = 'idle' | 'launching' | 'running' | 'error'

export interface LaunchResult {
	ok: boolean
	error?: string
}

export interface AppVersions {
	app: string
	browser: string
	extension: string
}

declare global {
	interface Window {
		wenxue: {
			browser: {
				launch(): Promise<LaunchResult>
				getStatus(): Promise<BrowserStatus>
				onStatusChange(cb: (status: BrowserStatus) => void): () => void
			}
			app: {
				getVersions(): Promise<AppVersions>
			}
		}
	}
}

export {}
```

- [ ] **Step 3: Verify preload typecheck**

```bash
pnpm -F desktop exec tsc -p tsconfig.node.json --noEmit
pnpm -F desktop exec tsc -p tsconfig.web.json --noEmit
```

Expected: pass.

- [ ] **Step 4: Commit**

Change the second M3 checkbox in `ROADMAP.md` to `[x]`, then:

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/wenxue.d.ts .project.agents/docs/context/ROADMAP.md
git commit -m "feat(desktop): expose minimal preload bridge"
```

## Task 5: ConsoleUI minimum control surface

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/strings.ts`
- Modify: `apps/desktop/src/renderer/src/index.css` only if needed for stable layout.
- Modify: `.project.agents/docs/context/ROADMAP.md`

- [ ] **Step 1: Create strings file**

Create `strings.ts`:

```ts
export const strings = {
	brand: '问学 WenXue',
	slogan: 'ask for everything',
	status: {
		idle: '未运行',
		launching: '启动中',
		running: '浏览器运行中',
		error: '启动异常',
	},
	description: {
		idle: '浏览器尚未启动。',
		launching: '正在启动 Chrome for Testing',
		running: '问学浏览器已启动。',
		error: '浏览器启动或运行异常。可重新启动，或查看日志定位原因。',
	},
	action: {
		launch: '启动浏览器',
		focus: '聚焦窗口',
		relaunch: '重新启动',
	},
	versionLabel: {
		app: 'App',
		browser: 'Browser',
		extension: 'Extension',
	},
}
```

- [ ] **Step 2: Replace App component**

Implementation rules:

- state: `status`, `versions`, `launchError`;
- on mount: call `window.wenxue.browser.getStatus()` and `window.wenxue.app.getVersions()`;
- subscribe with `onStatusChange`;
- primary action calls `window.wenxue.browser.launch()`;
- disabled while `launching`;
- if result is `{ ok: false }`, set `launchError` and status `error`;
- render brand, status card, button, and monospace footer;
- no Node imports.

Use Tailwind utility classes already available. Keep layout compact for 480 x 360.

- [ ] **Step 3: Verify renderer build**

```bash
pnpm -F desktop exec tsc -p tsconfig.web.json --noEmit
pnpm -F desktop build
```

Expected: pass.

- [ ] **Step 4: Commit**

Change the third M3 checkbox in `ROADMAP.md` to `[x]`, then:

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/strings.ts apps/desktop/src/renderer/src/index.css .project.agents/docs/context/ROADMAP.md
git commit -m "feat(desktop): render launch console minimum state"
```

## Task 6: MainBootstrap lifecycle and entrypoint

**Files:**
- Create: `apps/desktop/src/main/MainBootstrap.ts`
- Create: `apps/desktop/src/main/MainBootstrap.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `.project.agents/docs/context/ROADMAP.md`

- [ ] **Step 1: Write RED tests for close prompt helper**

In `MainBootstrap.test.ts`, test a pure exported helper:

```ts
import { describe, expect, it, vi } from 'vitest'
import { handleBrowserRunningClose } from './MainBootstrap'

describe('handleBrowserRunningClose', () => {
	it('does not prompt when browser is idle', async () => {
		// status idle -> no dialog, no shutdown, returns "allow"
	})

	it('keeps browser running by default', async () => {
		// status running, dialog returns default button index 0 -> no shutdown
	})

	it('requests browser shutdown when user chooses close browser', async () => {
		// status running, dialog returns button index 1 -> requestShutdown called
	})
})
```

Run:

```bash
pnpm -F desktop test -- src/main/MainBootstrap.test.ts
```

Expected: fail because `MainBootstrap.ts` does not exist.

- [ ] **Step 2: Implement MainBootstrap composition**

Export `startMainBootstrap()` and `handleBrowserRunningClose()`.

Production composition:

- `const paths = new AppPaths(app.getPath('userData'))`;
- `await paths.ensure()`;
- `const logger = createAppLogger(paths)`;
- `const resources = createBrowserResources({ repoRoot: resolveRepoRoot(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath })`;
- `const profiles = new ProfileStore(paths)`;
- `const supervisor = new BrowserSupervisor({ resources, profiles, logger })`;
- create BrowserWindow with:
  - width 480, height 360;
  - resizable true, maximizable false;
  - preload path;
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
- register bridge:
  - `ipcMain`;
  - `supervisor`;
  - `resources`;
  - `getAppVersion: () => app.getVersion()`;
  - `sendStatus: (s) => win.webContents.send('browser:status-changed', s)`.

`resolveRepoRoot()` may walk upward from `app.getAppPath()` until it finds `pnpm-workspace.yaml` in dev mode. In packaged mode, it is unused by packaged resource resolution but still pass `app.getAppPath()` as a stable string.

- [ ] **Step 3: Implement close prompt behavior**

`handleBrowserRunningClose` inputs:

```ts
interface ClosePromptDeps {
	status: () => BrowserStatus
	showMessageBox: () => Promise<{ response: number }>
	requestShutdown: () => Promise<void>
}
```

Return `'allow'` or `'prevented'`.

Rules:

- `idle` / `error`: return `allow`;
- `launching` / `running`: show dialog;
- response `0` = default「仅退出问学」, do not call shutdown, return `allow`;
- response `1` =「一并关闭浏览器」, call shutdown, return `allow`.

In BrowserWindow `close` handler, call this helper after `event.preventDefault()`, then remove/guard the close handler before closing to avoid recursion.

- [ ] **Step 4: Thin `index.ts`**

Replace current Electron bootstrap with:

```ts
import { startMainBootstrap } from './MainBootstrap'

startMainBootstrap().catch((error: unknown) => {
	console.error(error)
	process.exitCode = 1
})
```

- [ ] **Step 5: Verify tests and build**

```bash
pnpm -F desktop test -- src/main/MainBootstrap.test.ts
pnpm -F desktop test
pnpm -F desktop exec tsc -p tsconfig.node.json --noEmit
pnpm -F desktop build
```

Expected: pass.

- [ ] **Step 6: Commit**

Change the fourth M3 checkbox in `ROADMAP.md` to `[x]`, then:

```bash
git add apps/desktop/src/main/MainBootstrap.ts apps/desktop/src/main/MainBootstrap.test.ts apps/desktop/src/main/index.ts .project.agents/docs/context/ROADMAP.md
git commit -m "feat(desktop): wire Electron startup lifecycle"
```

## Task 7: Dev-mode manual integration

**Files:** no code changes expected. If manual validation reveals a missed ROADMAP checkbox, stop and reconcile with the task that actually completed it instead of batching checkbox changes here.

- [ ] **Step 1: Verify extension and browser resources**

```bash
pnpm -F extension build
pnpm -F desktop fetch-browser
test -f apps/extension/.output/chrome-mv3/manifest.json
```

Expected: extension manifest exists and CfT path is printed.

- [ ] **Step 2: Run M3 automated verification**

```bash
pnpm -F desktop test
pnpm -r test
pnpm -F desktop exec tsc -p tsconfig.node.json --noEmit
pnpm -F desktop exec tsc -p tsconfig.web.json --noEmit
pnpm -F desktop build
pnpm build
```

Expected: all pass. If root `pnpm build` fails in vendor packages, return to Task 1 prerequisite remediation before claiming M3 complete.

- [ ] **Step 3: Manual launch smoke**

Run:

```bash
pnpm -F desktop dev
```

Manual checks:

- control window opens around 480 x 360;
- status initially `未运行`;
- clicking「启动浏览器」changes to `启动中` then `浏览器运行中`;
- CfT opens with the extension loaded in the toolbar;
- clicking again does not create a second long-running browser instance;
- manually closing CfT returns the UI to `未运行`;
- closing App while browser runs shows「浏览器仍在运行」dialog;
- default button exits App without killing browser;
- second branch「一并关闭浏览器」requests shutdown.

- [ ] **Step 4: Confirm ROADMAP state**

```bash
sed -n '45,55p' .project.agents/docs/context/ROADMAP.md
git status --short
```

Expected: all four M3 checkboxes are already `[x]` from Tasks 2, 4, 5, and 6; working tree is clean.

## Task 8: Execution log and closeout

**Files:**
- Create: `.project.agents/log/YYYY-MM-DD-m3-startup-chain.md`

- [ ] **Step 1: Write execution log**

Include:

- M3 scope and manual environment;
- commits for BrowserSupervisor, DesktopBridge, ConsoleUI, MainBootstrap, ROADMAP;
- automated commands and results;
- manual launch smoke result;
- any platform-specific focus/quit behavior notes;
- next step: M4 branding/default configuration.

- [ ] **Step 2: Final status and tests**

```bash
git status --short
pnpm -r test
pnpm build
```

Expected: clean working tree and both commands pass.

- [ ] **Step 3: Commit log**

```bash
git add .project.agents/log/
git commit -m "docs: M3 启动链路执行日志"
```

---

## Self-review

- **Spec coverage:** R1/R2/R3 map to Task 2; R4/R5 map to Tasks 3-4; R6 maps to Task 5; R7 maps to Task 6; R8 maps to Task 7; logging/DoD maps to Task 8.
- **Scope:** The plan does not implement M4 branding/default model/permissions, M5 packaging smoke, desktop-plugin communication, or multi-profile UI.
- **Known prerequisite:** root `pnpm build` must be fixed before M3 completion if vendor `vite` is still unavailable.
- **UI override note:** The generic `ui-design` skill's font/color restrictions are superseded here by project `UIUX.md`, which mandates semantic tokens and system font stack for this product.
