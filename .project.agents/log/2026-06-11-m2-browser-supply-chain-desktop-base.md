# M2 浏览器供应链与桌面底层完成

- **日期**：2026-06-11
- **关联**：ROADMAP M2 — 浏览器供应链与桌面底层；M2 spec/plan
- **会话上下文**：从已写好的 M2 spec/plan 接手，执行 `apps/desktop` 的 CfT 供应链与 L0-L3 无 spawn 模块

## 做了什么

- 新增 `apps/desktop/browser.lock.json`，锁定 Chrome for Testing Stable `149.0.7827.55`（revision `1625079`）。
- 新增 `apps/desktop/scripts/fetch-browser.ts`，通过 `@puppeteer/browsers` 下载 CfT，支持 host 自动选择、`--platform mac-arm64|mac-x64|win64|all` 与 `PUPPETEER_DOWNLOAD_BASE_URL`。
- 下载并验证三平台 CfT 缓存：
  - `mac-arm64` → `.browsers/chrome/mac_arm-149.0.7827.55`
  - `mac-x64` → `.browsers/chrome/mac-149.0.7827.55`
  - `win64` → `.browsers/chrome/win64-149.0.7827.55`
- 按 ARCHITECTURE §2.1 实现桌面底层模块：
  - `AppPaths`
  - `AppLogger`
  - `BrowserResources`
  - `launchConfig`
  - `ProfileStore`
- 为上述模块新增同目录 vitest 单测，共 5 个测试文件、16 个测试。
- 勾选 ROADMAP M2 两个复选框。

## 提交

- `120d425` docs: M2 浏览器供应链与桌面底层 spec/plan
- `7734c96` feat(desktop): fetch locked Chrome for Testing builds
- `142fd36` feat(desktop): add pure Chrome launch argv builder
- `22abefb` feat(desktop): add app data paths and profile store
- `2b2378f` feat(desktop): resolve browser and extension resources
- `4764763` feat(desktop): add app and browser log sinks
- `093d02a` fix(desktop): load browser lock without composite json import
- `e8af9b3` docs: ROADMAP M2 桌面底层模块完成

## 状态变更

- ARCHITECTURE：未改。新增代码均落在已登记模块与目录内；未新增依赖方向。
- PRD / UIUX：未改。M2 仅实现 Demo F1/F2 的底层支撑，不改变产品行为。
- ROADMAP：M2 两项已勾选。
- 供应链：`.browsers/` 已缓存三平台 CfT，目录被 `.gitignore` 忽略。

## 验证

- `pnpm -F desktop fetch-browser -- --platform mac-arm64`：通过。
- `pnpm -F desktop fetch-browser -- --platform mac-x64`：通过。
- `pnpm -F desktop fetch-browser -- --platform win64`：通过。
- `pnpm -F desktop fetch-browser`：通过（host = mac-arm64，命中缓存）。
- `pnpm -F desktop test`：通过，5 files / 16 tests。
- `pnpm -F desktop exec tsc -p tsconfig.node.json --noEmit`：通过。
- `pnpm -F desktop build`：通过。
- `pnpm -r test`：通过，当前 workspace 执行 6/7 projects；desktop 16 tests + llms 58 tests。
- `pnpm build`：失败，失败点不在 M2：
  - `packages/core build: sh: vite: command not found`
  - `packages/page-controller build: sh: vite: command not found`
  - `packages/ui build: sh: vite: command not found`

## 下一步

- 进入 M3 前，先解决 vendor 包 build 脚本依赖 `vite` 不可用的问题，确保根 `pnpm build` 恢复为全绿。
- M3 可在 M1 + M2 均稳定后实现 `BrowserSupervisor`、`DesktopBridge`、`ConsoleUI` 和 `MainBootstrap` 启动链路。
