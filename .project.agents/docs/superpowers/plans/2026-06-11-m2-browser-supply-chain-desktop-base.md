# M2 — 浏览器供应链与桌面底层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ROADMAP Demo M2: locked Chrome for Testing download plus desktop base modules (`AppPaths`、`AppLogger`、`BrowserResources`、`LaunchConfig`、`ProfileStore`) with focused tests.

**Architecture:** Keep browser supply-chain work in `apps/desktop/scripts/fetch-browser.ts` and runtime path/module work in small `apps/desktop/src/main/*` units that match `ARCHITECTURE.md §2.1`. Do not implement browser spawn, IPC, renderer UI, or extension branding; M3 consumes these modules.

**Tech Stack:** Node 22 · pnpm 9 · Electron main process · TypeScript strict · vitest · `@puppeteer/browsers@^3.0.4` · `tsx@^4.22.4`

**Spec:** `../specs/2026-06-11-m2-browser-supply-chain-desktop-base.md`

---

## File Map

- Create: `apps/desktop/browser.lock.json` — locked CfT Stable build and platform matrix.
- Create: `apps/desktop/scripts/fetch-browser.ts` — build-time CfT downloader.
- Modify: `apps/desktop/package.json` — add `fetch-browser` script and dependencies.
- Create: `apps/desktop/src/main/AppPaths.ts` + `AppPaths.test.ts`.
- Create: `apps/desktop/src/main/AppLogger.ts` + `AppLogger.test.ts`.
- Create: `apps/desktop/src/main/BrowserResources.ts` + `BrowserResources.test.ts`.
- Create: `apps/desktop/src/main/launchConfig.ts` + `launchConfig.test.ts`.
- Create: `apps/desktop/src/main/ProfileStore.ts` + `ProfileStore.test.ts`.
- Modify: `.project.agents/docs/context/ROADMAP.md` — tick M2 checkboxes only in the commits that complete them.
- Create: `.project.agents/log/YYYY-MM-DD-m2-browser-supply-chain-desktop-base.md` — execution log after milestone completion.

## Task 1: Preflight gate

**Files:** read-only.

- [ ] **Step 1: Confirm M0 baseline and current branch state**

```bash
git status --short
pnpm -v
node -v
pnpm -F desktop test
```

Expected:

- Node is `v22.x`;
- pnpm is `9.x`;
- existing desktop tests pass or report no tests before M2 tests are added;
- if `git status --short` shows unrelated dirty work, stop and ask the user how to isolate it. Do not stack M2 implementation on unrelated work.

- [ ] **Step 2: Re-read source-of-truth sections**

Read these before editing:

```bash
sed -n '40,45p' .project.agents/docs/context/ROADMAP.md
sed -n '44,110p' .project.agents/docs/context/ARCHITECTURE.md
sed -n '240,266p' .project.agents/docs/context/ARCHITECTURE.md
sed -n '143,156p' .project.agents/docs/context/TECH-INFRA.md
```

Expected: confirms M2 scope is supply chain + no-spawn desktop base modules only.

## Task 2: Lock CfT and add desktop script dependencies

**Files:**
- Create: `apps/desktop/browser.lock.json`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Optionally re-check the official Stable version**

```bash
node -e "fetch('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json').then(r=>r.json()).then(j=>console.log(JSON.stringify({timestamp:j.timestamp, stable:j.channels.Stable.version, revision:j.channels.Stable.revision}, null, 2)))"
```

Expected at spec-writing time:

```json
{
  "timestamp": "2026-06-10T21:32:27.128Z",
  "stable": "149.0.7827.55",
  "revision": "1625079"
}
```

If the value differs and the user wants the newer Stable, update all `149.0.7827.55` / `1625079` occurrences in this task before continuing.

- [ ] **Step 2: Create `apps/desktop/browser.lock.json`**

```json
{
  "browser": "chrome",
  "channel": "stable",
  "version": "149.0.7827.55",
  "revision": "1625079",
  "source": {
    "lastKnownGoodVersionsWithDownloads": "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json",
    "timestamp": "2026-06-10T21:32:27.128Z"
  },
  "platforms": [
    {
      "name": "mac-arm64",
      "puppeteerPlatform": "mac_arm",
      "archive": "chrome-mac-arm64.zip"
    },
    {
      "name": "mac-x64",
      "puppeteerPlatform": "mac",
      "archive": "chrome-mac-x64.zip"
    },
    {
      "name": "win64",
      "puppeteerPlatform": "win64",
      "archive": "chrome-win64.zip"
    }
  ]
}
```

