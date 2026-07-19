# visual_observe Question Solver Implementation Plan

> **状态（2026-07-18）：** 实现与本地验证已收口。23/23 production variant 仅达到来源标注的本地
> `fixture_verified`，0/23 `live_verified`；尚未使用真实平台账号，也未执行加载扩展后的真实 Chromium
> smoke。本文的完成勾选表示代码 / 契约 / 本地 fixture 已实现，不表示真实平台兼容性已经验证。

**Goal:** 把 `visual_observe` 建成唯一公开视觉工具，并以内置 `question_solver` capability 一次性覆盖
OCSJS 4.0 已完成的超星、智慧树、ZJY、ICVE、iCourse 与 U校园经典版共 23 个 production variant；
支持 inspect / answer / fill、图片与图文混排、精确回填、验证 / 恢复、受控翻页与完整结果交付，永不
自动最终提交。

**Architecture:** 新共享内核位于 `apps/extension/src/agent/questionSolver/*`。Agent 侧 orchestrator 只
处理授权、模型、状态机和结果；all-frame content host 持有版本化 DOM adapter 与短期 anchor/snapshot
journal；background 持有 task lease、frame challenge、MAIN fixed-operation、截图事务、tab mutation
owner/quarantine 和 MV3 recovery。旧 `chaoxing_solve` 从 Agent schema 移除，只保留代码 facade。

**Tech Stack:** TypeScript、WXT MV3、Vitest 4、jsdom 29、Zod 4、`@page-agent/llms`、Chrome
tabs/webNavigation/scripting/storage.session/captureVisibleTab。OCSJS 4.0 仅作为 MIT 研究与 selector 来源，
运行时不依赖 `ocsjs/`。

**Spec:** `../specs/2026-07-17-visual-question-solver-design.md`

**Worktree:** `/Users/outas/WebstormProjects/WenXue-ocsjs-all-platform-solvers`

**Branch:** `codex/ocsjs-all-platform-solvers`

---

## Delivery invariants

- `visual_observe` 是唯一公开视觉 / 答题工具；普通 observe 只建议 capability，不自动解题或写页面。
- `inspect` 不读答案、不调答案模型、不写；`answer` 可求解但不写；只有 `fill` 可写。
- LLM 只返回 `StructuredAnswer`，不生成或执行 JavaScript。
- production 23 variant 的 embedded correct-answer allowlist 当前全部为空；synthetic adapter 单测核心
  映射，zhs gxk 只允许题干 `name` projection。
- 所有写操作都需要 exact `documentId`、control snapshot/digest、binding recheck、verify/restore；迟到
  effect 未 settle 时保持 document quarantine。
- 图片 byte/base64 不进入公开 Question、ResultStore、history、IndexedDB 或日志。
- adapter 没有 `submit` operation；任何“提交/交卷/确认提交”控件 click count 必须为 0。
- 所有 23 个 production variant 已达到本地 `fixture_verified`；无真实环境不得写成 `live_verified`。

---

## File structure

### Shared solver

- Create `apps/extension/src/agent/questionSolver/contracts.ts`
- Create `apps/extension/src/agent/questionSolver/schemas.ts`
- Create `apps/extension/src/agent/questionSolver/fingerprints.ts`
- Create `apps/extension/src/agent/questionSolver/manifest.ts`
- Create `apps/extension/src/agent/questionSolver/registry.ts`
- Create `apps/extension/src/agent/questionSolver/stateMachine.ts`
- Create `apps/extension/src/agent/questionSolver/resultStore.ts`
- Create `apps/extension/src/agent/questionSolver/imageAssets.ts`
- Create `apps/extension/src/agent/questionSolver/answerModel.ts`
- Create `apps/extension/src/agent/questionSolver/orchestrator.ts`
- Create `apps/extension/src/agent/questionSolver/capability.ts`

### Browser boundary

- Create `apps/extension/src/agent/questionSolver/protocol.ts`
- Create `apps/extension/src/agent/questionSolver/bridge.ts`
- Create `apps/extension/src/agent/questionSolver/bridge.background.ts`
- Create `apps/extension/src/agent/questionSolver/adapterHost.content.ts`
- Create `apps/extension/src/agent/questionSolver/mainWorldOperations.ts`
- Create `apps/extension/src/agent/questionSolver/backgroundState.ts`
- Create `apps/extension/src/agent/questionSolver/capture.ts`

