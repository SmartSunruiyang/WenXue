# 落地桌面更新与应用内消息推送，保留生产发布门禁

- **日期**：2026-07-17
- **最后更新**：2026-07-18
- **关联**：ROADMAP M4.7 / M5.1；
  [`desktop-update-announcements design`](../docs/superpowers/specs/2026-07-17-desktop-update-announcements-design.md)；
  [`desktop-update-announcements plan`](../docs/superpowers/plans/2026-07-17-desktop-update-announcements.md)
- **会话上下文**：用户已批准后台作为唯一人工更新发布入口，并要求一次性实施共享契约、云端 API、
  后台页面、Electron 消息/更新服务、Ed25519 清单候选 CI 与生产资源。本日志分开记录已上线的控制面、
  尚待外部授权的发布 CI，以及未完成的真机安装交接验收。

## 做了什么

- 新增一方包 `@wenxue/client-operations`，统一 Announcement/Release/Update 契约、输入校验、semver
  目标匹配、稳定分桶与后台/桌面复用的固定弹窗组件。
- 扩展 AdminApi 和 Gateway 共享 target，落地消息发布/撤回/pending/ack、候选注册、rollout 发布/暂停/
  恢复/撤回、update policy/events、revision signal 和不可变审计。
- update policy 以 HMAC event token 绑定 releaseId、installIdHash、runtime、platform、arch、
  fromVersion 与过期时间；update events 必须验证 token，并写入创建后 30 天的 `expiresAt`。
  token 只防未先获取 policy 的随意写入，不证明真实下载/安装；后台健康统计是 advisory。
- AdminConsole 增加“消息推送”与“版本更新”入口；消息页复用固定组件预览，版本页只能选择已验证候选
  并改变 rollout，不提供二进制上传/改写。
- Electron renderer 增加 `DesktopAnnouncementService` 和 `DesktopReleaseSignalService`；main 增加
  `DesktopUpdateService` 与 typed IPC。当前 Electron 更新固定为 `manual-unsigned`：用户点击后下载，
  SHA-512/size 校验通过后再次点击 `updates:openInstaller`，main 实时复核 policy 后由系统打开 DMG/NSIS；
  不关闭问学或运行中的 CfT。缓存 mandatory policy 可在 24 小时内维持离线警告/门禁与下载，但不能
  授权打开安装包。
- 消息链路收尾将 signal 拆为发布/撤回使用的 global 文档与确认使用的账号哈希文档；客户端同时监听
  两者并以 generation 隔离旧账号回调。pending 每批查询 50 条回执、找到 10 条未确认消息即停止；
  回执写入公告到期后 24 小时的 BSON Date，并以 TTL 为主、5 分钟节流且每次最多 20 条的删除为兜底。
  30 天消息定时器按 `2^31-1` 毫秒分段，避免浏览器 timeout 溢出。
- 发布 CI 已拆为 `desktop-release-candidate.yml` 与 `desktop-release-publish.yml`：前者在受保护分支构建
  未签名 DMG/NSIS，不接触发布凭据，并保留原字节/seal 30 天；后者只消费同 commit 成功首轮 build run，
  重验 `artifactSetSha512`，并要求 `quality`、`manual-installer-integrity`、
  `manifest-tamper-rejection` 三项 passed tests 都绑定同一成功 `buildRunUrl`，然后才签署 candidate
  Ed25519 manifest，以 COSCLI versioning `Closed` + `--forbid-overwrite` 上传并注册。build seal v2 还要求
  macOS arm64/x64 与 Windows x64 三个最终 `app.asar` 都内嵌同一个发布公钥，并将其 SPKI SHA-256 指纹
  绑定到 seal、candidate 与发布时配置；版本脚本统一复用共享的严格 SemVer 校验。
- 发布 rollout 使用确定性 idempotency key：首次发布响应丢失后，相同 key 与相同内容可安全重试并返回
  同一 rollout；相同 key 配不同内容仍返回冲突，且检查顺序不会被“该版本已发布”门禁提前截断。

## CloudBase 数据资源实际状态

- 环境 `wenxue-d8gz76tacc3659f05` 查询状态为 `NORMAL`，当前个人版有效期至 2027-02-01；账单侧仍显示 `EnvActivated=no`、
  `EnableOverrun=false`。这些信号不相互替代。
