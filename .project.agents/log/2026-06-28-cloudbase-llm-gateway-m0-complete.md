# CloudBase LLM Gateway M0 真实链路通过

- **日期**：2026-06-28
- **关联**：ROADMAP M4.5 / CloudBase LLM Gateway M0 spike
- **会话上下文**：接手时 M0 曾因 CloudRun 资源未就绪被记录为 blocked；本次继续后资源已正常，用户补充要求：smoke 身份必须是产品侧注册用户，不得用企业成员/内部成员代替。

## 做了什么

- 确认 CloudBase env `wenxue-d8gz76tacc3659f05`（ap-shanghai）已 READY，`wenxue-llm-gateway` 服务存在且可部署。
- 确认 Auth 配置：`usernamePassword=true`、`phone=true`、`anonymous=false`。
- 先用 Auth HTTP `/auth/v1/signup` 试探纯用户名密码注册，平台返回 `you can not signup just by username and password`；据此未继续伪造注册链路。
- 使用 CloudBase 管理面 `CreateUser` 显式 `Type=externalUser` 创建 M0 smoke 产品用户 `m0ext06281932`，并通过 `/auth/v1/signin` 登录，再用 `/auth/v1/user/me` 验证 `type=external`。
- 修复 CloudBase Functions Framework 入口适配：网关从 `context.httpContext.headers` 读取请求头，避免部署后丢失 `Authorization`。
- 增加回归测试，覆盖 Functions Framework 的 `httpContext.headers.authorization` 能正确进入 token introspection。
- 重新部署 `wenxue-llm-gateway`，上线版本 `wenxue-llm-gateway-004`，100% 流量。

## 提交

- 未提交，工作树状态：当前分支已有多项未提交/未跟踪改动，本段只在现有脏工作区上继续推进 M0，不单独提交。

## 状态变更

- 路线图：`ROADMAP.md` M4.5 全部勾选，记录延迟/token 基线。
- 实施计划：`2026-06-28-cloudbase-llm-gateway.md` M0 全部勾选。
- 网关代码：`apps/llm-gateway/src/index.mjs` 读取 `context.httpContext.headers`；`gateway.test.ts` 从 7 tests 增至 8 tests。
- CloudRun：`wenxue-llm-gateway-004` 正常上线，公开域名不变。

## 验证

- `npx pnpm@9.15.0 -F llm-gateway test` 通过：8 tests。
- `npx pnpm@9.15.0 -F llm-gateway typecheck` 通过。
- 真实 M0 smoke 通过：
  - 身份：CloudBase Auth 产品侧外部用户 `m0ext06281932`，uid `2071249607247777793`，`type=external`。
  - 网关版本：`wenxue-llm-gateway-004`。
  - SSE chunks：6。
  - 端到端延迟：1075ms。
  - usage：`prompt_tokens=23`，`completion_tokens=11`，`total_tokens=34`。

## 下一步

- 可以进入 M1 网关硬化：完整 OpenAI 兼容透传、真实 usage 写入 `token_usage`、无效 token 拒绝、错误/超时处理。
- 真实产品注册链路不能使用纯用户名密码自注册；若后续需要自助注册测试，应走手机号/邮箱验证码，或继续使用显式 `externalUser` 的预置产品测试用户。
- M1/M2 完成前仍不得切扩展内置模型 baseURL，不得删除本地百炼 Key。