- [ ] **Step 3: Update `apps/desktop/package.json`**

Add script:

```json
"fetch-browser": "tsx scripts/fetch-browser.ts"
```

Add dependencies:

```json
"@puppeteer/browsers": "^3.0.4"
```

Add devDependencies:

```json
"tsx": "^4.22.4"
```

Keep existing scripts and dependency versions unchanged unless `pnpm install` forces a lock-only resolution.

- [ ] **Step 4: Install and verify package metadata**

```bash
pnpm install
node -e "const p=require('./apps/desktop/package.json'); console.log(p.scripts['fetch-browser'], p.dependencies['@puppeteer/browsers'], p.devDependencies.tsx)"
```

Expected output contains:

```text
tsx scripts/fetch-browser.ts ^3.0.4 ^4.22.4
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json apps/desktop/browser.lock.json pnpm-lock.yaml
git commit -m "build(desktop): lock Chrome for Testing download baseline"
```

Do not tick ROADMAP M2 yet; the script is not implemented.

## Task 3: Implement `fetch-browser`

**Files:**
- Create: `apps/desktop/scripts/fetch-browser.ts`
- Modify: `.project.agents/docs/context/ROADMAP.md`

- [ ] **Step 1: Create the script**

Implementation requirements:

- parse `--platform <mac-arm64|mac-x64|win64|all>`;
- default to host platform when `--platform` is omitted;
- use `install({ browser: Browser.CHROME, buildId: lock.version, platform, cacheDir })`;
- pass `baseUrl: process.env.PUPPETEER_DOWNLOAD_BASE_URL` only when the env var is set;
- print the installed path and executable path for each target;
- exit non-zero with a clear message for unsupported platforms.

Core structure:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	Browser,
	BrowserPlatform,
	computeExecutablePath,
	install,
} from '@puppeteer/browsers'
import lock from '../browser.lock.json'

type TargetPlatform = 'mac-arm64' | 'mac-x64' | 'win64'

const TARGETS: Record<TargetPlatform, BrowserPlatform> = {
	'mac-arm64': BrowserPlatform.MAC_ARM,
	'mac-x64': BrowserPlatform.MAC,
	win64: BrowserPlatform.WIN64,
}

function hostTarget(): TargetPlatform {
	if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64'
	if (process.platform === 'darwin' && process.arch === 'x64') return 'mac-x64'
	if (process.platform === 'win32' && process.arch === 'x64') return 'win64'
	throw new Error(`Unsupported host platform: ${process.platform}/${process.arch}`)
}

