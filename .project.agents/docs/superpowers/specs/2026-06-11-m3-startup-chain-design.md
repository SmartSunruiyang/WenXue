# M3 — 启动链路打通：设计 spec

- 日期：2026-06-11
- 对应：`docs/context/ROADMAP.md` 的 Demo 工程 M3；不是 `PRD.md §8` 的产品级 M3（分发成熟）
- 上游约束：`PRD.md §5 F1/F2`、`PRD.md §6`、`ARCHITECTURE.md §1.3/§2.1/§3.2/§5/§6`、`TECH-INFRA.md §4.3/§4.4/§4.5/§9/§10`、`UIUX.md §6/§7/§9`
- 状态：待执行

## 1. 目标与验收

M3 要把 M1 的插件产物和 M2 的桌面底层模块串成一个可演示的 dev 模式启动链路：

- 用户在桌面控制台点击「启动浏览器」；
- 主进程创建默认 profile，定位 CfT 和 extension，组装 argv 并 spawn CfT；
- CfT 带 `--load-extension` 拉起问学插件；
- BrowserStatus 经 typed IPC 推送到 renderer，ConsoleUI 显示 `idle -> launching -> running -> idle/error`；
- 重复点击不创建第二个长期浏览器实例；
- 用户关闭 CfT 后状态回到 `idle`；
- 浏览器运行中关闭 App 时弹确认对话框，默认只退出问学，不强杀浏览器。

M3 完成后，ROADMAP M4 才开始品牌化、固定插件 ID、默认模型预置和权限审计。

## 2. 需求与验收标准（EARS）

### R1 — BrowserSupervisor state machine

When `BrowserSupervisor.launch()` is called from `idle` or `error`, the desktop runtime shall transition through `launching` and `running` around a spawned CfT child process.

Acceptance:

- status starts at `idle`;
- before spawn is attempted, status changes to `launching`;
- when the child process reports successful spawn, status changes to `running`;
- when the child exits normally, status changes to `idle`;
- when spawn throws or the child emits `error`, status changes to `error`;
- when the child exits with a non-zero code or signal while running, status changes to `error`;
- every status change is emitted to registered subscribers exactly once per transition.

### R2 — Single-instance discipline

While a profile is already `launching` or `running`, when `launch()` is called again, the desktop runtime shall not replace the tracked child process or create a second long-running browser instance.

Acceptance:

- `launch()` during `launching` is a no-op;
- `launch()` during `running` preserves the current tracked child process;
- `launch()` during `running` may perform a best-effort focus action by invoking CfT with the same profile and relying on Chrome ProcessSingleton; this one-shot process is not tracked as the browser instance;
- repeated launch clicks do not produce duplicate `running` events.

### R3 — Browser process logging and shutdown

When CfT is spawned, the desktop runtime shall attach browser stdout/stderr to `AppLogger`; when the user explicitly asks to close the browser, it shall request shutdown without affecting plugin data.

Acceptance:

- stdout and stderr streams are attached to `browser-default.log`;
- `requestShutdown()` only acts when a child process is tracked;
- `requestShutdown()` asks the child process to terminate and resolves after exit or after a bounded fallback timeout;
- no API key, prompt, response, or plugin IndexedDB content crosses into desktop logs or IPC.

### R4 — DesktopBridge IPC contract

When ConsoleUI talks to the main process, the only exposed bridge shall be the four channels already registered in `ARCHITECTURE.md §3.2`.

Acceptance:

- `browser:launch` invokes `BrowserSupervisor.launch()` and returns `{ ok: true }` on success;
- `browser:launch` catches errors and returns `{ ok: false, error }` with a user-safe message;
- `browser:getStatus` returns `BrowserStatus`;
- `browser:status-changed` pushes status changes from main to renderer;
- `app:getVersions` returns `{ app, browser, extension }`;
- bridge payloads contain no plugin-domain content and no API key.

### R5 — Secure preload surface

When the renderer starts, it shall access desktop capabilities only through `window.wenxue`.

