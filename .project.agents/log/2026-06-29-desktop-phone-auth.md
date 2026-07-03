# 桌面端手机号验证码登录/注册接入

- **日期**：2026-06-29
- **关联**：PRD F9 / M4.5 后续产品用户登录
- **会话上下文**：用户要求把产品用户身份改为 CloudBase 注册用户，并补手机号登录注册能力。

## 做了什么
- 确认 CloudBase 当前环境 `wenxue-d8gz76tacc3659f05` 已绑定且 Auth 登录方式 `phone=true`。
- `LauncherAuthSession` 新增手机号验证码三步流：发送验证码、验证验证码、按 `is_user` 登录或注册，并继续通过 `/auth/v1/user/me` 强制校验 `type=external`。
- `DesktopBridge` / preload / renderer 类型新增 `auth:sendPhoneCode` 与 `auth:verifyPhoneCode`。
- 启动器账户面板默认提供手机号验证码登录/注册，并保留用户名密码备用登录。
- 补充 Vite CSS 类型声明，使桌面 renderer 可通过独立 TypeScript 检查。
- 同步更新 PRD、ARCHITECTURE 与 ROADMAP。

## 提交
- 未提交，用户未要求提交；当前工作树包含源码、文档和 `pnpm -F desktop build` 生成的桌面 `out/` 产物。

## 状态变更
- 架构文档：更新 `LauncherAuthSession` 输入/接口与 `DesktopBridge` IPC 契约。
- 需求文档：更新 F9 为手机号验证码登录/注册默认入口，用户名密码为备用入口。
- 测试：`LauncherAuthSession.test.ts` 覆盖发送验证码、已注册手机号登录、新手机号注册、无效手机号拒绝；`DesktopBridge.test.ts` 覆盖新增 IPC。

## 验证
- `npx pnpm@9.15.0 -F desktop test`：通过，68 tests。
- `npx pnpm@9.15.0 exec tsc -p apps/desktop/tsconfig.node.json --noEmit --pretty false`：通过。
- `npx pnpm@9.15.0 exec tsc -p apps/desktop/tsconfig.web.json --noEmit --pretty false`：通过。
- `npx pnpm@9.15.0 -F desktop build`：通过。

## 下一步
- 用真实手机号走 CloudBase 短信验证码实测，确认短信送达、注册分支和登录分支都能拿到外部产品用户会话。
- 如需发布本轮改动，检查并决定是否一并提交 `apps/desktop/out/` 构建产物。
