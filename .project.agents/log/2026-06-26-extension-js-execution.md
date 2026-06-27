# execute_javascript 全覆盖增强

日期：2026-06-26 至 2026-06-27
分支：`codex/extension-js-execution`
worktree：`.worktrees/extension-js-execution`

## 目标

把上游 `execute_javascript` 从顶层 isolated world 的调试工具增强为可用于真实页面排障与执行的上下文执行器：默认启用、结构化结果返回、支持 `world: 'isolated' | 'main'`、支持 `frame_id`，并通过 `list_frames` 发现 frame。

## 改动模块

- `packages/page-controller`：新增 `serializeResult`，修复对象/DOM/Error/循环引用/截断结果序列化；`executeJavascript` 改用结构化结果。
- `packages/core`：`execute_javascript` schema 增加 `world` 与 `frame_id`；gate 改为默认启用、显式 `experimentalScriptExecutionTool: false` 时关闭。
- `apps/extension`：`RemotePageController` 透传 world/frameId；background 支持 `frameId` 路由与 `webNavigation.getAllFrames`；content script 以 `allFrames` 注入并按 isolated/main 分发；新增 main-world executor；新增 `list_frames` customTool 并注入 `MultiPageAgent`。
- `.project.agents/docs/context`：同步 PRD、ARCHITECTURE、TECH-INFRA、UPSTREAM。

## 提交列表

- `6d83d22` `fix(page-controller): structured serializeResult for executeJavascript`
- `a90f6fc` `feat(core): execute_javascript world/frame_id params, default-on`
- `f0b482d` `feat(ext): RemotePageController world/frameId passthrough + listFrames`
- `4287f67` `feat(ext): background frameId routing + list_frames via webNavigation`
- `047d1a5` `feat(ext): allFrames inject with top-frame guard + world dispatch`
- `9760fae` `fix(ext): normalize page control JS failure messages`
- `1fa3822` `feat(ext): main-world JS executor with postMessage bridge`
- `bf8cde4` `fix(ext): harden main-world execution bridge`
- `67ae30c` `feat(ext): list_frames tool wired into MultiPageAgent`

## 验证记录

- 已运行针对性单测：`@page-agent/core` 的 `PageAgentCore`、`@page-agent/page-controller` 的 `serializeResult`、extension 的 `RemotePageController` / background / content / `frameTools` / `MultiPageAgent`。
- 已运行构建验证：`@page-agent/page-controller build`、`extension build`；`main-world-executor.js` 产物存在，且未把 `SimulatorMask` / `PageController` / CSS 拉入 main-world executor bundle。
- 最终全量回归在本日志提交前执行：`npx --yes pnpm@9.15.0 -F @page-agent/core test`、`npx --yes pnpm@9.15.0 -F @page-agent/page-controller test`、`npx --yes pnpm@9.15.0 -F extension test`、`npx --yes pnpm@9.15.0 -F extension build`。

## 手动验证结论

- 尚未在真实浏览器侧边栏中走完整手动矩阵：同源 iframe、跨域 iframe（`list_frames` → `frame_id`）、main world 运行时变量、严格 CSP 失败提示、`<iframe sandbox>` 如实失败、Canvas 不可读边界。
- 本轮先以单测、类型/构建与 bundle 检查覆盖实现正确性；真实站点矩阵需在加载 `.output/chrome-mv3` 后补走并记录样例 URL。

## 已知边界

- `execute_javascript` 不绕过浏览器安全模型：sandbox、特权页、CSP、跨源隔离和页面主动拦截可能导致失败。
- Canvas/图片/纯视觉渲染内容不是 DOM 文本，仍需要视觉能力或人工补充。
- 同步死循环脚本会阻塞目标执行上下文，超时只能限制 Promise 侧等待，不能强制中断已进入页面主线程的死循环。

## 下一步

- 补真实浏览器手动验证矩阵，并把可复现样例 URL 与截图/日志写入后续执行日志。
- 若后续上游 page-agent 提供等价 JS 执行能力，按 `UPSTREAM.md` 中本地补丁记录对齐或收敛偏离。