Acceptance:

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` remain enabled;
- preload exposes `window.wenxue.browser.launch()`、`window.wenxue.browser.getStatus()`、`window.wenxue.browser.onStatusChange(cb)`、`window.wenxue.app.getVersions()`;
- `onStatusChange` returns an unsubscribe function;
- renderer code imports no Node/Electron module.

### R6 — ConsoleUI minimum state

When the desktop window opens, ConsoleUI shall show the UIUX-defined control surface for BrowserStatus.

Acceptance:

- desktop window uses the M3 target size around 480 x 360;
- UI shows brand area, a single status card, a primary action button, and version footer;
- `idle`: label「未运行」and button「启动浏览器」enabled;
- `launching`: label「启动中」and button disabled with inline progress indicator;
- `running`: label「浏览器运行中」and button「聚焦窗口」enabled;
- `error`: destructive status text with actions「重新启动」and「查看日志」only if log path is available; if not available, show only restart;
- all user-visible strings live in `apps/desktop/src/renderer/src/strings.ts`;
- UI logic only consumes bridge state and sends intents.

### R7 — MainBootstrap lifecycle

When Electron starts, MainBootstrap shall assemble desktop services and own app/window lifecycle without containing service internals.

Acceptance:

- `app.whenReady()` ensures `AppPaths` directories exist before services use them;
- MainBootstrap creates BrowserWindow with secure webPreferences and preload path;
- MainBootstrap registers DesktopBridge once;
- `activate` recreates the control window on macOS when no window is open;
- closing the control window while BrowserStatus is `running` or `launching` prompts the user;
- default prompt action is「仅退出问学」and leaves CfT running;
- optional prompt action「一并关闭浏览器」calls `BrowserSupervisor.requestShutdown()`;
- if browser is not running, App quits normally.

### R8 — Dev-mode integration acceptance

When M1 and M2 prerequisites are present, M3 shall be demonstrable from source.

Acceptance:

- `pnpm -F extension build` produces `apps/extension/.output/chrome-mv3`;
- `pnpm -F desktop fetch-browser` finds or downloads the locked CfT build;
- `pnpm -F desktop dev` opens the control window;
- clicking launch opens CfT with the extension loaded;
- manually closing CfT returns ConsoleUI status to `idle`;
- repeated launch clicks do not open duplicate browser windows for the same profile.

## 3. Design decisions

### D1 — BrowserSupervisor is dependency-injected for tests

`BrowserSupervisor` should be a class with injected dependencies:

- `BrowserResources`
- `ProfileStore`
- `AppLogger`
- `buildArgv`
- `spawnBrowser`
- optional `focusExisting`

Production uses `child_process.spawn`; tests use a fake EventEmitter child. This keeps the state machine unit-testable without launching CfT.

### D2 — Focus existing uses CfT ProcessSingleton as best effort

M3 has no stable cross-platform browser-window handle. The best local strategy is:

- keep the tracked child untouched;
- when status is `running`, invoke a one-shot CfT process with the same `--user-data-dir` and `--load-extension`;
- let Chrome ProcessSingleton focus the existing window and immediately terminate the one-shot process.

This satisfies I1 because the tracked browser instance remains single and CfT prevents a second long-running instance. M3 must document this as best effort. If it is unreliable on a platform, it becomes a M5 smoke/manual validation issue, not a reason to add desktop-plugin communication.

### D3 — DesktopBridge main registration is testable without Electron globals

The main-process bridge registration should accept small adapter interfaces for `ipcMain`, status broadcasting, app version, and extension version lookup. Production adapters wrap Electron. Tests provide fakes.

### D4 — Version footer reads extension manifest only

`app:getVersions` can obtain:

- `app`: `app.getVersion()`;
- `browser`: `BrowserResources.browserVersion()`;
- `extension`: parse `manifest.json` under `BrowserResources.extensionDir()`.

If the extension manifest is missing in dev mode, return `"unknown"` and let `browser:launch` report the actual launch failure. Do not add a runtime dependency from desktop to extension source code.

### D5 — ConsoleUI remains operational, not marketing

The control window follows the [unified UIUX desktop rules](../../context/UIUX.md#7-桌面窗口与页面): content-first hierarchy, real status, familiar controls, and shared semantic tokens. Do not add marketing copy or a separate visual system.

### D6 — MainBootstrap owns Electron lifecycle only

`MainBootstrap` may compose modules and wire events, but it must not implement spawn logic, argv construction, resource lookup, logging, or renderer behavior. If lifecycle handling needs helpers, keep them private to `MainBootstrap.ts` unless `ARCHITECTURE.md` is updated first.

## 4. File layout

Expected implementation files:

| File                                              | Responsibility                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/desktop/src/main/BrowserSupervisor.ts`      | BrowserStatus state machine, spawn, exit/error handling, requestShutdown |
| `apps/desktop/src/main/BrowserSupervisor.test.ts` | state-machine tests with fake child process                              |
| `apps/desktop/src/main/DesktopBridge.ts`          | main-process IPC handlers and status forwarding                          |
| `apps/desktop/src/main/DesktopBridge.test.ts`     | IPC contract tests with fake ipcMain/supervisor/resources                |
| `apps/desktop/src/main/MainBootstrap.ts`          | Electron app/window lifecycle and module assembly                        |
| `apps/desktop/src/main/MainBootstrap.test.ts`     | close-prompt helper/lifecycle tests where practical                      |
| `apps/desktop/src/main/index.ts`                  | thin entrypoint calling MainBootstrap                                    |
| `apps/desktop/src/preload/index.ts`               | contextBridge exposure for `window.wenxue`                               |
| `apps/desktop/src/renderer/src/App.tsx`           | ConsoleUI state card/button/footer                                       |
| `apps/desktop/src/renderer/src/strings.ts`        | desktop user-visible copy                                                |
| `apps/desktop/src/renderer/src/wenxue.d.ts`       | renderer global bridge types                                             |