### Platform adapters

- Create `apps/extension/src/agent/questionSolver/platforms/sharedDom.ts`
- Create `apps/extension/src/agent/questionSolver/platforms/chaoxing.ts`
- Create `apps/extension/src/agent/questionSolver/platforms/zhihuishu.ts`
- Create `apps/extension/src/agent/questionSolver/platforms/vocational.ts`
- Create `apps/extension/src/agent/questionSolver/platforms/icourse.ts`
- Create `apps/extension/src/agent/questionSolver/platforms/unipus.ts`
- Create `apps/extension/src/agent/questionSolver/platforms/generic.ts`
- Create `apps/extension/src/agent/questionSolver/platforms/index.ts`

### Integration changes

- Modify `apps/extension/src/agent/visualObserve.ts`
- Modify `apps/extension/src/agent/visualObserve.background.ts`
- Modify `apps/extension/src/agent/MultiPageAgent.ts`
- Modify `apps/extension/src/agent/TabsController.ts`
- Modify `apps/extension/src/agent/chaoxing/tools.ts`
- Modify `apps/extension/src/agent/system_prompt.md`
- Modify `apps/extension/src/lib/runtimeModelConfig.ts`
- Modify `apps/extension/src/entrypoints/content.ts`
- Modify `apps/extension/src/entrypoints/internal/backgroundMessageRouter.ts`
- Modify `apps/extension/wxt.config.js`

### Tests / fixtures / evidence

- Create colocated `*.test.ts` files for every shared/browser/platform module.
- Create `apps/extension/src/agent/questionSolver/test/fixtures.ts`
- Create `apps/extension/src/agent/questionSolver/test/platformMatrix.test.ts`
- Create `apps/extension/src/agent/questionSolver/test/imageOnly.e2e.test.ts`
- Create `apps/extension/src/agent/questionSolver/test/mixedReader.e2e.test.ts`
- Create `apps/extension/src/agent/questionSolver/test/isolation.e2e.test.ts`
- Create `apps/extension/test-fixtures/question-solver/assessment-lab.html`
- Create `apps/extension/test-fixtures/question-solver/assessment-frame.html`
- Create `apps/extension/test-fixtures/question-solver/cross-origin-top.html`
- Create `apps/extension/test-fixtures/question-solver/cross-origin-frame.html`
- Create `apps/extension/test-fixtures/question-solver/assets/{circle,sequence,square}.svg`
- Create `apps/extension/test-fixtures/question-solver/fixtureServer.mjs`
- Create `.project.agents/log/2026-07-18-visual-question-solver.md`

---

## Task 1 — Freeze contracts, schemas, fingerprints and registry

**Dependencies:** none. This task is the interface checkpoint before parallel adapter work.

- [x] Add the complete discriminated contracts from Design §§14–18: actions/scopes, adapter refs/manifests,
      navigation profiles, Question/ContentPart/ImageAssetRef, StructuredAnswer/Evidence, outcomes, snapshots,
      transactions, frame/run identity and exhaustive terminal statuses.
- [x] Add Zod schemas at every untrusted wire/model boundary; reject unknown fields, data URLs, long base64,
      script/function payloads and oversized results.
- [x] Implement SHA-256 logical/binding/question fingerprints and control snapshot digest v1 canonicalization.
- [x] Implement manifest validation: same-platform transitions, registered selector/route/MAIN operation IDs,
      no submit operation, type-support lattice, exactly two Chaoxing modern profiles and one default elsewhere.
- [x] Register all 23 production variant IDs plus conservative `generic.standard_html`; assert uniqueness and
      exact matrix count.
- [x] Tests: canonical vectors, order stability, invalid manifest cases, final-submit rejection, 23-ID snapshot.

**Checkpoint command:**

```sh
pnpm -F extension test src/agent/questionSolver/contracts.test.ts src/agent/questionSolver/manifest.test.ts
pnpm -F extension exec tsc --noEmit
```

## Task 2 — Implement state machine, output reduction and lossless result delivery

**Dependencies:** Task 1.

