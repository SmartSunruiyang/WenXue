# 补齐旧注册用户授权记录

- **日期**：2026-07-03
- **关联**：CloudBase LLM Gateway 用户 session 鉴权
- **会话上下文**：用户反馈插件调用返回 `403`，错误为“当前用户未启用或已被禁用”。

## 做了什么
- 定位本机插件缓存 session：当前登录 uid 为 `2072724969494556674`，用户名为 `cdxui0703a`。
- 通过 CloudBase NoSQL 查询确认 `user_accounts[_id=2072724969494556674]` 不存在。
- 曾临时在 `user_accounts` 插入同 uid 的 `status=active` 授权记录；随后通过 TCB `DescribeUserList(Name=cdxui0703a)` 确认该用户在 CloudBase Auth 中不存在，说明它只是本机旧失效 session。
- 删除上述孤儿 `user_accounts` 记录，回读确认为空。

## 提交
- 未提交，工作树已有大量既有改动；本次只做云端数据修复和日志记录。

## 状态变更
- 架构文档：未改，现有架构已要求 CloudBase Auth 用户通过 `user_accounts.status=active` 授权。
- 需求/UI 文档：未改。
- 测试：
  - TCB `DescribeUserList(Name=cdxui0703a)` 返回 `Total=0`。
  - CloudBase NoSQL 回读确认孤儿 `user_accounts` 记录已删除。
  - 使用本机插件缓存 access token 调用 `/v1/usage/summary` 与 `/v1/chat/completions` 返回 401；随后确认 refresh token 已失效，需要用户重新注册/登录生成新 session。

## 下一步
- 用户在桌面启动器退出登录，重新注册或登录一个实际存在于 CloudBase Auth 的账号，再启动/同步浏览器 profile。
- 新注册用户已由网关 `/v1/auth/register` 自动写入 `user_accounts.status=active`；若仍出现 403，优先检查本地 session 是否是旧 token。
