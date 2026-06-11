# M2 — 浏览器供应链与桌面底层：设计 spec

- 日期：2026-06-11
- 对应：`docs/context/ROADMAP.md` 的 Demo 工程 M2；不是 `PRD.md §8` 的产品级 M2（商业化地基）
- 上游约束：`PRD.md §5 F1/F2`、`ARCHITECTURE.md §2.1/§3.2/§5/§6`、`TECH-INFRA.md §4/§5/§8.1`
- 状态：待执行

## 1. 目标与验收

M2 要把“浏览器运行时可获得”与“桌面端无 spawn 底层模块”做成可测试基座，使 M3 只需要在其上补 `BrowserSupervisor`、IPC 与 UI。

完成后必须满足：

- `pnpm -F desktop fetch-browser` 能按 `apps/desktop/browser.lock.json` 下载 Chrome for Testing；
- 下载目标进入仓库根 `.browsers/`，不入库；
- `fetch-browser` 支持 macOS Apple Silicon、macOS Intel、Windows x64 三个平台；
- `AppPaths`、`AppLogger`、`BrowserResources`、`LaunchConfig`、`ProfileStore` 已按架构卡片实现；
- 桌面底层模块 vitest 单测全绿，至少覆盖 `LaunchConfig`、`BrowserResources`、`ProfileStore`，并对 `AppPaths`/`AppLogger` 做轻量回归；
- 不引入浏览器 spawn、IPC、ConsoleUI 改造、打包冒烟或插件品牌化。

## 2. 需求与验收标准（EARS）

### R1 — CfT lock

When a developer reads `apps/desktop/browser.lock.json`, the desktop package shall declare exactly one locked Chrome for Testing Stable version and the supported platform matrix.

Acceptance:

- lock 文件固定 `browser: "chrome"`、`channel: "stable"`、`version`、`revision`；
- lock 文件列出 `mac-arm64`、`mac-x64`、`win64`；
- lock 文件记录官方来源 URL 与更新时间，便于升级审计。

### R2 — Fetch script

When a developer runs `pnpm -F desktop fetch-browser`, the desktop package shall install the locked CfT build for the host platform.

Acceptance:

- macOS arm64 自动选择 `mac-arm64`；
- macOS x64 自动选择 `mac-x64`；
- Windows x64 自动选择 `win64`;
- unsupported host platform exits non-zero with a clear message.

### R3 — Cross-platform fetch

When a developer runs `pnpm -F desktop fetch-browser -- --platform <target>`, the script shall fetch the locked build for the specified target platform.

Acceptance:

- `<target>` accepts only `mac-arm64`、`mac-x64`、`win64`、`all`；
- `all` installs all three supported targets;
- `PUPPETEER_DOWNLOAD_BASE_URL` overrides the default CfT host for mirror usage;
- output prints target platform, locked version, install directory, and executable path.

### R4 — AppPaths

When `AppPaths` is constructed from Electron `app.getPath('userData')`, it shall ensure and expose the desktop data layout.

Acceptance:

- creates `<userData>/profiles/` and `<userData>/logs/`;
- exposes `profilesRoot(): string` and `logsDir(): string`;
- does not know browser/profile business semantics beyond paths.

### R5 — AppLogger

When desktop services write logs, `AppLogger` shall place main-process logs and browser stream logs under `AppPaths.logsDir()`.

Acceptance:

- main log resolves to `<logsDir>/main.log`;
- `attachStream(profileId, readable)` writes stream chunks to `<logsDir>/browser-<profileId>.log`;
- log scope/level/message API must not accept or require plugin-domain data.

### R6 — BrowserResources

When desktop services need runtime resources, `BrowserResources` shall compute resource paths without downloading or spawning anything.

Acceptance:

- reads `apps/desktop/browser.lock.json` for `browserVersion()`;
- in dev mode, computes CfT path under `<repo>/.browsers/chrome/<puppeteerPlatform>-<version>/...`;
- in packaged mode, computes CfT path under `process.resourcesPath/browser/...`;
- computes extension path as `apps/extension/.output/chrome-mv3` in dev and `process.resourcesPath/extension` in packaged mode;
- throws clear errors for unsupported host platforms.

### R7 — LaunchConfig

When M3 calls `buildArgv`, `LaunchConfig` shall produce the complete CfT argv list from path inputs only.

Acceptance:

- includes `--user-data-dir=<dir>`;
- includes `--load-extension=<extensionDir>`;
- includes `--no-first-run`;
- includes `--no-default-browser-check`;
- includes `--hide-crash-restore-bubble`;
- excludes `--remote-debugging-pipe` unless `debugPipe: true`;
- appends `startUrl` as the final positional argument when provided;
- performs no file IO and holds no state.

### R8 — ProfileStore

When M3 asks for the default browser profile, `ProfileStore` shall create and return a deterministic user data directory.