Do not add files outside these modules unless an upstream doc is updated first.

## 5. Non-goals

- M4 branding, icons, locales, manifest `key`, default model, permission audit;
- M5 packaged-app CDP smoke test、安装包与更新分发；当前 Electron 的 `manual-unsigned` 下载/打开流程以
  2026-07-17 desktop update spec 为准；
- desktop-plugin runtime communication;
- cloud account, LLM gateway, billing;
- multi-profile UI or multiple simultaneous browser instances;
- runtime plugin-load auto-repair.

## 6. Test strategy

Automated tests:

- `BrowserSupervisor.test.ts`:
  - initial status;
  - `idle -> launching -> running`;
  - normal exit -> `idle`;
  - spawn error and non-zero exit -> `error`;
  - duplicate launch behavior while `launching`/`running`;
  - `requestShutdown()` kills tracked child and settles on exit;
  - stdout/stderr attach to logger.
- `DesktopBridge.test.ts`:
  - exactly four channel names are registered/used;
  - `browser:launch` success and failure payloads;
  - `browser:getStatus`;
  - status event broadcast;
  - versions response with missing manifest fallback.
- `MainBootstrap.test.ts`:
  - close prompt is needed only while launching/running;
  - default prompt path does not call `requestShutdown`;
  - explicit close-browser path calls `requestShutdown`.
- Existing M2 tests remain green.

Manual/dev validation:

- `pnpm -F extension build`;
- `pnpm -F desktop fetch-browser`;
- `pnpm -F desktop dev`;
- click launch and confirm CfT opens with extension loaded;
- repeat launch click and confirm no duplicate browser instance;
- close CfT manually and confirm UI returns to `idle`;
- close App while browser runs and confirm both dialog branches.

## 7. Preconditions and known blockers

M3 depends on M1 and M2. Before implementation starts:

- `pnpm -r test` must pass;
- `pnpm -F extension build` must pass;
- `pnpm -F desktop fetch-browser` must pass;
- `pnpm -F desktop build` must pass;
- root `pnpm build` should pass before claiming full roadmap DoD.

As of the M2 execution log, root `pnpm build` was observed failing in vendor package build scripts with `vite: command not found` for `packages/core` / `packages/page-controller` / `packages/ui`. If still present, fix that M1/vendor build issue before starting M3 implementation or record explicit user approval to proceed with M3-only validation.