- 已创建 8 个 collection：`client_announcements`、`client_announcement_receipts`、
  `desktop_release_candidates`、`desktop_release_rollouts`、`desktop_release_events`、
  `desktop_announcement_signal`、`desktop_release_signal`、`admin_dispatch_audit`。
- 已创建业务索引与权限规则；announcement signal 为登录只读，release signal 为公开只读，其他六个
  集合为 `ADMINONLY`。
- 已初始化 `desktop_announcement_signal/global`、
  `desktop_release_signal/electron:dev`、`electron:beta`、`electron:stable` 共 4 个 revision seed。
- `desktop_release_events.expiresAt` 已建立 `expireAfterSeconds=0` TTL 索引；当时集合为空，
  不存在普通同名索引转换时的数据风险。
- `client_announcement_receipts.expiresAt` 已建立 `expireAfterSeconds=0` TTL 索引；
  `desktop_announcement_signal` 已切换为仅允许登录用户读取 `global` 或 `doc.uid == auth.uid` 的账号文档，
  代码、索引与生产规则均已同步。
- 已新增 `release_created_cursor` 与 `runtime_channel_published` 索引。
- `desktop_release_rollouts` 以 `recordType=release-slot` 文档维护 current/active/highestVersion，slot 不进列表；
  `admin_dispatch_audit` 只保存追加审计。
- `desktop_release_events` 在同一集合内以事务维护全局 UTC 日共享配额；默认每天 100,000 条并拆成最多
  32 个确定性 shard，事务冲突使用 25–400ms 指数退避与抖动。重复事件与失败后成功重试不重复计数，
  配额文档也由 TTL 清理。后台只为活动/暂停发布计算健康度，最多 6 个 rollout、每个最多扫描 2,000 条
  事件；历史记录和超出覆盖范围的活动记录会返回明确原因，避免无界查询或把“未计算”误报为“无事件”。

## 生产上线实际状态（2026-07-18）

- CloudBase 环境仍为 `wenxue-d8gz76tacc3659f05`。最终发布的 `wenxue-llm-gateway` 030、
  `wenxue-admin-api` 012 与既有 `wenxue-admin-web` 007 均为 `NORMAL`，各自当前版本承接 100% 流量。
- 统一公开域名 `https://wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.app.tcloudbase.com` 现有
  18 条 routes，其中包含本功能新增的 11 条消息、版本、客户端与 CI 精确路由。部署过程中误建到内部
  origin 的 routes 已清理，不再作为可用入口或回滚路径记录。
- 已创建独立 COS 桶 `wenxue-desktop-releases-1427406869`（`ap-shanghai`）。bucket ACL 为 private，
  bucket policy 只向匿名主体开放 `GetObject`，不开放列目录或写入；版本控制从未启用。对不存在对象的
  公网 404 probe 已验证匿名读取请求能够到达对象读取边界，同时未暴露对象列表。
- candidate manifest Ed25519 验签公钥、release CI token 与 event HMAC secret 已配置到 CloudRun；对应
  配置材料保存在本机 Keychain。日志和文档不记录任何密钥、token 或 secret 值，Ed25519 私钥不下发到
  CloudRun。
- 当前 Electron 继续使用 `manual-unsigned` DMG/NSIS，不配置或使用平台签名证书；平台签名材料不是
  当前 Electron 发布阻塞，也不得被描述为已启用。

## 仍待外部授权的发布项

- GitHub 仓库 variables/secrets 与受保护 `desktop-release-production` Environment 仍需完成配置；当前
  会话没有 GitHub 登录授权，不能代用户写入仓库或 Environment secrets。
- 专用 COS 写入必须使用最小权限 CAM CI 子账号。当前云身份缺少 `cam:ListUsers` 与创建用户权限，无法
  查看或创建该子账号；不得为绕过此限制复用权限更高的 Gateway 密钥。
- 在上述 GitHub/CAM 配置完成前，production publish workflow 不能真实注册候选；macOS arm64、macOS
  x64、Windows x64 的 `manual-unsigned` `0.1.0 → 0.1.1` 下载、SHA-512/size 校验、打开与系统安装器
  交接 E2E 仍未执行。因此可以表述控制面与生产资源已上线，不能表述发布 CI 或真机更新验收已完成。