- [x] Implement action-specific allowed transitions and the seven mutually exclusive terminal outcomes.
- [x] Implement deterministic `executionStatus` reduction and all count invariants.
- [x] Implement task-scoped ResultStore: 96 KiB chunks, 8 MiB / 2,000 outcomes / 10 min, full counts on every
      chunk, continuation reads with zero page/model/write calls.
- [x] Implement independent ResumeCursorStore: original tab + managed lease binding, prefix hash revalidation,
      atomic claim, capacity chaining and lifecycle cleanup.
- [x] Tests: every state edge, early/late cancel, blocker precedence, partial+fatal reduction, final chunk status,
      no loss/duplication, drain-last-chunk then resume, target mismatch and concurrent claim.

## Task 3 — Implement text/vision answer model and embedded mapping core

**Dependencies:** Tasks 1–2.

- [x] Generalize existing Chaoxing forced-tool client into `answerModel.ts`; preserve named→required fallback,
      Qwen thinking support, AbortSignal and API-key-safe diagnostics.
- [x] Serialize text and image parts in exact material/stem/option/sub-question order; share a material asset once
      per top-level composite question.
- [x] Enforce model routing: explicit `questionSolverModels`, deprecated `chaoxingModels`, then Agent text only;
      `visualObservationModel` remains independent.
- [x] Implement confidence gates: ≥0.75 accept; 0.55–0.75 one consistent recheck; below/discordant review.
- [x] Implement attempt/question/type/option mapping for embedded candidates; production projections remain empty.
- [x] Fake-provider tests: text/vision, forced schema retry, named-tool fallback, low confidence, AbortError,
      malformed paths and zero LLM calls for accepted synthetic embedded answers.

## Task 4 — Implement declarative DOM adapter host and exact control transactions

**Dependencies:** Task 1.

- [x] Build shared DOM primitives for normalized text, ordered content parts, stable option keys, input events,
      exact choice/text/dropdown/line state, visibility and navigation readiness.
- [x] Build content-local AnchorRegistry and PendingControlJournal with limits/expiry/digest admission.
- [x] Implement adapter lifecycle: probe/extract/readEmbedded/prepareCapture/snapshot/setExact/verify/restore/
      navigation/waitReady; DOM references never cross RPC.
- [x] Implement global and adapter-specific login/captcha/slider/face/2FA/permission interruption detectors;
      custom font/Canvas visible content routes to vision rather than being treated as a verification bypass.
- [x] Common contract suite: idempotent exact state, old wrong selection replaced, failed verify restored,
      no snapshot means no write, AbortSignal, no submit, locator/fingerprint rebind.

## Task 5 — Migrate and strengthen Chaoxing

**Dependencies:** Tasks 1, 3–4.

- [x] Implement `chaoxing.modern_work_exam` and `chaoxing.chapter_test` from OCSJS selectors and existing
      WenXue logic, retaining MIT source attribution.
- [x] Route-select `chaoxing.modern.preview` vs `.serial`; preview can never next, serial next requires exact
      `getTheNextQuestion(1)` control.
- [x] Support modern/chapter single, multiple, judgement, completion, line, fill and reader structures.
- [x] Replace page-index-only identity with platform IDs/fingerprint and frame/document binding.
- [x] Convert old inline image/base64 path to AnchorRegistry → inline fetch → bound screenshot asset path.
- [x] Change `chaoxing/tools.ts` to export `runLegacyChaoxingSolve()` facade only; no public tool schema.
- [x] Keep existing Chaoxing regression tests green and add preview/no-next, wrong-old-state, frame paging,
      image-only and mixed reader fixtures.

## Task 6 — Implement Zhihuishu family (7 variants)

**Dependencies:** Tasks 1, 3–4.

- [x] Add manifests/probes/extractors/writers for `zhs.gxk_work_exam`, `zhs.xnk_work`, `zhs.smart_work`,
      `zhs.smart_exam`, `zhs.fusioncourse_work`, `zhs.hike_work`, `zhs.hike_homework`.
- [x] Add native/controlled input and Vditor fixed MAIN operations; unsupported completion writers remain
      `inspect_answer`, never guessed fill.
- [x] Implement gxk active-run response projection for question `name` only; drop all answer-like fields.
- [x] Add smart/hike paging profiles, autosave effect classification and captcha/易盾 takeover fixtures.
- [x] Matrix tests for all seven variants, image/mixed content, exact state, completion review and no submit.

