# 后台用户管理接入权威 Auth 状态

- 日期：2026-09-18
- 状态：用户已批准修复方案（本任务“修复吧”）
- 模块：当前运行时 AdminApi、AdminConsole；遵循 `../../context/ARCHITECTURE.md`。

## 问题与验收

注册与网关已使用 CloudBase Auth，后台仍以旧 `user_accounts` 作为用户全集，导致新用户不可见，旧状态无法封禁。只读云端核对发现 8 个 Auth 账号、5 条旧记录，其中 4 个普通用户没有旧记录，另有冻结账号的旧标记仍启用。

1. 注册成功的 Auth 用户即使没有业务记录、没有模型调用，也应出现在后台；分页不得遗漏超过 100/500 的用户。
2. 用户状态、筛选、看板用户计数来自 Auth；旧记录只能补充备注和可用历史时间。不能让旧状态覆盖 Auth。
3. 管理员启用/禁用调用 TCB `ModifyUser`，回读验证后才能返回成功；viewer 无写权限，管理员不能冻结自身。
4. 每次状态请求先持久化审计意图，再执行外部变更，追加成功或结果未确认记录；外部失败不得返回成功。
5. 禁用后下一次内置模型请求在调用厂商前拒绝，重新启用恢复。保留既有账号级禁用语义。
6. 前端恢复状态编辑，展示用户名与 UID，保存后刷新真实状态、用量和用户统计。

## 实现边界

AdminApi 内新增 `cloudbaseAuth.mjs` 作为 TCB 管理接口适配器，使用服务端现有 Tencent Cloud 凭据；不增加 AdminApi 对 Gateway 的依赖，不下发管理凭据。`DescribeUserList` 以 100 条分页并支持 `UidList` 精确回读，严格校验 `ACTIVE/BLOCKED`。`cloudbaseStore` 保持既有公开 store 契约，将 Auth 身份与旧表备注按 UID 合并，按需创建备注记录。旧表不删除、不批量回灌状态，避免恢复已冻结账号。

组合 Gateway 继续复用 AdminApi targets；部署使用包含 AdminConsole 构建产物的既有白名单 staging。现有独立 admin 服务保留回滚用途。

## 验证

适配器测试覆盖分页、响应校验、超时、拒绝、状态回读；AdminApi 测试覆盖无旧记录的新用户、真实状态计数、权限、自我冻结保护、审计失败、状态往返与网关拒绝；执行后端 typecheck/test、前端 typecheck/build、浏览器交互检查与线上只读核对。