function requestedTargets(argv: string[]): TargetPlatform[] {
	const index = argv.indexOf('--platform')
	const value = index >= 0 ? argv[index + 1] : undefined
	if (!value) return [hostTarget()]
	if (value === 'all') return ['mac-arm64', 'mac-x64', 'win64']
	if (value in TARGETS) return [value as TargetPlatform]
	throw new Error(`Unsupported --platform "${value}". Use mac-arm64, mac-x64, win64, or all.`)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const cacheDir = path.join(repoRoot, '.browsers')
const baseUrl = process.env.PUPPETEER_DOWNLOAD_BASE_URL || undefined

for (const target of requestedTargets(process.argv.slice(2))) {
	const platform = TARGETS[target]
	const installed = await install({
		browser: Browser.CHROME,
		buildId: lock.version,
		platform,
		cacheDir,
		baseUrl,
		downloadProgressCallback: 'default',
	})
	const executablePath = computeExecutablePath({
		cacheDir,
		browser: Browser.CHROME,
		buildId: lock.version,
		platform,
	})
	console.log(`[fetch-browser] ${target} chrome@${lock.version}`)
	console.log(`[fetch-browser] installDir=${installed.path}`)
	console.log(`[fetch-browser] executable=${executablePath}`)
}
```

Wrap the loop in a top-level `try/catch` or append `.catch(...)` so errors print only the message and exit `1`.

- [ ] **Step 2: Run a metadata-only syntax check**

```bash
pnpm -F desktop exec tsx scripts/fetch-browser.ts --platform nope
```

Expected: exits non-zero and prints:

```text
Unsupported --platform "nope". Use mac-arm64, mac-x64, win64, or all.
```

- [ ] **Step 3: Download supported targets**

Run each target independently:

```bash
pnpm -F desktop fetch-browser -- --platform mac-arm64
pnpm -F desktop fetch-browser -- --platform mac-x64
pnpm -F desktop fetch-browser -- --platform win64
```

Expected: each command prints `chrome@149.0.7827.55`, an install dir under `.browsers/chrome/`, and an executable path. On slow networks, run one platform first and record any skipped platforms in the execution log.

- [ ] **Step 4: Verify cache layout**

```bash
find .browsers/chrome -maxdepth 2 -type d | sort | sed -n '1,40p'
```

Expected contains the downloaded target directories, for example:

```text
.browsers/chrome/mac_arm-149.0.7827.55
.browsers/chrome/mac-149.0.7827.55
.browsers/chrome/win64-149.0.7827.55
```

- [ ] **Step 5: Tick ROADMAP M2 supply-chain checkbox and commit**

Change only the first M2 checkbox in `ROADMAP.md` from `[ ]` to `[x]`, then:

```bash
git add apps/desktop/scripts/fetch-browser.ts .project.agents/docs/context/ROADMAP.md
git commit -m "feat(desktop): fetch locked Chrome for Testing builds"
```

## Task 4: Implement `LaunchConfig` with tests

**Files:**
- Create: `apps/desktop/src/main/launchConfig.ts`
- Create: `apps/desktop/src/main/launchConfig.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

```ts
import { describe, expect, it } from 'vitest'
import { buildArgv } from './launchConfig'

describe('buildArgv', () => {
	it('builds the default Chrome for Testing argv', () => {
		expect(
			buildArgv({
				userDataDir: '/tmp/wenxue-profile',
				extensionDir: '/tmp/wenxue-extension',
			}),
		).toEqual([
			'--user-data-dir=/tmp/wenxue-profile',
			'--load-extension=/tmp/wenxue-extension',
			'--no-first-run',
			'--no-default-browser-check',
			'--hide-crash-restore-bubble',
		])
	})

	it('adds remote debugging pipe only when requested', () => {
		expect(
			buildArgv({
				userDataDir: '/profile',
				extensionDir: '/extension',
				debugPipe: true,
			}),
		).toContain('--remote-debugging-pipe')
	})

	it('appends startUrl as the final positional argument', () => {
		const argv = buildArgv({
			userDataDir: '/profile',
			extensionDir: '/extension',
			startUrl: 'https://example.com',
		})
		expect(argv.at(-1)).toBe('https://example.com')
	})
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm -F desktop test -- src/main/launchConfig.test.ts
```

Expected: fails because `launchConfig` does not exist.

- [ ] **Step 3: Implement minimal pure function**

```ts
export interface LaunchOptions {
	userDataDir: string
	extensionDir: string
	startUrl?: string
	debugPipe?: boolean
}

export function buildArgv(opts: LaunchOptions): string[] {
	const argv = [
		`--user-data-dir=${opts.userDataDir}`,
		`--load-extension=${opts.extensionDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--hide-crash-restore-bubble',
	]

	if (opts.debugPipe) {
		argv.push('--remote-debugging-pipe')
	}

	if (opts.startUrl) {
		argv.push(opts.startUrl)
	}

	return argv
}
```

- [ ] **Step 4: Verify**

```bash
pnpm -F desktop test -- src/main/launchConfig.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/launchConfig.ts apps/desktop/src/main/launchConfig.test.ts
git commit -m "feat(desktop): add pure Chrome launch argv builder"
```

## Task 5: Implement `AppPaths` and `ProfileStore` with tests

**Files:**
- Create: `apps/desktop/src/main/AppPaths.ts`
- Create: `apps/desktop/src/main/AppPaths.test.ts`
- Create: `apps/desktop/src/main/ProfileStore.ts`
- Create: `apps/desktop/src/main/ProfileStore.test.ts`

- [ ] **Step 1: Write `AppPaths` tests**

Cover:

- `profilesRoot()` returns `<tmp>/profiles`;
- `logsDir()` returns `<tmp>/logs`;
- `ensure()` creates both directories.

- [ ] **Step 2: Implement `AppPaths`**

API:

```ts
export class AppPaths {
	constructor(private readonly userDataDir: string) {}
	profilesRoot(): string
	logsDir(): string
	ensure(): Promise<void>
}
```

Implementation: use `path.join` and `fs.promises.mkdir(..., { recursive: true })`.

- [ ] **Step 3: Write `ProfileStore` tests**

Cover:

- `ensureProfile()` creates and returns `<profilesRoot>/default`;
- `ensureProfile('research')` creates and returns `<profilesRoot>/research`;
- `listProfiles()` returns sorted directory names only;
- `ensureProfile('../escape')` rejects.

- [ ] **Step 4: Implement `ProfileStore`**

API:

```ts
import path from 'node:path'
import { mkdir, readdir } from 'node:fs/promises'
import { AppPaths } from './AppPaths'

