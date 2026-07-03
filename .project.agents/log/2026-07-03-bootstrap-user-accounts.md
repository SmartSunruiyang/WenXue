# 初始化 CloudBase user_accounts 授权集合

- **日期**：2026-07-03
- **关联**：F9 用户账号与网关会话 / CloudBaseLlmGateway / AdminApi
- **会话上下文**：用户在修复机器 token 后再次调用插件，网关返回 `CloudBase user account query failed with 404`。

## 做了什么
- 复查 CloudBase NoSQL OpenAPI，确认网关读取路径 `/collections/user_accounts/documents` 合法，404 对应集合不存在或文档不存在。
- 通过 CloudBase MCP 检查线上环境 `wenxue-d8gz76tacc3659f05`，确认 `token_usage` 存在，但 `user_accounts` 与 `user_permission_audit` 不存在。
- 创建 `user_accounts` 与 `user_permission_audit` 集合。
- 从现有 CloudBase Auth 用户初始化 4 条 `user_accounts` 记录，`_id=uid`，`status=active`，不写入 token、密码、提示词或敏感头。

## 提交
- 未提交，工作树已有大量本任务前的未提交代码/文档改动；本次主要是 CloudBase 线上数据初始化，并新增本执行日志。

## 状态变更
- 架构文档：未改，现有架构已要求 `user_accounts` / `user_permission_audit`。
- 需求/UI 文档：未改。
- CloudBase 验证：
  - `readNoSqlDatabaseStructure(checkCollection=user_accounts)`：已存在。
  - `readNoSqlDatabaseStructure(checkCollection=user_permission_audit)`：已存在。
  - `readNoSqlDatabaseContent(user_accounts, status=active)`：4 条 active 记录。
  - 公网网关伪 token 探针仍返回用户登录态错误，不返回旧 `Invalid machine token`。

## 下一步
- 用户用已登录账号重新发送插件消息，验证真实 token 链路是否继续到 DashScope。
- 若后续新注册用户仍出现 403，需要通过后台管理或初始化流程给对应 CloudBase Auth uid 写入 `user_accounts.status=active`。
