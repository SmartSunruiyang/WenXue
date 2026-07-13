# 修复后台用户状态保存的 Invalid userId

- **日期**：2026-07-14
- **关联**：PRD F16；ARCHITECTURE AdminApi / AdminConsole；ROADMAP M4.6
- **会话上下文**：工作树已有高级设置、PRD v0.2 草案与桌面构建产物改动；用户明确授权在脏工作区直接修复，本次未覆盖或回滚既有改动。

## 做了什么

- 用 CloudBase Functions Framework 的真实调用形态复现：JSON 请求体直接作为 `event` 传入、HTTP 元数据位于 `context.httpContext`，旧适配器把请求体误读成 `{}` 并返回 `Invalid userId`。
- 调整 AdminApi HTTP 事件适配层：优先解析旧 API 网关 `event.body` / `rawBody`，否则把 Functions Framework 的直接 JSON `event` 作为核心接口请求体。
- 增加适配层回归测试，分别覆盖直接 JSON 与带 `httpContext` 的包装事件，以及管理员鉴权、读取用户、禁用用户、返回更新状态与写入审计的完整调用。

## 提交

- `9913332` fix(admin-api): preserve CloudBase request body shapes

## 状态变更

- 架构文档：未修改；修复恢复既有 AdminConsole → AdminApi 请求体契约，不改变模块、依赖或接口。
- 需求/UI 文档：未修改；后台启用/禁用行为未发生产品范围变化。
- 测试：
  - 失败复现：新增用例修复前稳定返回 `400 Invalid userId`。
  - `pnpm -F admin-api test`：3 files / 15 tests 通过。
  - `pnpm -F admin-api typecheck`：通过。
  - `pnpm -F admin build`：通过；保留既有 Vite 大 chunk 警告。
  - Prettier 与目标文件 `git diff --check`：通过。
- 线上状态：
  - 已将 `apps/admin-api` 部署到 CloudBase Run 服务 `wenxue-admin-api`，环境为 `wenxue-d8gz76tacc3659f05`。
  - 新版本 `wenxue-admin-api-008` 状态正常、承载 100% 流量；部署 build id 为 `2601321290`。
  - 复用真实后台管理员登录态，选择一个累计 tokens 为 0 的账号执行“启用 → 禁用 → 保存”；页面返回“已保存”，列表同步显示“禁用”，未再出现 `Invalid userId`。
  - 随后执行“禁用 → 启用 → 保存”，页面再次返回“已保存”，账号已恢复原状态。
  - 本次只部署 `apps/admin-api`，未发布前端，也未包含脏工作区中的其他改动。
  - 当前账号无 CODING 构建日志读取权限；已通过 CloudBase Run 版本/流量状态及真实后台端到端操作完成发布验收。

## 下一步

- 修复、线上回归与代码提交均已完成；后续仅需保持 Functions Framework 与包装事件回归用例常驻。
