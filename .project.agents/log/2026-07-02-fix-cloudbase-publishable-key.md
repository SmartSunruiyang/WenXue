# 修复登录页缺少 CloudBase Publishable Key

- **日期**：2026-07-02
- **范围**：`apps/desktop`、`apps/admin`、`apps/extension`

## 背景

桌面端登录页在未配置 `VITE_CLOUDBASE_ACCESS_KEY` 时直接展示“缺少 VITE_CLOUDBASE_ACCESS_KEY”，同时 CloudBase Web Auth SDK 不会初始化，导致用户名密码登录无法进入真实鉴权链路。

## 处理

- 桌面端、后台、扩展统一保留 `VITE_CLOUDBASE_ACCESS_KEY` 覆盖能力，并在缺省时使用当前 CloudBase 环境的 publishable key 初始化 Web Auth SDK。
- 移除桌面端和后台登录页上的 env 缺失硬提示。
- 增加桌面端测试，覆盖缺省配置下 `cloudbaseConfig.hasAccessKey=true`。

## 验证

- `pnpm -F desktop test`：15 个测试文件、70 个测试通过。
- `pnpm -F extension test`：43 个测试文件、366 个测试通过。
- `pnpm -F admin build`：通过；保留 Vite chunk size 警告。
- `pnpm -F desktop build`：通过；保留 Electron/Vite 依赖弃用提示。
- `pnpm -F extension build`：通过；保留既有 Vite/esbuild target 警告。
- Computer Use：桌面端登录页不再显示 `VITE_CLOUDBASE_ACCESS_KEY` 缺失提示；用假账号登录返回“用户名或密码不正确。”，确认已进入 CloudBase 鉴权请求链路。

## 追加修复：注册页误触发 email/phone 校验

- **根因**：CloudBase Web SDK 当前公开 `auth.signUp()` 实现是 email/phone OTP 注册封装；传入 `username` 会被忽略，然后触发 `You must provide either an email or phone number`。
- **处理**：桌面端注册链路不再调用公开 `auth.signUp()`；改为使用 SDK 内部 `oauthInstance.authApi.signUp({ username, password, nickname })` 发起 username/password 注册，再回到 `signInWithPassword` 读取 session。
- **验证**：`pnpm -F desktop test` 通过，15 个测试文件、71 个测试；`pnpm -F desktop build` 通过。