const PROFILE_ID = /^[a-zA-Z0-9_-]+$/

export class ProfileStore {
	constructor(private readonly paths: AppPaths) {}
	async ensureProfile(id = 'default'): Promise<string>
	listProfiles(): string[]
}
```

Implementation notes:

- keep the validation inside a private `profileDir(id)` method;
- `listProfiles()` may use sync FS APIs to preserve `ARCHITECTURE.md §3.2` signature;
- filter to directories only and sort ascending.

- [ ] **Step 5: Verify**

```bash
pnpm -F desktop test -- src/main/AppPaths.test.ts src/main/ProfileStore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/AppPaths.ts apps/desktop/src/main/AppPaths.test.ts apps/desktop/src/main/ProfileStore.ts apps/desktop/src/main/ProfileStore.test.ts
git commit -m "feat(desktop): add app data paths and profile store"
```

## Task 6: Implement `BrowserResources` with tests

**Files:**
- Create: `apps/desktop/src/main/BrowserResources.ts`
- Create: `apps/desktop/src/main/BrowserResources.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- `browserVersion()` returns `149.0.7827.55`;
- dev `browserBinary()` points under `.browsers/chrome/mac_arm-149.0.7827.55/...` for `darwin/arm64`;
- packaged `browserBinary()` points under `<resourcesPath>/browser/chrome-mac-arm64/...`;
- dev `extensionDir()` is `<repo>/apps/extension/.output/chrome-mv3`;
- packaged `extensionDir()` is `<resourcesPath>/extension`;
- unsupported platform rejects with `Unsupported browser platform`.

- [ ] **Step 2: Implement platform mapping**

Use a small mapping that separates user-facing platform names from Puppeteer enum values:

```ts
import { Browser, BrowserPlatform, computeExecutablePath } from '@puppeteer/browsers'

export function resolveBrowserPlatform(platform = process.platform, arch = process.arch): BrowserPlatform {
	if (platform === 'darwin' && arch === 'arm64') return BrowserPlatform.MAC_ARM
	if (platform === 'darwin' && arch === 'x64') return BrowserPlatform.MAC
	if (platform === 'win32' && arch === 'x64') return BrowserPlatform.WIN64
	throw new Error(`Unsupported browser platform: ${platform}/${arch}`)
}
```

- [ ] **Step 3: Implement resource factory**

API:

```ts
export interface BrowserResourcesOptions {
	repoRoot: string
	isPackaged?: boolean
	resourcesPath?: string
	platform?: NodeJS.Platform
	arch?: NodeJS.Architecture
}

export interface BrowserResources {
	browserBinary(): string
	extensionDir(): string
	browserVersion(): string
}

export function createBrowserResources(options: BrowserResourcesOptions): BrowserResources
```

Implementation rules:

- read lock with JSON import from `../../browser.lock.json`;
- dev executable = `computeExecutablePath({ cacheDir: path.join(repoRoot, '.browsers'), browser: Browser.CHROME, buildId: lock.version, platform })`;
- packaged executable = `path.join(resourcesPath, 'browser', computeExecutablePath({ cacheDir: null, browser: Browser.CHROME, buildId: lock.version, platform }))`;
- dev extension path = `path.join(repoRoot, 'apps/extension/.output/chrome-mv3')`;
- packaged extension path = `path.join(resourcesPath, 'extension')`;
- if `isPackaged` is true and `resourcesPath` is missing, throw `resourcesPath is required in packaged mode`.

