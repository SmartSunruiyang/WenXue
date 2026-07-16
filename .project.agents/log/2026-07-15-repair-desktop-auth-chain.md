# 修复桌面端 CloudBase 注册登录链路

- **日期**：2026-07-15
- **关联**：ROADMAP「M4.5 后续 — 网关硬化与用户 session」M2 启动器用户账号；`2026-07-15-user-auth-repair.md`
- **会话上下文**：用户复现注册长期停留在「处理中」后显示 `Failed to fetch`。共享工作树在任务开始前已有 `apps/desktop/out/main/index.js` 改动；提交前的标准 production build 将该主进程产物刷新为当前源码状态并纳入认证修复提交，构建生成的 renderer hash 产物变化已移除。

## 根因

- 桌面端、主进程与插件原先默认使用的 `run.tcloudbase.com` 地址持续超时；同一 CloudBase Run 服务的 `run.wxcloudrun.com` 公网地址正常。因此原始 `Failed to fetch` 是网关入口不可达，不是 `@cloudbase/js-sdk` 整体不可用。
- TCB `CreateUser` 成功响应不保证返回业务可用 uid。注册 target 不能猜测 uid，也不能把用户名回查当成登录证明。
- 第一版两阶段修复在 Web Auth SDK 登录后尝试写 `user_accounts`，NoSQL REST 与 server SDK 都返回 `EXCEED_REQUEST_LIMIT`。管控面核查确认当前计费周期 40000 个环境资源点已耗尽，且未开启超限按量；这是环境共享资源池耗尽，不是某个数据库 SDK 或端点临时故障。

## 做了什么

- 将桌面端、主进程与插件默认网关统一切到已验证的 `run.wxcloudrun.com` 地址；为注册、SDK 登录和激活分别设置桌面端 12 秒等待上限，并把网络、超时和服务端错误转换成可执行的中文提示。
- 登录与注册提交前统一校验：用户名 5–24 位并匹配 `^[A-Za-z][A-Za-z0-9]*$`；密码 9–32 位、首字符为 ASCII 字母或数字、只允许约定字符，且至少覆盖小写字母、大写字母、数字、特殊字符中的三类。无效输入不进入 busy 状态，也不发 SDK 或网关请求；注册另校验确认密码。
- 注册改为两阶段：`POST /v1/auth/register` 重复校验凭据并调用 TCB `CreateUser(UserStatus=ACTIVE)`；桌面随后用实际 CloudBase Web Auth SDK `signInWithPassword` 证明本次密码，再携带 access token 调用 `POST /v1/auth/activate`，激活请求体不含密码。
- `activate` 不再写 NoSQL，而是在 10 秒上限内调用官方 `/auth/v1/user/me`，只接受真实 uid 与精确 `status=ACTIVE`。chat 与 usage summary 等受保护路由使用同一检查；`BLOCKED` 或其他状态在上游调用前拒绝。注册或激活绝不调用 `ModifyUser ACTIVE`，所以重复注册不能解封账号。
- 激活失败时桌面端尽力撤销刚建立的 SDK 登录态，不持久化半完成 session，也不覆盖原始错误。
- 网关增加 `/healthz`、注册格式防御、TCB headers/body 总超时、按来源 IP/username/单实例总量的限流和安全错误映射；密码、access token、refresh token、Tencent Cloud 凭据和上游敏感正文均不写日志或响应。
- 曾为数据库旁路临时评估 `@cloudbase/node-sdk`，但最终 Auth-native 方案不需要该依赖；package 与 lockfile 均未留下新增依赖。

## 状态与文档

- ARCHITECTURE、TECH-INFRA、UIUX、2026-07-02 auth plan/spec 与本次 repair plan 已同步为最终两阶段链路和 Auth `ACTIVE/BLOCKED` 权威模型。
- ROADMAP 的 M2 启动器用户账号按真实注册/登录/激活冒烟完成；session 交接、内置模型、tokens 云端展示仍按各自条目单独验收。
- 现有 AdminApi 仍读写 legacy `user_accounts`。该表已不再影响网关授权；资源点恢复与 AdminApi 迁移到 TCB `ModifyUser ACTIVE/BLOCKED` 前，运营封禁/解封需使用 CloudBase 用户管理或 TCB API。
- 因资源点已耗尽，`token_usage` 云端写入、usage summary 与后台 NoSQL 页面仍可能失败；注册登录链路已绕开该依赖，但不能把计量/后台链路表述为已恢复。

## 验证

- Desktop：15 files / 102 tests 通过；Node/Web TypeScript 检查通过；production build 通过，并刷新已跟踪的 `apps/desktop/out/main/index.js`。
- Gateway：最终 Auth-native 版本 1 file / 38 tests 通过；typecheck、Prettier 与 `git diff --check` 通过。
- Extension：46 files / 447 tests 通过；production build 通过，仍有任务前已有的 `Unrecognized target environment "es2025"` 警告。
- Lint：仓库根 `eslint.config.js` 直接导入 `@eslint/js`，但根 `devDependencies` 未声明该包，因此 ESLint 在加载配置前退出；本次未扩大范围修改依赖。
- 本地 Functions Framework：`/healthz` 200、无效注册 400、无 bearer 激活 401、激活 CORS preflight 204。
- 公网最终 revision：`/healthz` 200、无效注册 400、无 bearer 激活 401、CORS preflight 204；一次性用户完成 TCB CreateUser 201 → 桌面实际 `@cloudbase/js-sdk@2.30.0` 密码登录 → `/activate` 200。精确删除 `user_accounts` 返回 0，证明激活没有数据库写；Auth 测试用户删除成功 1。
- 桌面真实点击走查因本机锁屏未执行；表单行为由单元测试、typecheck、临时 production build 和实际 SDK 公网冒烟覆盖，不将其表述为 UI 点击验收。

## 提交

- `9e15766` fix(infra): repair CloudBase auth session flow

## 后续

- 资源点恢复后，将 AdminApi 用户列表/封禁/审计从 legacy `user_accounts` 迁移到 TCB `DescribeUserList` / `ModifyUser`，并核对是否存在只在旧表标记 disabled 的历史账号。
- 购买资源点、开启按量或等待下个计费周期后，重新验收 `token_usage`、usage summary 与后台 NoSQL 页面；计费变更需用户明确授权，本次未自动执行。
- 轮换早期诊断输出中曾出现的 CloudBase Run/Tencent Cloud 运行时凭据，并复核服务环境变量；本次未在无授权情况下改动生产凭据。
- 当前注册限流只覆盖单个 warm instance；扩大实例数或公开获客前补共享全局限流、告警与审计。
