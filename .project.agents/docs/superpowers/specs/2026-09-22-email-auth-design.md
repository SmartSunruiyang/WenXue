# 邮箱认证与延迟创建账号

- 状态：用户已确认需求并授权在理解充分后实施；2026-09-22
- 权威：目标 PRD F10、当前 ARCHITECTURE ConsoleUI / CloudBaseLlmGateway / AdminApi、UIUX §登录
- 用户已明确授权撤销原手机号认证未提交改动，在当前工作区实施；旧测试应用账号可清理。

## 产品契约

1. 登录首页只有「使用密码登录」与「使用邮箱继续」。两者使用完整邮箱；昵称可重复，仅展示。
2. 邮箱发码及验证码校验仅创建短期验证挑战，不创建 Auth 用户，不产生登录会话。
3. 已注册邮箱通过验证码后登录同一 UID；新邮箱进入注册资料页。
4. 注册资料必须包含昵称、密码与一致的确认密码；头像可选。仅点击完成注册且校验通过后调用建号接口。
5. 关闭、刷新、返回、切换邮箱均丢弃验证凭据及未提交资料；不落盘，不创建待注册账号。下次从邮箱验证开始。
6. 注册完成获得 CloudBase 会话，再经网关真实 UID / ACTIVE 校验进入工作台。数据继续按 UID 隔离。
7. 忘记密码：完整邮箱 → 邮箱验证码 → 新密码与确认 → 重置成功返回密码登录，不改变 UID。
8. 手机号登录、绑定、用户名注册与旧注册后端退场。平台邮箱与密码能力开启，短信能力关闭；不启用匿名登录。

## 接口与状态

CloudBase SDK 2.30 分步接口：`getVerification({email,target:'ANY'})` → `verify({verification_id,verification_code})`，使用默认验证版本得到 `verification_token`。官方发码接口的 `is_user` 是可选字段：`true` 表示已有用户，`false` 或省略均表示未注册；客户端按缺省 `false` 处理。该字段只作发码时快照，最终注册冲突以平台结果为准。

发码成功冷却按规范化邮箱维护，同邮箱的登录/密码重置共享，不同邮箱独立；成功回包后即记录，取消或迟到不抹掉。所有发码入口读取同一冷却状态并显示剩余等待时间，验证码校验与密码登录不受影响。平台明确限流使用结构化等待时间，未提供时只做客户端退避；“可重试”不等于保证平台放行，不自动重发、不通过刷新绕过平台限制。

新用户：只在提交完整表单时 `signUp({email,verification_token,password,name:nickname})`；`username` 不传。旧式直注册分支抛异常、返回 LoginState，最终使用 `getSession()`读取会话。已注册用户使用 `signIn({username:email,verification_token})`，这里 username 是底层接口字段名，不是产品用户名。

重置密码：`getVerification({email,target:'USER'})` → 默认 `verify` → `resetPassword({email,verification_token,new_password})`。注册与重置验证凭据按返回 expires_in 过期，校验与消费只驻留内存；冲突、取消、超时结果不明都不能自动创建第二个用户或覆盖已有用户密码。

`cloudbase.ts` 持有挑战与业务编排；`EmailAuthScreen` 属 ConsoleUI，只呈现初始、密码、验证码、注册与重置视图并发送意图。保持现有验证码挑战、单飞与迟到会话清理、UserSessionStore 和 safeSignOut。

头像提交前仅本地预览；完成注册提交后才上传。采用平台头像上传能力或受用户身份保护的云存储；不将短期下载 URL 当永久地址。头像上传失败应可重试且不能重复建号；不提供未认证上传入口。

注册句柄通过 `state` 显式区分 `pending`、`needs-verification`、`confirming-account`、`avatar-pending`、`needs-login`、`complete`。建号被明确拒绝时回邮箱验证，不能声称账号已创建；已建号后的临时网络/5xx 错误只重试同 UID 的网关确认，成功后才进入头像保存；401/403 结束无效流程、清理会话并回密码登录。UI 不用无限过期时间判断头像重试阶段。

