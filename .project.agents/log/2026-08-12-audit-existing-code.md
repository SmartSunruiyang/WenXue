# 完成现有代码审查与关键链路加固

- **日期**：2026-08-12
- **关联**：ROADMAP M2 / `2026-08-12-existing-code-audit.md` / `ARCHITECTURE.md`、`TECH-INFRA.md`
- **会话上下文**：先把用户原有工作树修改保存在独立提交，再从干净基线执行全仓只读审查、主会话修复与关键验证。

## 做了什么

- 修复桌面日常 CfT 启动暴露 TCP CDP、运行画像可复制/删除、关闭失败卡窗、设置损坏/并发覆盖、日志并发写坏与敏感信息落盘、更新提示旧错误遮蔽新状态等问题。
- 修复扩展 tab-events 端口累积与重连竞态、任务中配置刷新丢失/异步换绑中断任务、题目状态持久化队列中毒、全 frame 高频轮询、BFCache 恢复后 mask 半失效、远程 Markdown 图片自动请求，以及自定义模型明文 HTTP 传输凭据等问题。
- 修复 LLM Gateway 的响应体/流 idle 超时、跨网络 chunk 的 SSE usage 解析、无界 SSE frame 缓冲、请求体/模型/消息/token 边界、`token_usage` 固定 500 条窗口和热写表 offset 分页错漏、成功响应非法 JSON 静默降级等问题。
- 修复 Admin 静态服务 malformed URL/路径边界、Admin API 固定窗口分页与响应体超时；在尚未接入 TCB `ModifyUser` 时让伪授权状态变化 fail closed，并把 Console 明确收敛为 legacy 运营标记/备注页。
- 统一候选发布中桌面与扩展的网关 origin 注入和产物校验；拒绝带凭据、path、query 或 fragment 的构建地址。
- 收敛 ESLint 的生成目录与运行时 globals 配置；全仓问题数由基线 1269 降至 211，但 legacy/vendor 类型债务仍未清零。

## 提交

- `d8700df` `fix(desktop): stabilize update and background services`（仅保存审查开始前的用户改动）
- 2026-09-17 将本轮审查修改分组并入 `main`：
  - `ddd0c09` `fix(desktop): harden profile lifecycle and local persistence`
  - `0f5e162` `fix(ext): harden agent state, tab events, and content handling`
  - `c8f49b9` `fix(infra): bound gateway requests and paginate usage safely`
  - `22fb3c8` `fix(infra): make admin authorization and pagination fail closed`
  - `0a17928` `build(infra): enforce one gateway origin in release artifacts`
  - `1982816` `chore(infra): align lint contexts and package metadata`

## 状态变更

- ARCHITECTURE：更新 AdminApi/UserAccount/UserPermissionAudit 边界，明确 CloudBase Auth 仍是唯一授权权威，未接入 `ModifyUser` 前状态变化返回 409。
- TECH-INFRA：同步 legacy 备注语义和桌面/扩展共享网关 origin 的发布构建契约。
- ROADMAP：明确 Admin 用户页当前不具备启用/禁用能力，权威写入仍是未完成项。
- 测试：修改前全仓 1,144 项通过；修改后关键回归通过（桌面 84、扩展 128、Gateway 70、Admin API/静态服务 76），workspace typecheck、`lint:desktop-release`、Admin/桌面/扩展生产构建通过；自定义 origin 已在三份 bundle 中验证，非法 origin 构建按预期失败。
- 已知门禁：全仓 `pnpm lint` 仍有 165 errors / 46 warnings；Admin/桌面有大 bundle 提示，WXT/esbuild 仍提示 `es2025` target 未识别。
- 2026-09-17 复核：扩展 709/709、Gateway 70/70、Admin API 74/74 通过；桌面 161/163 通过，另 2 项与 Admin 静态服务测试受当前沙盒禁止绑定 `127.0.0.1` 影响，需在允许本机监听的环境复验。`git diff --check` 通过。

## 下一步

- 为 AdminApi 接入最小权限 TCB `ModifyUser ACTIVE|BLOCKED`，失败时不得写成功审计，并完成禁用用户后 Gateway 在 DashScope 前返回 403 的真实 E2E。
- 把永久增长的 `token_usage` 改为按用户/日物化汇总与稳定游标读取，避免 Admin 每次刷新重复全历史 O(N) 扫描。
- 将桌面日志/本地 token 用量迁移为增量写入或有界批量 flush，并定义不会破坏累计指标的归档策略。
- 分批清理剩余全仓 lint、bundle 拆分与 `es2025` 构建警告；发布前执行真实 CfT、CloudBase、DashScope 与安装器全链路冒烟。