## 文档与架构同步

- 当前 Electron 运行时的 ARCHITECTURE、TECH-INFRA、ROADMAP 与 UIUX 已同步模块、数据、信任边界、
  生产资源快照和固定交互。
- 目标 Chromium 文档的 PRD、ARCHITECTURE、INFRASTRUCTURE、PLAN、TESTING 与 UIUX 已同步跨运行时契约，
  但仍明确 Chromium 客户端未开工。
- 派生 spec/plan 已更新实施状态，把代码落地、数据资源建立、已上线控制面、外部 CI 授权和未签名安装
  交接验收分别记录。

## 提交

- 未提交。本轮工作是用户要求的大型实施会话，当前工作树中包含全部功能实现、资源宣告、文档与测试变更；
  用户未要求 stage/commit，因此未执行任何 Git 写操作。

## 验证状态

- 本次文档同步执行 `git diff --check -- .project.agents/docs .project.agents/log`，通过。
- `pnpm -r test` 全部通过，共 869 项；其中本功能相关为共享契约 13、AdminApi 68、Gateway 61、
  Desktop 142，合计 284 项；发布脚本另有 14 项通过。
- `pnpm lint:desktop-release`、AdminApi/Gateway/Desktop typecheck、AdminConsole build、Desktop 生产
  bundle 和两份 GitHub Actions YAML 校验均通过。
- 消息链路收尾另执行 AdminApi 全量 58 项、DesktopAnnouncementService 7 项测试，以及 AdminApi/Desktop
  typecheck、相关 ESLint、Prettier 与 `git diff --check`，全部通过。
- 最终收尾再次执行 AdminApi 68 项、全工作区测试、`pnpm lint:desktop-release`、AdminApi/Gateway/Desktop
  typecheck、AdminConsole/Desktop 生产构建与 `git diff --check`，全部通过。仓库级 `eslint .` 与
  `prettier --check .` 仍分别暴露 858 个既有 lint 问题和 165 个既有格式文件，主要来自 `.wxt` 生成物及
  历史模块；本功能范围检查为绿，未把本次交付扩大为无关的全仓格式重写。
- Gateway 030、AdminApi 012、AdminWeb 007、18 条公开 routes、CloudRun 安全配置与专用 COS 桶均已上线；
  未运行生产写入消息/rollout 冒烟，也未运行 `manual-unsigned` 安装包真机交接 E2E。
- Gateway 028 的首次生产只读冒烟发现 AdminConsole 被错误地以 `/` base 构建，导致页面引用的
  `/assets/*` 返回 404；未把该版本作为完成态。随后改用仓库固定的 `prepare:cloudbase-deploy` 白名单脚本
  重新生成 `/admin/` base 产物并发布 029，HTML、JS 与 CSS 均恢复 200。以后 Gateway staging 不得手工
  拼装 AdminConsole 产物。
- 最终 030/012 生产只读验收：Gateway `/healthz`、统一域名和独立 AdminApi 的 update policy 均返回
  200；消息 pending、后台 releases 与 CI candidate register 未带凭据均返回 401；`Origin: null` CORS
  预检返回 204 且 `Access-Control-Allow-Origin: *`；`/admin` 与其实际引用的 JS/CSS 均返回 200。

## 下一步

1. 由具备 GitHub 登录授权的仓库管理员配置 repository variables/secrets 与受保护
   `desktop-release-production` Environment；任何值只进入 GitHub secret store，不写入仓库或日志。
2. 由具备 CAM 用户管理权限的管理员创建专用最小权限 CI 子账号，只授予目标 COS 路径所需写入能力；
   不复用 Gateway 高权限身份。
3. 完成 GitHub/CAM 外部配置后运行候选 build/publish，验证固定三项 tests、Ed25519 candidate manifest、
   COS `Closed` 与 `--forbid-overwrite`、公开源逐字节复核和 AdminApi 幂等注册。
4. 用 `manual-unsigned` DMG/NSIS 完成 macOS arm64、macOS x64、Windows x64 `0.1.0 → 0.1.1` 下载、
   SHA-512/size 校验、系统未签名警告和安装器交接，再演练篡改拒绝、断网恢复、打开时 CfT 继续运行、
   画像无损、pause/withdraw 和更高版本 hotfix。
