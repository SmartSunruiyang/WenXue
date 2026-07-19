# 完成 visual_observe question_solver 的本地实现与 fixture 验证

- **日期**：2026-07-18
- **最后更新**：2026-07-19
- **关联**：
  - `docs/superpowers/specs/2026-07-17-visual-question-solver-design.md`
  - `docs/superpowers/plans/2026-07-17-visual-question-solver.md`
- **分支**：`codex/ocsjs-all-platform-solvers`
- **工作树**：`/Users/outas/WebstormProjects/WenXue-ocsjs-all-platform-solvers`

## 做了什么

- 将 `visual_observe` 保持为唯一公开视觉工具，通过内部 `question_solver` capability 提供
  `inspect | answer | fill` 授权分层；旧 `chaoxing_solve` 只保留代码 facade，不再注册为公开工具。
- 建立共享 contract、schema、fingerprint、manifest/registry、answer model、state/result/resume、
  authenticated all-frame RPC、固定 MAIN-world operation、截图事务、MV3 effect recovery 与文档隔离。
- 迁入并注册 OCSJS 研究范围内的 23 个 production variant，以及保守的
  `generic.standard_html` fallback；production embedded correct-answer projection 保持为空，zhs gxk
  仅投影题干 `name`。
- 增加最终提交、protected interruption、任意 LLM JavaScript、图片/base64 持久化等运行时防线；
  `fill` 采用 snapshot、exact-state writer、verify/restore 与 document quarantine。
- 合并前审查补齐 verify 结果与 fill command 指纹的一一对应校验；空、缺失、重复或未知 verify 结果
  均进入完整 snapshot restore，不能再被空数组 `every()` 误判为 `filled_verified`。同时为 background
  初始化、tab/navigation invalidation 与 lease 同步补齐异步错误记录。
- 在 `UPSTREAM.md` 登记 `@page-agent/page-controller` 的 protected assessment action guard，并同步
  QuestionSolver 的 vendor 边界说明。
- 建立来源标注的 23-variant fixture factory，以及图片选项、图文混排 reader、任务/帧隔离、旧 DOM
  翻页、continuation/resume、service-worker recovery 等 synthetic 用例。
- 本地页面 fixture 实际位于 `apps/extension/test-fixtures/question-solver/`，包括
  `assessment-lab.html`、`assessment-frame.html`、`cross-origin-top.html`、
  `cross-origin-frame.html`、`assets/*.svg` 与 `fixtureServer.mjs`。

## 提交

- `c71ce90` `feat(ext): add guarded visual question solver`

## 验证

- Question-solver：32 files / 231 tests passed。
- Extension 全量：80 files / 692 tests passed。
- `@page-agent/page-controller`：2 files / 17 tests passed。
- Image-only + mixed-reader：2 files / 7 tests passed；两个 suite 均分别覆盖 `inspect`、`answer`、`fill`。
- Production solver / integration scope ESLint：passed。
- WXT extension build：passed；仅输出既有 `es2025` / React OXC warning。
- Extension `tsc --noEmit`：仍为 non-zero；共有 10 个既有、非 question-solver 错误，分布在
  `cards.tsx`、`HistoryDetail.test.tsx`、`LogViewer.tsx`、`misc.test.ts` 与 `db.ts`。本次 solver
  范围没有新增 TypeScript 错误。

## 成熟度与限制

- 23/23 production variant 达到 local source-attributed `fixture_verified`。
- 0/23 production variant 达到 `live_verified`。
- 没有真实平台账号或真实平台页面，因此没有验证 selector drift、平台登录态、autosave 行为、真实
  网络时序和页面版本差异。
- 尚未在真实 Chromium 中加载构建后的扩展执行 smoke；两 loopback origin fixture server 的自动化
  测试、fake Chrome API、jsdom 和 WXT build 不能替代这项验证。
- 跨 origin child frame 的 inline image resolution 仍支持；screenshot fallback 因尚无 extension-only
  authenticated geometry 而 fail-closed，不会使用未绑定整屏替代。
- Fixture matrix 证明 23 个 variant 的本地 probe / extract 基线；image-only 和 mixed-reader 各自完整覆盖
  三种 action，但不能表述为每个 variant、每种题型均完整通过 inspect / answer / fill。
- 可见验证码 / OTP 有 DOM preflight、protected-input rejection 与 capability 输出脱敏测试；命中后停止并
  请求人工接管，不识别、不填写、不绕过验证。
- 不自动最终提交，不执行 LLM 生成的 JavaScript，不绕过登录、验证码、滑块、人脸、2FA 或权限确认。

## 文档状态

- 已同步当前运行时与目标 Chromium 迁移相关的架构、基础设施、产品、迁移、计划、readiness 与 testing
  文档；本次收口进一步把 spec / plan 的 fixture 路径和实际成熟度改为可核验事实。
- 本期没有将任何 variant 标记为 `live_verified`。

## 下一步

1. 在真实 Chromium 中加载 extension build，运行 top/cross-origin/sandboxed fixture smoke，并记录浏览器
   版本、扩展版本和无敏感信息的证据。
2. 获得各平台测试账号后，逐 variant 执行真实页面 checklist；只有完成 URL pattern、页面版本、
   selector drift、题型、动作和 no-submit 证据后，才可把对应项升级为 `live_verified`。
3. 单独修复 extension 现有 10 个 TypeScript baseline 错误，再把 `tsc --noEmit` 纳入绿色验收门禁。
