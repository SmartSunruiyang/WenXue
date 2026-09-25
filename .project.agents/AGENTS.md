# Repository Guidelines

## Authority & Required Reading

Rules in `.project.agents/CLAUDE.md` apply to every agent working here. Direct user instructions still take precedence.

The canonical contributor guide is `.project.agents/AGENTS.md`. Do not create or maintain a root-level `AGENTS.md` unless the user explicitly asks for one.

Before any code-changing task, read `.project.agents/SELF_CONSTRAINTS.md` and `.project.agents/VIBECODING_GUIDE.md`, then run `git status --short`. For work on the current Electron + Chrome for Testing runtime, also read the relevant documents under `.project.agents/docs/context/`.

`.project.agents/docs/context/` is the authoritative current domain for the maintained Electron + built-in CfT + extension + CloudBase product. `docs/refactor/ai-browser/` preserves the superseded Chromium AI browser proposal as historical material; it is not an active target or synchronization domain. The current PRD and engineering documents in `docs/context/` govern current work.

## Superpowers Specs & Plans

By default, Superpowers-generated specs and implementation plans live under `.project.agents/docs/superpowers/`.

- Specs go in `.project.agents/docs/superpowers/specs/` and use `YYYY-MM-DD-<topic>-design.md`.
- Plans go in `.project.agents/docs/superpowers/plans/` and use `YYYY-MM-DD-<topic>.md`.
- Do not create or use `.project.agents/specs/`, `.project.agents/plans/`, root-level `docs/superpowers/`, or `.project.agents/docs/context/` for Superpowers specs/plans.
- Plans should reference sibling specs with paths relative to the plan file, for example `../specs/YYYY-MM-DD-<topic>-design.md`.
- Historical note: AI browser refactor documents remain under `.project.agents/docs/refactor/ai-browser/` as superseded historical material. The dated files under `docs/superpowers/` are compatibility pointers only and must not regain duplicate bodies.

## Project Structure & Module Organization

`问学 WenXue` ("WenXue — ask for everything") is currently a cross-platform Electron launcher that ships a bundled Chrome for Testing browser and injects the WenXue MV3 extension (an LLM web-operation agent forked from alibaba/page-agent, MIT). It is a pnpm monorepo: application code lives in `apps/` (`desktop`, `extension`); vendored upstream libraries live in `packages/` (`@page-agent/ui`, `llms`, `page-controller`, `core`). Tests are co-located `*.test.ts` files next to the unit under test.

The maintained product is the existing Electron + built-in Chrome for Testing + extension + CloudBase system. Its current requirements and engineering baseline live in `.project.agents/docs/context/`. The former Chromium AI browser proposal in `.project.agents/docs/refactor/ai-browser/` is historical and does not authorize implementation.

The current runtime architecture is documented in `docs/context/ARCHITECTURE.md`: a desktop domain (AppPaths/AppLogger → BrowserResources → LaunchConfig → ProfileStore/BrowserSupervisor → DesktopBridge → ConsoleUI → MainBootstrap) and an extension domain (vendored `@page-agent/*` → MultiPageAgent + SidepanelApp → ExtensionEntrypoints); the two process domains share **no runtime dependency edge** (legacy invariant I3).

## Source-of-Truth Rules

`docs/context/PRD.md`, `ARCHITECTURE.md`, `TECH-INFRA.md`, `ROADMAP.md`, `CONVENTIONS.md`, and `UIUX.md` define the current product and engineering baseline. The archived refactor proposal is retained for historical reference only. Derived documents follow the current context domain's source-of-truth hierarchy, not the other way around.

Current product feature changes must update `docs/context/PRD.md` and relevant engineering documents. Module, dependency, entity, or invariant changes must update the current `ARCHITECTURE.md` in the same commit. Do not let code and architecture drift for more than 24 hours.

## Build, Test, and Development Commands

```sh
# Build
pnpm build

# Test
pnpm -r test
```

Requires Node 22 LTS and pnpm 9 (declared via `packageManager`). Root aggregate scripts land with ROADMAP M0 — before M0 completes they do not exist yet, which is expected. Use `pnpm -F <pkg> <script>` for per-package work (e.g. `pnpm -F desktop fetch-browser`, `pnpm -F extension build`). Browser binaries are fetched at build time into the gitignored `.browsers/`; in China set `PUPPETEER_DOWNLOAD_BASE_URL=https://registry.npmmirror.com/-/binary/chrome-for-testing`.

## Architecture & Coding Style

Use TypeScript in strict mode, tab indentation with single quotes, no semicolons, and 100-column lines (Prettier config inherited from upstream page-agent; never hand-format). PascalCase for types/interfaces/enums/React components, camelCase for functions/variables, SCREAMING_SNAKE_CASE for compile-time constants. Name files after their primary type/unit.

Do not add modules that are not registered in `ARCHITECTURE.md`. Preserve the dependency DAG; no reverse dependencies, no cross-feature imports, and no direct access to another module's private implementation. Avoid empty names such as `Manager`, `Helper`, `Util`, or `Common`.

UI/presentation code should consume state and send intents only — put business logic in services/use cases, and keep data-model types thin. The Electron renderer never touches Node APIs: all OS work crosses the typed IPC bridge (`DesktopBridge`, contract in `ARCHITECTURE.md §3.2`) into main-process services. Vendored `@page-agent/*` packages keep their upstream names, layout, and public APIs; record every local patch in `UPSTREAM.md` (invariant I5).

## Testing Guidelines

Use vitest. Required coverage areas from `ARCHITECTURE.md`: `LaunchConfig`, `BrowserResources`, `ProfileStore`, the `BrowserSupervisor` state machine (mock `child_process`), and the vendored upstream suites (never delete or skip them; local vendor patches need regression tests). Test filenames should mirror the unit under test.

Packaged-app browser launch + extension injection (CDP smoke test), installer runs on clean macOS/Windows machines, and live end-to-end LLM calls require real-environment validation; mock/simulator-only evidence is not enough for those claims.

## Git, Logs, and PRs

Do not pile new work onto unrelated dirty changes without calling it out. Prefer Conventional Commits such as `feat(desktop): ...`, `fix(ext): ...`, `docs: ...` (allowed types: feat/fix/docs/refactor/test/chore/build/ci; scopes: desktop/ext/vendor/infra/docs).

Each independently verifiable feature, milestone, non-trivial fix, or refactor needs an execution log in `.project.agents/log/YYYY-MM-DD-<slug>.md` unless it is only a minor documentation edit. Logs must include what changed, relevant commits (or "uncommitted" with reason), verification performed, and next steps.

Pull requests should include scope, linked issues, screenshots for UI changes, environment/device coverage, and any documentation updates.

## Security & Configuration

Do not commit secrets, credentials, build output, or personal IDE files. Agent configuration and generated agent notes belong under `.project.agents/`, not the repository root, `.claude/`, or a global home directory. Never log or transmit the user's LLM API key or conversation content through the desktop process (invariant I2); the extension talks to the LLM endpoint directly over HTTPS and nothing else (invariant I4).
