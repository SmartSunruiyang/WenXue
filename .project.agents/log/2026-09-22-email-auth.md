# 邮箱认证替换手机号认证

## 2026-09-22 提交收口

- 用户明确要求先提交既有改动、清理工作区，再开始登录页浅色 UI 调整。
- 本次将邮箱认证、管理后台 Auth 目录、网关状态校验及对应测试/文档一并收口；下文“未提交”均描述此前检查点。
- 提交：本日志所在提交 `feat(desktop): 完成邮箱认证与账号管理迁移`。
- 提交前复核：认证服务与界面 92 项定向测试通过，`git diff --check` 通过。既有云端/真实邮箱验收及未完成项沿用下文记录，不扩大验收结论。
- 下一步：在干净工作区恢复登录开屏与密码匹配动画，实施浅色界面和先密码、后头像昵称的两步注册。

## 发码频率提示修复与验收

- 用户反馈“验证码发送过于频繁，请稍后再试”。现场为用户填写的另一测试邮箱 `3148420460@qq.com`，登录入口仍可点击，未显示等待时间。原失败请求未保留网络记录，不能断言当次提示来自本地冷却或 CloudBase 平台限流。
- 代码确认：旧服务层只有全局 `emailResendAt`，所有邮箱与登录/找回密码共用；旧 UI 只在验证码页显示倒计时，返回入口后缺失。发码成功后的取消检查还可能跳过冷却记录。这些缺陷已在 ConsoleUI 内修复，没有调整平台限制、SMTP 或后端服务。
- 现场仅重试一次即成功进入该邮箱的验证码页；用户随后完成邮箱校验，页面进入必填资料的注册页。此时远程 Auth 总数仍为 2（原应用账号与内置管理员），未出现该邮箱。返回邮箱登录取消注册后再次查询仍为 2，补齐“验证不建号、取消不建号”的真实环境证据。未提交新账号、未设置新密码。
- 契约已同步 ARCHITECTURE、UIUX 和设计：按规范化邮箱共享发码冷却；所有发码入口倒计时一致；平台限流保留明确来源和安全提示，结构化等待值优先，缺省退避不代表平台届时必定解除；不自动重发。
- [CloudBase 官方发码接口](https://docs.cloudbase.net/http-api/auth/auth-send-verification) 说明同邮箱 60 秒内一次、同 IP 每小时最多 10 次，并列出 `rate_limit_exceeded` / `4029`；此处只记录平台文档，未确认本次触发了哪一个限制。
- 服务提供 `getLauncherEmailResendAt(email)` 与 `LauncherEmailRateLimitError`，按规范化邮箱维护冷却；仅明确限流码或分类产生平台退避，不匹配任意含 limit 的字符串。结构化等待秒数须为有限正数；SDK 2.30 `getVerification` 原样抛出平台错误，兼容原始 `retry_after` 与 AuthError 的 `retryAfter`。没有可靠等待值时的 60 秒仅为客户端退避，不代表平台真实限制窗口。
- UI 的邮箱登录、找回密码与重发入口共用倒计时，返回/重挂载保持同邮箱等待，换邮箱重新计算；验证已收到的码和密码登录不受影响。重发失败后旧挑战已失效，回到同邮箱入口并清空旧码、保留冷却和错误；不自动重发。
- 验证：认证服务 76 项（cloudbase 25 + emailAuth 51）、UI 16 项，共 92 项定向回归通过；完整 desktop typecheck、最终 UI web typecheck、受影响文件 ESLint、Prettier 与 diff check 通过。覆盖跨邮箱/跨流程、返回/重挂载、精确平台限流映射、可信等待值、取消/畸形或迟到成功、超时单飞、失败重发恢复和验证码校验可用性。
- 最终重发恢复补丁后 desktop build 通过，renderer 为 `index-CxlgBpDz.js`；正常退出并重启开发实例后登录页可见。真实验证沿用上方成功发码及取消不建号证据，未人为触发平台限流、未额外循环发邮件。本次仅更新桌面，CloudRun 保持 035。
- 未提交：沿用用户授权的当前工作区，用户未要求创建提交或 PR。

## 真实注册 403 修复与剩余验收

- 用户完成邮箱验证及资料提交后，反馈“注册未完成，请稍后重试”。Auth 管理查询确认应用账号已创建：UID `2102112199236395008`、昵称 `test`、状态 `ACTIVE`；没有执行删除或重复建号。
- 真实窗口 Console 记录 `/v1/auth/activate` 返回 HTTP 403，目标为现有 `run.wxcloudrun.com` 服务域。用户再次密码登录复现身份校验失败；Network 显示 signin 200、user/me 200。真实 user/me 的 250 字节响应含正确 sub/email/name/type，但完全省略 status；Auth 管理查询同 UID 为 ACTIVE。网关把缺字段视为非 ACTIVE 是已确认根因；控制台只读检查自定义 OPA 策略为空，没有修改权限策略。
- 客户端恢复缺陷已修复：不再用 `expiresAt === Infinity` 推断头像重试；显式注册阶段区分建号前拒绝、账号确认、头像保存与需重新登录。401/403 引导重新登录，可重试错误只确认同一 UID，不再次建号。确定 signUp 被拒绝时不能虚报账号已创建。
- 后端修复已随 035 上线：只有 user/me 完全缺少 status 时，才经注入的 `getAuthUser(uid, timeoutMs)` 使用服务端 CAM 凭据调用 `DescribeUserList`，以 `UidList:[uid]` 精确查询真实 Auth 状态；不扫描全表、不默认 ACTIVE、不读取旧 user_accounts 状态。显式非 ACTIVE、查询到 BLOCKED 或用户不存在均拒绝；缺凭据、查询失败与 UID 不匹配均 fail closed。activate/chat/usage 与消息 pending/ack 已覆盖，查询共享现有鉴权剩余预算，激活总预算保持 10 秒。
- 035 上线后，原开发窗口 ForceReload 的 DOM 已挂载 `app-shell`、`sidebar`、`main-surface`，`aria-busy=false`，确认认证已通过，但该旧开发实例当时仍白屏。随后正常 Quit 并重启 dev，工作台已可见，账号菜单显示 `test` / `3305858734@qq.com`，原 UID 会话恢复成功。该检查点通过；未修改布局代码，也没有证据将白屏归因为 GPU。
- 首个邮箱注册前基线为 1 个内置管理员，用户直接提交后才取得该账号快照；其提交前检查点当时缺失。后续使用第二测试邮箱取得了“验证码通过但未提交”及取消后的远程快照，均无新账号，见上方发码频率调查记录。

- 用户随后确认“忘记密码验证已完成”（此前交接要求包含邮箱验证码、设置新密码及使用新密码登录）。只读管理查询确认邮箱仍对应 UID `2102112199236395008`、昵称 `test`、状态 `ACTIVE`，Auth 总数仍为 2（原应用账号与内置管理员），没有重复建号；LastLoginTime 为 `2026-09-21T19:38:46Z`。当前应用截图显示已登录的 Tokens 工作台。密码重置与原账号登录检查点通过；新密码由用户亲自输入并提交，未读取或记录。
- 状态：代码实现、035 云端部署、测试数据清理及原自定义 SMTP 配置恢复已完成；真实邮箱验证后建号、密码认证、忘记密码、重启后会话恢复及可见工作台检查通过。头像与完整验证码链路仍可补充真实验收，未宣称全部端到端通过。未提交（用户要求在当前工作区直接修改，未要求创建提交或 PR）。
- 依据：[设计](../docs/superpowers/specs/2026-09-22-email-auth-design.md)、[计划](../docs/superpowers/plans/2026-09-22-email-auth.md)。

## 授权与范围

用户要求邮箱验证码统一入口、邮箱密码登录，昵称仅展示且可重复。新邮箱验证后必须填写昵称及密码，头像可选；最终提交前不创建账号。取消后从邮箱验证重来。支持邮箱验证码重置密码。

用户拒绝创建独立工作区，随后明确要求撤销当前未提交的手机号改动并在当前工作区实施。已撤销指定的七个 tracked 文件及四份相关 untracked 旧计划/日志，确认干净后开始新改动。没有创建分支、提交或 PR。

## 实现

- ConsoleUI：内存中的邮箱验证挑战、最终注册、密码登录/重置；移除手机号绑定、用户名注册和未完成账号恢复。
- EmailAuthScreen：采用用户深色参考图，注册必填昵称/密码/确认、可选头像；保留键盘操作、人机验证码与安全退出。
- 头像提交前本地预览；最终提交后经已认证身份上传，Auth 保存 fileID，展示时解析短期 URL。失败重试不重复建号。
- Gateway：旧注册 target 返回 410；取消 CreateUser 路径和注册凭据处理。
- AdminApi：真实 Auth 用户目录与 ACTIVE/BLOCKED 管理；用量/备注仍以 UID 关联，admin_users 控制角色。后台保留内置管理员账号密码入口，普通用户桌面只接受邮箱。
- 已同步目标 PRD、当前/目标架构、UIUX 和 TECH-INFRA。

## 已完成验证

- 桌面全量 Vitest 273 项 + 发布脚本 14 项通过；之后补充的 UI 定向回归 11 项（含新增 1 项）、认证服务 58 项通过，最新 typecheck、build 通过。UI/服务定向结果单独记录，不冒充补充改动后的全量重跑。
- 035 后端修复验证：Gateway 87 项、AdminApi 101 项测试全部通过，两包 typecheck、受影响文件 ESLint、diff check 及 AdminConsole build 通过。回归覆盖缺省状态的 ACTIVE/BLOCKED/不存在/查询失败、显式状态不可覆盖、UID 错配、逐请求禁用生效、剩余预算及实际 target 注入。无新增依赖。
- 浏览器模拟界面验收：1280×720 登录/密码界面；920×600 注册表单可滚动到确认密码和提交。截图 `/tmp/wenxue-email-preview/screenshots/`；该预览只 mock 服务，不代表邮件/存储端到端通过。
- 交叉审查：桌面延迟建号、取消/超时/头像重试无阻断问题；发现并修复后台按旧快照跳过同值状态更新的问题，新增两种并发状态回归。显式状态操作总是写平台，requested/applied 审计对应实际操作。
- CloudBase code-review AUTH001/SEC001/STORAGE001 语义检查：路由基于 getSession，不回传凭据，头像存储现状 PRIVATE；实际开发 origin `localhost:5173` 安全域已为 ENABLE；未因 mock 预览添加无关安全域。
- 初次桌面测试的回环监听被沙箱 EPERM 阻止，用户批准沙箱外重跑后全部通过。默认 Node 26 的 pnpm shim 挂起，改用已安装 Node 22.22.3 / pnpm 9.15.0；未安装依赖。

## 云端进度

初始只读核验：邮箱与密码已开启、短信仍开启、匿名关闭；存储 PRIVATE。账号为 1 个应用测试 externalUser + 1 个内置 internalUser 管理员；admin_users 有内置管理员及 2 条悬空旧记录。

首次邮箱切换从 033 发布到 CloudRun `wenxue-llm-gateway` 034，RunId `1x8iuNFA5uvBGo`，BuildId `2607109111`。白名单 staging 为 `.cloudbase-deploy/email-auth-20260922`（Git ignored），13 个文件，逐字节核对 agent 构建包，含新 `cloudbaseAuth.mjs`。服务配置与 EnvParams 原样保留，不记录凭据值。

034 的两个公网入口均已实测：`healthz` 200、旧 `auth/register` 410、实际 CORS 预检 204、无凭据 `auth/activate` 401、管理用户 API 401、用量 API 401；AdminConsole 页面 200，静态资源与部署产物字节吻合。这些检查验证部署和鉴权边界。

状态缺省修复已从 034 发布到当前 035：`normal`、`FlowRatio:100`、`HasTraffic:true`、`IsReleasing:false`，DeployTime `2026-09-22 03:24:20`，BuildId `2607117927`，RunId `1x8jcidyBo3zT8`。部署前后配置经归一化比较无变化。修复 staging 为 `/tmp/wenxue-email-auth-status-20260922`，13 个文件、1,250,639 字节，四个更新 runtime 文件与源码逐字节一致。035 实测 health 200、旧 register 410、activate 无 token 401；真实账号认证与重启后可见工作台检查已通过，其他端到端项目仍按下文逐项验收。

认证配置已复核：短信关闭、邮箱与密码开启、匿名关闭；云存储保持 PRIVATE。实际开发 origin `localhost:5173` 已加入安全域并为 ENABLE。

已按授权范围删除以下测试数据并复核：

| 对象                             | 删除数量 | 清理后结果                        |
| -------------------------------- | -------: | --------------------------------- |
| CloudBase Auth 测试 externalUser |        1 | 测试 externalUser 为 0            |
| `token_usage`                    |       82 | 0                                 |
| `machine_accounts`               |        3 | 0                                 |
| `user_permission_audit`          |        6 | 0                                 |
| `user_accounts`                  |        5 | 0                                 |
| 悬空 `admin_users`               |        2 | 仅保留内置管理员对应角色记录 1 条 |

CloudBase 内置 internalUser 管理员及其后台角色已保留，未将普通注册用户提升为管理员。上述数量为清理后复核快照；后续真实验收新建账号另行记录。

最初真实新邮箱发码获得 HTTP 200，但平台响应省略 `is_user`，触发了客户端要求该字段必须为 boolean 的错误判断。[官方发码接口](https://docs.cloudbase.net/http-api/auth/auth-send-verification) 将其定义为可选字段，`true` 表示已注册，`false` 或省略表示未注册；适配层已按缺省 `false` 修复。随后用户完成邮箱验证及资料提交，取得本日志记录的新 UID；发码 HTTP 200 本身不作为送达或完整注册验收的依据。

用户明确选择保留原自定义 SMTP，发件邮箱及账号为 `askforeverythingai@askwenxue.com`，服务器 `smtp.qq.com`、端口 `465`、SSL 开启。认证架构不依赖发件服务选择。

本轮配置操作中，Agent 曾仅传 `EmailConfig.On: true` 调用 `UpdateProvider`，将邮箱 provider 切为平台内置发件配置；该更新整体覆盖了原 SMTP 配置，并非只切换开关。原查询只返回密码掩码，无法据此恢复授权码。Agent 已向用户明确说明这一操作疏漏，随后在 CloudBase 控制台 SMTP 表单填好发件地址、服务器、端口、SSL 和账号，由用户重新填写授权码并保存。未记录密码或授权码。

保存后已通过 `queryAppAuth` 复核自定义 SMTP 配置恢复：`providerOn: true`、`EmailConfig.On: false`，`SenderAddress` 与 `AccountUsername` 均为 `askforeverythingai@askwenxue.com`（已去除空格），服务器 `smtp.qq.com`、端口 `465`、SSL 开启，并确认已配置密码。重新发码曾触发图形验证码，随后用户完成邮箱验证并提交注册资料。此次发码前 Auth 基线为 internalUser 1 个、externalUser 0 个；提交后查询新增的 UID 已记录在上文。未保存邮件正文、密码或授权码。

TCB 管理接口依据：[DescribeUserList](https://cloud.tencent.com/document/product/876/127959)、[ModifyUser](https://cloud.tencent.com/document/product/876/127958)。服务端 CAM 凭据需要这两个操作权限，原网关部署已有密钥配置；本轮不新增密钥或扩大授权策略。

## 待完成

- 忘记密码验证已通过：用户确认完成重置及新密码登录，远程目录保持同一 UID，当前工作台可见。
- 邮箱验证码延迟建号已有真实证据：第二邮箱验证后和取消后总数保持 2；首个邮箱此前已完成最终提交并只创建一个 UID。
- 可补充头像上传/显示、已有邮箱验证码登录的真实验收；记录仍需用户参与的验证码环节。
- 汇总最终验证与交付结果；真实邮件与头像端到端结果不得由 mock 结果替代。