Acceptance:

- `ensureProfile()` returns `<profilesRoot>/default`;
- `ensureProfile(id)` creates `<profilesRoot>/<id>`;
- `listProfiles()` returns directory names only, sorted;
- profile IDs are restricted to stable directory-safe names.

## 3. Locked external baseline

The spec writing baseline was verified on 2026-06-11 against the Chrome for Testing official last-known-good endpoint and npm registry:

| Item | Value |
|---|---|
| CfT endpoint | `https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json` |
| CfT Stable timestamp | `2026-06-10T21:32:27.128Z` |
| CfT Stable version | `149.0.7827.55` |
| CfT revision | `1625079` |
| `@puppeteer/browsers` | `3.0.4` |
| `tsx` | `4.22.4` |

Lock platforms:

| User-facing platform | Puppeteer `BrowserPlatform` | Cache directory segment | Official archive |
|---|---|---|---|
| `mac-arm64` | `mac_arm` | `mac_arm-149.0.7827.55` | `chrome-mac-arm64.zip` |
| `mac-x64` | `mac` | `mac-149.0.7827.55` | `chrome-mac-x64.zip` |
| `win64` | `win64` | `win64-149.0.7827.55` | `chrome-win64.zip` |

If execution starts much later than this spec date, the implementer may re-check the official endpoint and intentionally update the lock version before Task 2. Do not silently drift the version after `browser.lock.json` is created.

## 4. Design decisions

### D1 — Programmatic browser API

Use `@puppeteer/browsers` programmatic APIs instead of wrapping the CLI. The script should import `install`, `Browser`, `BrowserPlatform`, and `computeExecutablePath`.

Reason: typed platform mapping, deterministic cache layout, easier testability later.

### D2 — `tsx` only for build-time scripts

Add `tsx` as a desktop devDependency and run:

```json
"fetch-browser": "tsx scripts/fetch-browser.ts"
```

This keeps `fetch-browser.ts` TypeScript without introducing a compiled script build step.

### D3 — Cache layout stays Puppeteer-native

Downloads live in the Puppeteer cache layout under the repo root:

```text
.browsers/
└── chrome/
    ├── mac_arm-149.0.7827.55/
    ├── mac-149.0.7827.55/
    └── win64-149.0.7827.55/
```

Do not invent a second copy layout in M2. M5 packaging can choose the correct platform folder from this cache.

### D4 — Runtime modules are small and importable

Desktop main modules should be separate files under `apps/desktop/src/main/`:

| File | Responsibility |
|---|---|
| `AppPaths.ts` | userData-derived directory layout |
| `AppLogger.ts` | main log + browser stream log sink |
| `BrowserResources.ts` | lock reading and resource path computation |
| `launchConfig.ts` | pure argv builder |
| `ProfileStore.ts` | profile directory creation/listing |

Tests live beside the unit as `*.test.ts`, per `CONVENTIONS.md §1.3`.

### D5 — BrowserResources has no resource validation

`BrowserResources` computes paths and reads the lock. It may reject unsupported platform mapping, but it must not download, spawn, or perform integrity checks. Missing binary detection belongs to M3/M5 runtime and smoke paths.

### D6 — No M1/M3 coupling

M2 may run before M1. Therefore it must not require `apps/extension/.output/chrome-mv3` to exist. Returning the expected extension path is enough. Do not edit WXT dev config in this milestone.

## 5. Non-goals

- `BrowserSupervisor` spawn, state machine, focus existing browser, or `requestShutdown()`；
- `DesktopBridge` IPC channels；
- `ConsoleUI` launch button/status cards；
- packaged-app CDP smoke test；
- plugin manifest key, branding, permission audit, default model；
- product-level commercial M2（account/gateway/billing）。

## 6. Test strategy

Required automated tests:

- `launchConfig.test.ts`: full argv, optional debug pipe, optional start URL, no IO behavior by construction;
- `BrowserResources.test.ts`: dev/prod browser binary path, extension path, lock version, unsupported platform failure;
- `ProfileStore.test.ts`: default profile creation, custom profile creation, sorted listing, invalid profile ID rejection;
- `AppPaths.test.ts`: directory creation and path getters;
- `AppLogger.test.ts`: stream attachment writes browser log chunks.

Manual/environment checks:

- `pnpm -F desktop fetch-browser -- --platform mac-arm64`;
- `pnpm -F desktop fetch-browser -- --platform mac-x64`;
- `pnpm -F desktop fetch-browser -- --platform win64`;
- `PUPPETEER_DOWNLOAD_BASE_URL=https://registry.npmmirror.com/-/binary/chrome-for-testing pnpm -F desktop fetch-browser -- --platform <one target>` when a China mirror validation is available.

Do not claim M2 complete unless `pnpm -F desktop test` and `pnpm -r test` pass after the fetch script and modules land.