## Task 7 — Implement ZJY, ICVE and iCourse families (6 variants)

**Dependencies:** Tasks 1, 3–4.

- [x] Add `zjy.legacy_work_exam`; detect `/study/v2/` as unsupported instead of mis-probing legacy.
- [x] Add `icve.standard_work_exam` and `icve.ai_work`, including textarea, native input and fixed UEditor
      operation; AI image options route to vision.
- [x] Add `icourse.chapter_test`, `icourse.work`, `icourse.exam`; serialize writes, use active network/mutation
      quiet tracker plus fake-clock 5s gate, and never click `.j-submit` or exam submit controls.
- [x] Tests for legacy work/exam routes, multi-blank/UEditor, AI controlled input/paging, three iCourse page
      generations, quiet timing, icon judgement semantics and no-submit.

## Task 8 — Implement U校园 classic family (8 variants) and generic fallback

**Dependencies:** Tasks 1, 3–4.

- [x] Add all eight U校园 variants: reading fill/choice, normal choice, completion/translation, banked input,
      banked dropdown, free fill and line matching.
- [x] Preserve material/reply order; implement controlled keyboard/input, exact dropdown and exact drag/order.
- [x] Implement `U_NEXT` allowlist across seven variants; line matching stops before OCSJS submit; upload/
      recording tasks return unsupported partial.
- [x] Add `generic.standard_html` visible-only adapter with ≥0.85 mapping proof, no pagination/embedded API.
- [x] Tests for every variant, single/double-column blank, stale selection replacement, reorder rollback,
      task transition matrix, image materials and zero submit.

## Task 9 — Implement authenticated all-frame RPC, MAIN operations and MV3 recovery

**Dependencies:** Tasks 1, 4–8.

- [x] Add `QUESTION_SOLVER_CONTROL` v1 envelopes, task/run/request/lane/cancel validation and typed errors.
- [x] Add nonce challenge → content active registration from real MessageSender; discover/sort multiple frames,
      compute conflict per frame, support `match_origin_as_fallback`, fail closed on unknown inherited origins.
- [x] Route effectful content operations by `documentId` only; re-list/challenge/probe after navigation.
- [x] Add parent-bound `QUESTION_SOLVER_MAIN_WORLD` sub-RPC and exhaustive fixed-operation switch; never call
      existing arbitrary script executor from solver.
- [x] Add task lease registry, salted session hash, run lifecycle, effect ledger, mutation owner/effect lock,
      cleanup deadline, document quarantine and background-only recovery capability.
- [x] Tests: forged sender/lease/frame/parent, stale response, request supersession, missing documentId, MAIN
      string rejection, canonical snapshot recovery, delayed setter quarantine and document invalidation release.

## Task 10 — Implement screenshot/image transaction and strengthen ordinary visual observe

**Dependencies:** Tasks 1, 4, 9.

- [x] Change ordinary capture to current visible managed tab only; no `tabs.update`, PNG source, last-focused
      window ownership and before/after binding checks.
- [x] Implement global 550ms limiter and tab effect lock.
- [x] Implement inline fetch/downsample and same-request background one-shot bound capture with measured bitmap
      ratio, 24px context, 1600px/JPEG .85 crop and `finally` visual restore.
- [x] Implement EphemeralImageStore limits, ownership, hash/size checks and hard-omit logging.
- [x] Tests: background tab waits, tab change, rate limit retry, cross-frame scale/rect, Canvas/background image,
      fetch 403 fallback, caller cancellation after prepare, worker recovery and no persisted bytes.

## Task 11 — Wire `question_solver` into `visual_observe` and runtime models

**Dependencies:** Tasks 2–3, 5–10.

- [x] Turn visual input into backward-compatible observe/capability union; capability dispatch occurs before
      ordinary vision-model check.
- [x] Add VisualCapabilityRegistry and register only internal `question_solver`.
- [x] Implement orchestrator for global interrupt → frame/profile select → extract → asset resolve → embedded/
      model → snapshot/exact fill/verify/restore → navigation → aggregation.
- [x] Add `questionSolverModels` runtime property and deprecated `chaoxingModels` alias sharing named-tool
      compatibility state.
