# 后台按 CloudBase 用户鉴权与 active 状态审计

- **日期**：2026-07-04
- **关联**：Admin Console / LLM Gateway / CloudBase Auth / `user_accounts.active`
- **会话上下文**：用户要求重构后台管理系统，不再依赖 `machineId` 区分身份；后台需按 CloudBase 用户展示、启用/禁用需操作数据库 `active` 字段、每个账户可见 token 消耗，且 UI 控件全部可用。

## 做了什么

- 将 `user_accounts` 授权字段切换为 `active`：后台 API 写入 `active=true/false`，网关鉴权优先读取 `active`，并保留 legacy `status` 兼容读取。
- `/v1/auth/register` 创建 CloudBase Auth 用户后，同步创建 `user_accounts`，默认 `active: true`。
- 后台 `/admin/v1/users` 返回每个 CloudBase 用户的 `firstSeenAt`、`lastSeenAt`、`inputTokens`、`outputTokens`、`totalTokens`。
- 后台 UI 用户表增加累计 tokens、首次出现、最近出现；右侧状态编辑器展示输入/输出/总 tokens。
- 修复状态保存后 token 数被 patch 响应覆盖为 0 的问题，保存后保留已加载的账户 token 汇总。
- 修复保存成功提示被同一用户更新 effect 清掉的问题。
- 移除指向缺失区块的导航项；补充表格行键盘选中、focus-visible 样式和移动端 44px 控件尺寸。
- 更新 PRD、ROADMAP、ARCHITECTURE、TECH-INFRA，统一记录 `user_accounts.active` 为当前授权事实源。

## 验证

- TDD RED：先补 `admin-api` / `llm-gateway` 断言，确认旧实现仍写 `status`、不返回账户 token 明细、patch 后 UI 数据会丢失。
- GREEN：实现后 `pnpm -F admin-api test` 通过，3 个测试文件、13 个测试。
- `pnpm -F admin-api typecheck`：通过。
- `pnpm -F llm-gateway test`：通过，1 个测试文件、26 个测试；测试中的 usage 持久化失败日志是预期失败分支。
- `pnpm -F llm-gateway typecheck`：通过。
- `pnpm -F admin build`：通过；Vite 仍提示单个 JS chunk 约 975KB，大 chunk 警告非本次阻塞项。
- `git diff --check`：通过。

## UI 审计

- 本地 Vite：`http://localhost:5176/`。
- in-app Browser 新页签 attach 超时，改用 Browser API 的 Chrome 后端确认页面可打开；完整交互审计用 Python Playwright 执行。
- Playwright 拦截 CloudBase Auth `/auth/v1/signin`、`/auth/v1/user/me` 和后台 API，使用与前端/SDK 兼容的数据形状覆盖登录后页面。
- 覆盖流程：登录按钮禁用/启用、CloudBase 用户登录进入后台、刷新、用户状态筛选、键盘选中用户、禁用用户改启用、备注和调整原因提交、保存成功提示、token 总数不被 patch 响应清零、退出。
- 桌面截图：`/tmp/wenxue-admin-audit-desktop.png`。
- 移动端截图：`/tmp/wenxue-admin-audit-mobile.png`。
- 移动端审计结果：`scrollWidth=clientWidth=390`，无横向页面溢出；可见按钮无小于 36px 的控件，主要操作按钮为 44px 高；console error/warning 为空。

## 边界

- 本轮未做线上部署。
- 真实 CloudBase 数据库操作由 admin-api / gateway 的 store 与鉴权单元测试覆盖；浏览器 UI 使用同形状 mock 响应做端到端控件审计。
- 工作树在本任务前已有 extension / visual-observe 相关未提交改动，本次未修改或回滚它们。
