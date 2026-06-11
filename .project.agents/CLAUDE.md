# CLAUDE.md

This file guides Claude Code (and other agents) when working in this repository.
<!-- ADS:FILL Keep this file current. It is the project-level entry point: what this project is, how to build it, and the rules that gate every change. -->

## Project

<!-- ADS:FILL One paragraph: what 问学 WenXue is, the platform/type, and where the code lives. -->
`问学 WenXue` is a cross-platform desktop suite (Electron launcher + Chromium MV3 extension) in a pnpm monorepo built with TypeScript, Electron (electron-vite), React 19, Tailwind CSS 4, WXT, pnpm workspaces, vitest. Source lives in `apps/ 与 packages/`; tests in `各包内同目录的 *.test.ts`.

- Entry point: `apps/desktop/src/main/index.ts (Electron main) · apps/extension/src/entrypoints/ (WXT)`
- {{KEY_FACT_1}}
- {{KEY_FACT_2}}
- Known environment constraints: {{ENV_CONSTRAINTS}}

## Common commands

```sh
# Build
pnpm build

# Run
pnpm dev

# Test
pnpm -r test
```

<!-- ADS:FILL Include any non-obvious setup, single-test invocation, or environment gotchas. -->

## Architecture

The implementation follows the module boundaries in `.project.agents/docs/context/ARCHITECTURE.md`:

<!-- ADS:FILL One bullet per top-level module/layer — a single sentence on its responsibility. Mirror §2 of the architecture doc. Do NOT add modules here that aren't registered there. -->
- {{MODULE_OVERVIEW}}

## Project-level rules

- **Read these two files before any code-changing task** — they encode the lessons that gate every decision in this repo:
  - `.project.agents/VIBECODING_GUIDE.md` — the practice guide (why & how)
  - `.project.agents/SELF_CONSTRAINTS.md` — the hard constraints (what's forbidden, what's required, when to stop)

  For any non-trivial task, run through `SELF_CONSTRAINTS.md §A` (pre-flight self-check) before editing anything.

- **Agent settings live under `.project.agents/`.** Any `settings.json` or other configuration you generate for your own use MUST be written to `.project.agents/` (or a subdirectory) — never the project root, `.claude/`, or `~/.claude/`. This keeps repo-tracked agent state contained.

- **All project documentation lives under `.project.agents/docs/context/`** as a single flat directory. Canonical files:
  - `PRD.md` — product requirements (source of truth for behavior)
  - `ARCHITECTURE.md` — module boundaries, dependencies, contracts, directory layout
  - `ROADMAP.md` — implementation milestones and acceptance checks
  - `CONVENTIONS.md` — naming, style, testing, repository conventions
  - `UIUX.md` — visual tokens + interaction details (source of truth for visuals)
  <!-- ADS:FILL Add derived docs (implementation spec, asset checklist) here once they exist. -->

- **Source-of-truth hierarchy** — on conflict, upstream wins:

  ```
  PRD.md > ARCHITECTURE.md > UIUX.md > CONVENTIONS.md > derived docs
  ```

  When an upstream doc changes, regenerate the affected sections of derived docs to stay in sync. Feature changes must update `PRD.md`; module/dependency changes must update `ARCHITECTURE.md` in the same commit. Do not let code and architecture drift for more than 24 hours.

- **Roadmap execution rules:**
  1. Advance in the order set by `.project.agents/docs/context/ROADMAP.md` and the logs in `.project.agents/log/`. Tick each checkbox in the same commit that completes it.
  2. Prefer subagents for concrete implementation; the main conversation decomposes, reviews, and ticks.
  3. **Milestone-level / multi-file / multi-module = a large task**: write a plan/spec first, then execute against it. Small tasks (single file, single checkbox, pure revision) can be done directly.
  4. After each milestone, write an execution log per the `.project.agents/log/` template.