## 后台与数据

CloudBase Auth 是用户身份、邮箱、昵称及 ACTIVE/BLOCKED 状态的唯一来源。管理后台按 UID 关联用量与备注；旧 user_accounts 不再成为独立账号/封禁表。admin_users 保留管理权限，普通注册不授予管理员。

真实 `/auth/v1/user/me` 响应可能省略 `status`。网关先用该接口验证 token 和 UID，仅在状态字段缺失时，通过既有服务端 Auth 管理适配器精确查询该 UID 的平台状态；只允许 ACTIVE，查询异常或无匹配用户均拒绝。不能把字段缺失直接视为启用或禁用。

清理测试数据按应用测试 UID/历史测试记录限定，保留 CloudBase 内置系统管理员和发布配置；确认平台删除不会级联业务库。清理不能将旧本地浏览器资料交给新账号。云端切换在本地验证完成后执行，测试邮件需要用户提供邮箱并参与验证码验证。

## 视觉规格

目标：让用户完成邮箱身份验证与必要资料填写，操作步骤清晰、可返回。参考用户提供的深色登录截图：页面 #141414、表单 #111111、控件 #242424、主要文字 #F5F5F5、次要文字 #B0B0B0，白色主按钮。字体沿用项目 system-ui / PingFang SC / Microsoft YaHei；居中窄表单与大留白遵循用户参考，覆盖技能默认布局偏好。输入明确标签，错误就地显示，保留键盘提交、焦点与减少动态效果；不沿用原 2.1 秒品牌开场阻挡操作，不加入 Google 或第三方协议。

## 验收

- 新邮箱发码、校验与取消从不调用 signUp/signIn，不产生账号或会话；完成注册仅建一次。
- 验证码失效、注册冲突、异步迟到、取消与重复点击不得绕过流程。
- 昵称重复允许，空昵称/弱密码/不一致确认/无效头像不能触发建号。
- 已有邮箱验证码与密码登录使用同一 UID；重置密码也保持 UID。
- 头像上传、会话恢复、刷新、退出及工作台资料显示保持一致。
- 旧用户名注册端点不能建号；后台角色与封禁权限有回归覆盖。
- 单测/typecheck/build 通过，真实邮件与存储端到端结果如实记录，不以模拟测试冒充。

## 环境配置与运行核验

- CloudBase 控制台 → 身份认证：email 开启、usernamePassword 开启以支持邮箱密码；phone 与 anonymous 关闭。用户明确选择保留原自定义 SMTP：发件邮箱及账号为 `askforeverythingai@askwenxue.com`，服务器 `smtp.qq.com`、端口 `465`、SSL 开启。认证实现架构不依赖发件服务的选择，实际验收使用此自定义发件配置；恢复状态及送达结果见执行日志。
- 云存储保持 PRIVATE，客户端只能以登录用户身份读写自己的头像。实际 Web 开发 origin 使用精确 host:port 加入安全域；模拟界面预览不访问 CloudBase，不需要为它扩大白名单。
- 服务端账号创建旧路由返回 410；Auth 管理仅需 DescribeUserList/ModifyUser，已有 admin_users 的角色授权继续生效。内置管理员只能在后台专用账号入口登录。
- 首次真实收码验收：记录发码前、验证码后 Auth 用户数量应相同；取消注册后仍相同；最终提交完整资料后仅增加一个 UID。随后分别验证邮箱密码登录、邮箱码登录及重置密码保持该 UID，头像 fileID 可解析。
- 不以“前端校验”替代平台鉴权；本实现限制应用正常注册链路的建号时点，不声称修改了 CloudBase 平台底层 API 的所有注册策略。

接口依据：[邮箱注册](https://docs.cloudbase.net/authentication-v2/method/signup)、[发送验证码](https://docs.cloudbase.net/http-api/auth/auth-send-verification)、[验证码接口](https://docs.cloudbase.net/http-api/auth/auth-verify-verification)、[云存储安全规则](https://docs.cloudbase.net/storage/security-rules)。
