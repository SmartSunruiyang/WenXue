# 2026-07-03 修复注册登录链路

## 背景

桌面端注册页在去掉 email/phone 校验后仍显示“账号操作失败”。实际 CloudBase Web SDK 公共 signup 接口拒绝纯 username/password 注册，返回 `you can not signup just by username and password`。

## 处理

- 桌面端注册改为调用后端 `/v1/auth/register`，成功后再使用 CloudBase Web SDK `signInWithPassword` 登录。
- LLM gateway 新增 `launcherRegister` Function target，对应 `/v1/auth/register`。
- 后端注册口使用 Tencent Cloud TCB `CreateUser` 创建 `externalUser`，运行时读取 `TENCENTCLOUD_SECRETID`/`TENCENTCLOUD_SECRETKEY` 等环境变量并生成 TC3 签名。
- 注册失败时透传嵌套错误消息；用户名冲突映射为“用户名已存在”，未配置云 API 凭证映射为明确配置错误，不再吞成“账号操作失败”。
- 补充桌面端和 gateway 单测覆盖 username/password-only 注册、TC3 签名、Function target 和错误透传。

## 验证

- `pnpm -F desktop test`
- `pnpm -F desktop build`
- `pnpm -F llm-gateway test`
- `pnpm -F llm-gateway typecheck`
- 使用 CloudBase MCP 创建 external smoke user，验证 CloudBase Web SDK 登录返回 accessToken/refreshToken。
- 使用 Electron remote debugging + Computer Use 验证桌面注册页提交 username/password 后进入工作台。
- 验证后删除 smoke external users，避免占用应用用户配额。
