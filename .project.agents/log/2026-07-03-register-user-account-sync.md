# 注册后自动同步 user_accounts

- **日期**：2026-07-03
- **关联**：F9 用户账号与网关会话 / CloudBaseLlmGateway / Launcher 注册
- **会话上下文**：用户确认 CloudBase Auth 用户与插件鉴权表是否同步，并要求“用户注册之后就可以直接使用插件”。

## 做了什么
- 调整 `apps/llm-gateway/src/gateway.mjs` 的 `/v1/auth/register` 链路：创建 CloudBase Auth `externalUser` 成功后，立即用同一个 uid 写入 `user_accounts`，状态为 `active`。
- `user_accounts` 记录包含 `_id=uid`、`uid`、`status=active`、`firstSeenAt`、`lastSeenAt`、`createdAt`、`updatedAt`，不保存密码、access token、refresh token、提示词正文或厂商 Key。
- 补充网关测试，覆盖注册时同时调用 Tencent Cloud `CreateUser` 和 CloudBase NoSQL `user_accounts` 写入。
- 更新 PRD、ARCHITECTURE、TECH-INFRA，明确 CloudBase Auth 是身份来源，`user_accounts` 是插件内置模型的授权镜像。

## 验证
- TDD RED：新增断言后，`pnpm -F llm-gateway test -- --runInBand` 因注册链路只创建 Auth 用户、未写 `user_accounts` 而失败。
- GREEN：实现同步写入后，`pnpm -F llm-gateway test -- --runInBand` 通过。
- 类型检查：`pnpm -F llm-gateway typecheck` 通过。
- 部署：CloudBase Run `wenxue-llm-gateway` 部署到版本 `009`，线上流量 100% 指向 `009`。

## 线上状态
- 已给 Cloud Run `wenxue-llm-gateway` 追加注册链路所需的 Tencent Cloud API 凭证环境变量，保留原有 DashScope、CloudBase EnvId、Auth、NoSQL API key 与超时配置。
- 冒烟暴露 TC3 `Authorization` 头格式问题：算法名后不能直接跟逗号。已修正并部署到 `011`。
- 冒烟继续暴露 TCB `CreateUser` 成功响应不返回 uid。已改为 `CreateUser` 成功但缺 uid 时，通过 `DescribeUserList` 按用户名回查 `Data.UserList[].Uid`，再写 `user_accounts`；已部署到 `012`。
- 最终冒烟：`/v1/auth/register` 返回 201，并写入同 uid 的 `user_accounts.status=active`；随后已删除冒烟 Auth 用户和测试授权记录。
- 当前线上流量 100% 指向 `wenxue-llm-gateway-012`。

## 最终验证
- `pnpm -F llm-gateway test -- --runInBand`：24 个测试通过。
- `pnpm -F llm-gateway typecheck`：通过。
- CloudBase Run detail：`DeployId=012`，`Status=normal`，`FlowRatio=100`，`HasTraffic=true`。
- 清理确认：CloudBase Auth 中无 `smoke070302...` 测试用户；`user_accounts` 中最终冒烟 uid 查询为空。

## 提交
- 未提交。工作树在本任务前已有大量未提交代码、文档和构建产物改动，本次只追加注册同步链路相关代码、测试、文档与执行日志。