- [x] Remove `createChaoxingTools` from `MultiPageAgent.customTools`; register enhanced `visual_observe` only.
- [x] Update system prompt with inspect/answer/fill semantics, continuation drain and manual final submission.
- [x] Integration tests for legacy visual observe unchanged, capability without ordinary vision model,
      inspect/answer no writes, fill path, output schema and old Chaoxing facade.

## Task 12 — Build fixture/e2e evidence for all variants

**Dependencies:** Tasks 5–11.

- [x] Build source-attributed fixture factory and at least one fixture per each of 23 production variants.
- [x] Add `qsolver.e2e.image_only_options`: four images without alt/title, fetch 403, fake vision→B, answer leaves
      DOM unchanged, fill clears A/selects B/verifies, logs/history contain zero base64.
- [x] Add `qsolver.e2e.mixed_reader`: interleaved material/stem/options/subquestions, one top-level multimodal
      request, exact path ordering, old choice/text replacement, missing image means zero write.
- [x] Add two-origin fixture server for top/cross-origin child frame and special-origin iframe pages.
- [x] Add two-task isolation, protected top overlay + child question, navigation old-DOM settle, result chunk/
      resume and service-worker recovery scenarios.
- [x] Generate a fixture maturity table and assert all 23 variants are `fixture_verified`, none `live_verified`.

## Task 13 — Final verification, docs and implementation log

**Dependencies:** all implementation tasks.

- [x] Run targeted question-solver tests while iterating.
- [x] Run all extension tests and the WXT build.
- [ ] Run extension TypeScript to a green exit. The command still reports 10 pre-existing, non-solver errors;
      no question-solver TypeScript errors remain.
- [x] Run ESLint for the production solver/integration scope.
- [x] Search generated/source code for submit selectors in adapter action tables, LLM-to-JS paths, data URL/
      base64 persistence and accidental public `chaoxing_solve` registration.
- [x] Update source-of-truth architecture/testing/readiness docs with actual file names and delivered maturity.
- [x] Write `.project.agents/log/2026-07-18-visual-question-solver.md` with research sources, decisions, changed
      files, commands/results, fixture evidence and known live-environment limitations.
- [x] Review and simplify the final diff without weakening contracts; rerun affected tests.

---

## Final acceptance commands

```sh
pnpm -F extension test src/agent/questionSolver
pnpm -F extension test
pnpm -F extension exec tsc --noEmit
pnpm -F extension build
git diff --check
```

Actual local evidence (2026-07-18):

- Question-solver suite: 32 files / 231 tests passed.
- Full extension suite: 80 files / 691 tests passed.
- `@page-agent/page-controller`: 2 files / 17 tests passed.
- Image-only and mixed-reader suites: 2 files / 7 tests passed; each suite covers `inspect`, `answer` and
  `fill` for its targeted synthetic flow.
- WXT build passed, with only the existing `es2025` and React OXC warnings.
- Production-scope ESLint passed.
- Extension `tsc --noEmit` still exits non-zero for 10 pre-existing errors outside the question-solver scope;
  it reports no new solver error.
- Registry contains exactly 23 production variants plus generic fallback.
- `MultiPageAgent.customTools` has `visual_observe` and no `chaoxing_solve`.
- The image-only and mixed-reader action coverage does not establish full inspect/answer/fill coverage for every
  production variant or question type.
- Cross-origin child-frame screenshot fallback is fail-closed because extension-only authenticated geometry is
  not yet available; inline image resolution remains supported.
- CAPTCHA/OTP paths have DOM preflight blocking, protected-input rejection and sensitive-output redaction.
- Every production adapter reports `fixture_verified`; no adapter reports `live_verified` without a real-platform
  checklist.
- No adapter or background operation can perform final submission.
- No real platform account or loaded-extension Chromium smoke was available; therefore the delivered maturity is
  23/23 local source-attributed `fixture_verified`, 0/23 `live_verified`.

## Rollback boundaries

- Shared contracts/state machine can be disabled by omitting capability registration; legacy Observe remains intact.
- Platform adapters are registry entries and can be disabled per variant without changing core contracts.
- Browser `QUESTION_SOLVER_*` routes are additive until the old Chaoxing facade is proven; old public tool schema
  is removed only in Task 11 after facade regression passes.
- Manifest `scripting` permission is required only once MAIN fixed-operation tests pass.
