# 正式发布、公告与更新：P1 核验记录

- **日期**：2026-09-25
- **关联**：[实施计划 P1](../docs/superpowers/plans/2026-09-25-desktop-release-notifications-updates.md#p1--复现与配置核验)
- **代码基线**：`7362c7d`；本轮文档基线 `123ec84`，分支 `codex/release-notifications-updates`。
- **状态**：已完成本地验证与生产只读核验，形成三条链路证据表。P1 整体尚未验收：GitHub 认证、指定测试账号及 Windows/Intel Mac 实机条件未就绪或未确认。
- **执行分工**：主 Agent 负责诊断与验收；Luna 清点 CI/安装包；Sol 执行冻结依赖安装、测试与类型检查。子 Agent 遇到阻塞先回报主 Agent。

## 1. 三条链路的结论

| 链路               | 已核实证据                                                                                                                                                                                                                            | 结论与修复归属                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前安装包更新检查 | 现有 DMG 与 `/Applications/问学.app` 内版本均为 `0.1.0`、通道 `beta`、`manifestPublicKey` 编译字面量为空。`DesktopUpdateService.start()` 在打包模式下遇到空公钥直接进入不可重试错误，提示“此构建未固定更新签名公钥，更新检查不可用。” | 明确的构建配置缺口。旧包无法依靠更新检查自行修好公钥，需手动安装一次过渡版；P4 构建时必须绑定公钥，不能重新分发当前空公钥包作为更新过渡版。未启动用户的已安装应用，本项证据来自包内字节与确定的代码分支。 |
| 后台正式发布       | 生产 `desktop_release_candidates`、`desktop_release_rollouts` 均为 0 条。实际 update-policy 请求返回 HTTP 200、`{"policy":null}`。两份本地 CI workflow 存在，但本机无可用 GitHub 认证。                                               | 当前环境没有可发布候选或已生效版本。无法据此断言远端 workflow 不存在或曾执行失败；P4 需实际构建、上传、注册并验收。                                                                                       |
| 公告发布与接收     | 生产 `client_announcements`、`client_announcement_receipts`、`admin_dispatch_audit` 均为 0 条；未授权管理接口和 pending 接口返回 401。8 个相关集合及权限存在。没有指定的两个测试账号和已登录测试管理员会话。                          | 只能证明接口可达和未授权边界成立，尚未复现“管理员发布后收不到”的完整路径。P3 需定向测试账号完成发布、接收、确认与跨设备去重，不能把空集合或单测通过当成端到端通过。                                       |
| 后台下载与退出安装 | 当前包没有 `electron-updater` 依赖，现有分发仅 `manual-unsigned`；更新服务仅支持主动下载与打开安装器。                                                                                                                                | 是待实现功能，不是把某个生产开关打开即可恢复。按 P2/P5 实现平台协议、策略复核、进程安全退出和结果记录。                                                                                                   |

## 2. 依赖、产物与设备

### 实际锁定版本

| 项目                                     | 版本/结果                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| 验证命令运行时                           | Node `22.22.3`、pnpm `9.15.0`                                                           |
| Electron / electron-builder              | `33.4.11` / `26.15.3`；不能将 package.json 的最低范围 `^26.0.12` 当成实际 builder 版本  |
| CloudBase Web / Node SDK                 | `2.30.0` / `3.18.3`                                                                     |
| Functions Framework / Puppeteer browsers | `1.18.2` / `3.0.4`                                                                      |
| Chrome for Testing                       | `149.0.7827.55`；锁文件平台 `mac-arm64`、`mac-x64`、`win64`                             |
| 本机                                     | 主 Agent `sw_vers` 验收为 macOS `26.5`、build `25F71`、arm64；纠正清点报告误记的 `25.5` |
| 未确认环境                               | Windows x64、Intel Mac、最低系统版本实装环境                                            |

Electron 33 的官方最低要求是 macOS 11；当前 Google Chrome 系统要求为 macOS 13 和 Windows 10（x86 平台）以上。两者不是本产品的实机认证结果，不能仅凭 Electron 声称内置 CfT 支持同样的最低版本。P4/P7 应核对锁定 CfT 的实际产物要求，再确定对外支持矩阵。来源：[Electron 重大变更](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-1015-support)、[Chrome 系统要求](https://support.google.com/chrome/a/answer/7100626?hl=en)。

### 现有旧包

只在原工作树 desktop 的 `dist`、`out`、`release`、独立工作树同路径及 `/Applications/问学.app` 范围清点，没有搜索用户资料或读取用户画像。DMG 只读挂载核验后已卸载。

- 原工作树 `apps/desktop/release/WenXue-0.1.0-mac-arm64.dmg`：`277227657` bytes。
- DMG SHA-512：`a97540d09781d39f75b0e8dc1b5a34394f925b202b25f8bd8b95908a0c3229c91e69c5d2b91b24949b909836234d49766a877fe07d439c89422619177a5fdc19`。
- DMG 内 app.asar SHA-512：`508fae79486f7b790e28570f1e305a20a9a5501c907694dc0381d667dd5a8f9ceae4808fa9e488224640674efe000c163b8c0f953bc4a5fa7ff7f5fffa9bf059`。
- 已安装 app.asar SHA-512：`60e3fb9a3820a9099a903aae9d02f37ffa423849db267ca2f346ab058e7852a5460e996972b1cba389ec40743b03f2c24f5562a104d30b21af4e602220499c6a`。
- 两份 app.asar 不同，不宣称已安装应用来自当前 DMG。文件日期不证明曾向哪些用户分发。
- 两份包内 main/renderer 的网关均为下文 B，beta 通道且公钥为空，无法计算验签公钥指纹。
- 指定清点范围未发现其他 DMG/EXE；不能据此断言其他位置没有已分发旧版。

## 3. 生产服务、路由和 CORS

生产环境 `wenxue-d8gz76tacc3659f05`，区域 `ap-shanghai`，环境/数据库正常。组合服务 `wenxue-llm-gateway-036` 正常、100% 流量，DeployTime `2026-09-23 02:56:30`、BuildId `2607262307`。本次未部署或修改资源。

服务端 Ed25519 公钥、CI token、event HMAC 和 CAM 凭据对均已配置；只记录存在性，未输出或写入任何密钥值。客户端公钥为空，因此与服务端的可用公钥配置不匹配。

端点代号：

- A：`https://askwenxue.com`
- B：`https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com`（现有包实际内嵌值）
- C：`https://wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.app.tcloudbase.com`
- D：`https://wenxue-llm-gateway-4037646-1427406869.ap-shanghai.run.tcloudbase.com`

以下为 HTTPS 请求，带 `Origin: https://askwenxue.com`，无 bearer；不是登录操作验收。policy 使用 `runtime=electron&platform=darwin&arch=arm64&channel=stable&version=0.1.0&installIdHash=` 加 64 个 `a`。

| 方法/路径                                              | A                         | B                        | C                  | D                 |
| ------------------------------------------------------ | ------------------------- | ------------------------ | ------------------ | ----------------- |
| GET `/healthz`                                         | 404 HTML                  | 200 JSON                 | 404 `INVALID_PATH` | 200 JSON          |
| GET `/admin/`                                          | 200 HTML                  | 200 HTML                 | 200 HTML           | 200 HTML          |
| GET `/api/admin/v1/announcements`                      | 401 `Missing admin token` | 401                      | 401                | 401               |
| GET `/api/admin/v1/release-candidates`                 | 401 `Missing admin token` | 401                      | 401                | 401               |
| GET `/v1/client/announcements/pending`                 | 404 HTML                  | 401 `Missing user token` | 401                | 401               |
| GET `/v1/client/update-policy`                         | 404 HTML                  | 200 `policy:null`        | 200 `policy:null`  | 200 `policy:null` |
| OPTIONS `/api/internal/v1/release-candidates/register` | 404 HTML                  | 204                      | 204                | 204               |

管理 API 在 A/B/D 返回 `Access-Control-Allow-Origin: *`；C 的管理、pending、policy 实际响应包含 `https://askwenxue.com,*`，而 OPTIONS 为单个 origin。记录为已观测 CORS 配置冲突，浏览器端复现与修复仍待执行，不能直接将其归因为所有客户端的公告故障。

管理面返回全环境 38 条 route；A 有 14 条，包含静态根站和管理路径，但没有 client/internal 路由。C 有 18 条，包含本功能 client/internal 路由。B/D 直接暴露组合服务。由此不能把 CI `WENXUE_GATEWAY_BASE_URL` 直接改为 A；须先补齐/验证路由和 CORS。当前包使用 B，A 的缺路由不是它的直接故障证据。

### 请求预算与外层限制

- 环境配置显示 `QpsQuota=500`、`QpsCustomLimit=-1`，是配置值，不是实际负载测试。
- 服务配置 min=1、max=2 实例；应用内 policy 限制为每分钟每 IP 5000 / 每进程 50000，events 为每 IP 60 / 每进程 2000，Map 最多 2048 个键。
- 应用内“global”计数在单进程内，不是多副本统一 QPS；事件每日共享配额另通过数据库维护，不能替代入口限流。
- 所查询 route 的 `QPSPolicy` 为空，B/D 的 `EnableSafeDomain=false`、`EnableAuth=false`，直接 GET policy 确实可达。未证明存在覆盖所有域名的 WAF/共享入口限流，不能声称默认源站已有同等保护。
- 没有进行生产压力测试、发送大量匿名事件或消耗真实发布配额。

## 4. 账号、集合和权限

- Auth 登录配置：email 与 username/password 开启，anonymous 关闭。本项目锁定 Web SDK 2.30.0，不套用 SDK 3.x 的匿名登录行为推断现有 watch 是否可用。
- `admin_users` 投影只查 role/status：1 条 active admin，0 条 viewer。没有输出 UID、邮箱、密码或 token；这不能替代真实 admin/viewer 登录验收。
- `client_announcements`、`client_announcement_receipts`、`desktop_release_candidates`、`desktop_release_rollouts`、`desktop_release_events`、`admin_dispatch_audit` 为 ADMINONLY。
- `desktop_announcement_signal`：登录后仅可读 global 或 `doc.uid == auth.uid`；create/update/delete 均 false。
- `desktop_release_signal`：公开只读；create/update/delete 均 false。
- announcement signal 1 条，release signal 3 条；实际登录 watch、目标账号过滤、重连/离线补发仍待测试账号验证。
- 回执 `announcement_uid_unique` 确认为唯一复合索引，events 的 `release_created_cursor` 存在。
- 两个 expiresAt 索引存在，但本轮 `listIndexes`/`describeCollection` 的返回均不包含 `expireAfterSeconds`。**不能仅凭索引名称确认 TTL 生效**；历史“TTL 已配置”不代替当前复核。
- ACTIVE/BLOCKED、目标匹配、回执去重、viewer 拒写等已通过本地既有测试；未将其表述为生产账号实测。

## 5. GitHub 与 COS

- origin：`https://github.com/SmartSunruiyang/WenXue.git`。本机未安装 `gh`；`git ls-remote origin HEAD` 因无法取得 GitHub 用户名失败。
- 未认证 GitHub API 对 repository/workflows/environments 返回 404，对 vars/secrets 返回 401。这是访问阻塞，不能判定远端资源不存在。
- 本地两份工作流均要求受保护 ref。需核实远端保护规则、`desktop-release-production` Environment、审核人与实际运行记录。
- 公共 variables：`WENXUE_GATEWAY_BASE_URL`、`WENXUE_RELEASE_ED25519_PUBLIC_KEY`、`WENXUE_UPDATE_COS_BASE_URL`。
- 发布 secrets：`WENXUE_RELEASE_ED25519_PRIVATE_KEY`、`WENXUE_UPDATE_COS_SECRET_ID`、`WENXUE_UPDATE_COS_SECRET_KEY`、`WENXUE_UPDATE_COS_BUCKET`、`WENXUE_UPDATE_COS_REGION`、`WENXUE_RELEASE_CI_TOKEN`、`WENXUE_RELEASE_REGISTER_URL`。只核对配置项名称，没有读取远端 secret 值。
- COS `wenxue-desktop-releases-1427406869` 的匿名根目录列举返回 403 `AccessDenied`，随机不存在对象返回 404 `NoSuchKey`。未写入/删除对象，未尝试覆盖已有包。
- 专用 CI CAM 身份、写权限、现存对象清单与 versioning Closed 的当前值尚未认证核验。未复用服务端高权限凭据作为 CI 身份；历史 CAM 权限不足不作为今天的实测结论。

## 6. 本地验证

在独立工作树使用 Node 22，`pnpm install --frozen-lockfile` 成功，锁文件未变化。

| 命令                                                                                                                                                                             | 结果              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `pnpm -F @wenxue/client-operations test`                                                                                                                                         | 13/13             |
| `pnpm -F admin-api test`                                                                                                                                                         | 113/113，4 个文件 |
| `pnpm -F desktop exec vitest run src/renderer/src/DesktopAnnouncementService.test.ts src/renderer/src/DesktopReleaseSignalService.test.ts src/main/DesktopUpdateService.test.ts` | 33/33，3 个文件   |
| `pnpm -F desktop typecheck`                                                                                                                                                      | 通过              |

共 159 项测试。未运行真实安装、退出升级或跨设备公告实验；未新增测试或业务代码。

文档验收：5 篇变更文档经 Prettier、`git diff --check`、5 个新增相对链接/锚点检查；计划保持 50 项，仅 P0 四项及 P1.7 勾选。Luna 交叉审阅未发现阶段状态冲突，主 Agent 复核已安装 app.asar 的空公钥和 beta 编译值。

## 7. 下一步与门禁

1. 补齐 GitHub 登录，核实远端工作流与受保护发布配置；无需在聊天中发送 token/密码。
2. 指定两个普通测试账号、测试管理员登录方式，以及 Windows x64 / Intel Mac 可用设备；仅向测试账号发送实验公告。
3. P2 先固定协议与兼容门禁。代码核验发现当前灰度分桶在客户端使用原始 installId，服务端 policy 只收到 installIdHash 并返回 percentage，尚未执行该分桶。新协议需明确定义双方同一算法与旧协议兼容，不能直接把“服务端已是唯一资格决策者”当成现状。
4. 按 P3/P4 修复并验证通知、CORS/路由和候选 CI；按实际冻结 builder `26.15.3` 选择更新器兼容版本，不能照抄之前针对 26.0.12 或 v27 的接口结论。
5. P5 接入自动下载和安全安装，再做 P7 两跳实机验收。生产无发布版本不等于可以跳过平台实测直接全量上线。

## 提交与工作区

- 前序 P0：`ccc2b3a` 文档基线，`123ec84` 执行日志；初始计划 `9f1c11f`。
- 本段报告及计划状态修改在记录时尚未提交，待主 Agent 文档验收后统一提交；本次没有代码/云资源变更。
- 原工作区 `apps/extension/src/agent/visualObserve.background.ts` 仍是用户原有修改，没有复制、暂存或提交。