- [ ] **Step 4: Verify**

```bash
pnpm -F desktop test -- src/main/BrowserResources.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/BrowserResources.ts apps/desktop/src/main/BrowserResources.test.ts
git commit -m "feat(desktop): resolve browser and extension resources"
```

## Task 7: Implement `AppLogger` with tests

**Files:**
- Create: `apps/desktop/src/main/AppLogger.ts`
- Create: `apps/desktop/src/main/AppLogger.test.ts`

- [ ] **Step 1: Write stream log test**

Test should:

- create a temp `AppPaths`;
- call `paths.ensure()`;
- call `attachStream('default', Readable.from(['hello\n', 'world\n']))`;
- wait for the stream to finish;
- assert `<logsDir>/browser-default.log` contains both chunks.

- [ ] **Step 2: Implement logger**

API:

```ts
import type { Readable } from 'node:stream'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppLogger {
	log(scope: string, level: LogLevel, message: string): void
	attachStream(profileId: string, readable: Readable): void
}

export function createAppLogger(paths: AppPaths): AppLogger
```

Implementation rules:

- import `electron-log/main` for main-process log calls;
- set `log.transports.file.resolvePathFn` to `<logsDir>/main.log`;
- prefix main messages as `[scope] message`;
- `attachStream` writes to `browser-<profileId>.log` with `{ flags: 'a' }`;
- do not parse or inspect log content.

- [ ] **Step 3: Verify**

```bash
pnpm -F desktop test -- src/main/AppLogger.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/AppLogger.ts apps/desktop/src/main/AppLogger.test.ts
git commit -m "feat(desktop): add app and browser log sinks"
```

## Task 8: M2 aggregate verification

**Files:**
- Modify: `.project.agents/docs/context/ROADMAP.md`

- [ ] **Step 1: Run desktop tests**

```bash
pnpm -F desktop test
```

Expected: all desktop tests PASS.

- [ ] **Step 2: Run workspace tests**

```bash
pnpm -r test
```

Expected: all workspace tests PASS. If M1 is not present yet, this should still pass for the packages currently in the workspace.

- [ ] **Step 3: Run build**

```bash
pnpm build
```

Expected: Electron build succeeds.

- [ ] **Step 4: Tick ROADMAP M2 desktop-module checkbox and commit**

Change only the second M2 checkbox in `ROADMAP.md` from `[ ]` to `[x]`, then:

```bash
git add .project.agents/docs/context/ROADMAP.md
git commit -m "docs: ROADMAP M2 desktop base modules complete"
```

## Task 9: Execution log and milestone closeout

**Files:**
- Create: `.project.agents/log/YYYY-MM-DD-m2-browser-supply-chain-desktop-base.md`

- [ ] **Step 1: Write execution log**

Use `.project.agents/log/README.md` format. Include:

- M2 scope;
- commits from Task 2 through Task 8;
- downloaded platform results and any skipped platform with reason;
- tests and build commands run;
- architecture/doc status (`ARCHITECTURE.md` unchanged if no signatures changed; `ROADMAP.md` M2 ticked);
- next step: M3 startup chain after M1 and M2 are both complete.

- [ ] **Step 2: Final status check**

```bash
git status --short
pnpm -r test
```

Expected: clean working tree and tests PASS.

- [ ] **Step 3: Commit log**

```bash
git add .project.agents/log/
git commit -m "docs: M2 browser supply chain execution log"
```

---

## Self-review

- **Spec coverage:** R1/R2/R3 map to Tasks 2–3; R4/R8 map to Task 5; R5 maps to Task 7; R6 maps to Task 6; R7 maps to Task 4; testing/DoD maps to Tasks 8–9.
- **Scope:** The plan intentionally does not implement `BrowserSupervisor`, `DesktopBridge`, `ConsoleUI`, WXT dev config, packaging smoke tests, or plugin branding.
- **External baselines:** CfT `149.0.7827.55`, revision `1625079`, `@puppeteer/browsers@^3.0.4`, and `tsx@^4.22.4` are fixed in the spec and re-checkable in Task 2.
- **No placeholders:** The only date-like placeholder is the execution-log filename `YYYY-MM-DD`, which is generated at execution time by the log convention.
