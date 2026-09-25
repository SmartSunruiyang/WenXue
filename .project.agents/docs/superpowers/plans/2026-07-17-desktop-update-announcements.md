# 桌面手动更新提示与应用内消息推送实施计划

> 2026-09-25：以下保留历史任务与完成记录，不代表当前生产状态。Chromium 重构及其双域同步任务已废弃；当前工作按 [正式发布、公告与更新计划](2026-09-25-desktop-release-notifications-updates.md) 执行，已有手动协议在新计划 P2 更新，历史勾选不能代替新的生产/实机验收。

设计依据：[桌面手动更新提示与应用内消息推送设计](../specs/2026-07-17-desktop-update-announcements-design.md)

> 状态（2026-07-18）：共享契约、AdminApi/Gateway 业务实现、后台页面、Electron 消息/更新服务与
> 发布工作流代码已落地；CloudBase 数据资源、18 条路由、Gateway 030 / AdminApi 012 / AdminWeb 007、
> CloudRun 服务端配置与独立 COS 桶已上线。Gateway/WAF QPS、直达域名收口、GitHub/CAM 发布身份、
> 真实候选和三平台 `manual-unsigned` 真机安装交接 E2E 仍未完成，因此发布闭环尚未验收。

> 执行顺序遵循“协议与数据 → 云端 API → 后台 → 消息客户端 → 更新服务 → 完整性发布验证”。每个任务
> 完成后更新本清单，并按项目规则在独立可验收里程碑完成时写 execution log。

- [x] 1. 冻结双运行时行为、模块和协议
  - 同步当前 Electron 的 ARCHITECTURE、TECH-INFRA、UIUX、ROADMAP
  - 同步目标 Chromium 的 PRD、ARCHITECTURE、INFRASTRUCTURE、PLAN、TESTING、UIUX
  - 登记 `@wenxue/client-operations` 为一方共享包；I5 只约束 `@page-agent/*` vendor
  - _Requirement: R1-R11_

- [x] 2. 建立 `@wenxue/client-operations` 契约与固定展示组件
  - 定义 Announcement、ReleaseCandidate、ReleaseRollout、UpdatePolicy、UpdateState 及 API DTO
  - 实现无副作用输入校验、semver audience 匹配、稳定 rollout 分桶和 URL 校验
  - 实现后台预览与桌面实际展示共用的固定 AnnouncementDialog/UpdateDialog
  - 用单元/组件测试覆盖边界和可访问性，不在共享包发起网络或持久化
  - _Requirement: R2, R4, R6-R9, R11_

- [x] 3. 扩展 AdminApi 存储与权限边界
  - 增加八个 NoSQL collection adapter、索引/权限声明和 signal revision 原子更新
  - 在 `desktop_release_rollouts` 内以 `recordType=release-slot` 保留文档原子维护每通道 active/current/
    highestVersion，rollout 列表过滤 slot；`admin_dispatch_audit` 仅追加审计
  - 实现 admin/viewer 角色矩阵、不可变审计、消息回执幂等和 30 天更新事件清理
  - 对所有日志和错误做敏感字段移除
  - _Requirement: R1-R3, R5-R6, R10_

- [x] 4. 实现消息管理与客户端 API
  - 实现 announcements 列表/发布/撤回、pending 拉取和 ack 接口
  - 在服务端按 uid、平台、包含式版本范围、状态、有效期和回执过滤
  - 在 Gateway 与独立 AdminApi 回滚运行时注册相同精确路由并复用唯一业务实现
  - _Requirement: R1-R4, R10_

- [x] 5. 实现候选注册与发布策略 API
  - 实现 CI bearer 鉴权、Ed25519 清单验证、不可变候选幂等注册
  - 实现候选/发布列表、publish、pause、resume、withdraw 和 release signal
  - 强制更新只接受 100%，每个 runtime/channel 只保留一个 active rollout
  - 实现无 uid 的 update-policy 和 update-events 接口；策略签发绑定匿名安装坐标的短期
    event token，但 token 只防随意伪造，健康率仍为 advisory；生产 QPS 在任务 11 配置
  - _Requirement: R5-R7, R9-R11_

- [x] 6. 增加后台“消息推送”入口
  - 使用 hash 路由接入现有导航，不新增不必要的路由依赖
  - 实现标题、正文、详情 URL、重要性、平台、版本、UID、有效期表单
  - 右侧复用固定组件实时预览；下方展示不可编辑历史与撤回动作
  - admin 可立即发布，viewer 只读；字段错误就地呈现
  - _Requirement: R1-R4_

- [x] 7. 增加后台“版本更新”入口
  - 展示 verified 候选、Ed25519 清单公钥指纹、`manual-unsigned` 标记、平台矩阵、测试证据和不可修改产物字段
  - 支持通道、1/5/25/50/100%、optional/mandatory、最低支持版本和发布说明
  - 支持一键发布、暂停、恢复、撤回；mandatory 自动锁定 100%
  - _Requirement: R1, R5-R6_

- [x] 8. 实现 `DesktopAnnouncementService`
  - renderer 在登录/启动时拉取，监听 announcement signal，并在失败时指数退避与 15 分钟轮询
  - 维护重要优先、同级从旧到新的单弹窗队列；登出清空并停止所有订阅
  - 普通关闭即 ack，重要消息只有“我知道了” ack；撤回关闭当前弹窗
  - 详情链接经 `app:openExternal` 的 HTTPS 边界打开
  - _Requirement: R3-R4, R10_

- [x] 8.1 实现 `DesktopReleaseSignalService`
  - renderer 使用 CloudBase Web SDK 监听公开 release signal，失败时指数退避并以 4 小时轮询兜底
  - revision 变化时只发送 `updates:check(reason='signal')`，不读取策略、不持有更新状态且无需登录
  - 卸载时关闭 watch/timer；main 进程不得加载 CloudBase Web SDK
  - _Requirement: R7, R10-R11_

- [x] 9. 实现 `DesktopUpdateService` 与 typed IPC
  - 主进程实现 `manual-unsigned` 下载、SHA-512/size 校验和系统 shell open
  - 实现启动延迟、4 小时、renderer signal intent 与手动检查，持久化随机 installId
  - 实现含 `opening | handedOff` 的 UpdateState、下载进度、打开前实时策略复核、策略 freshness 与
    dev unavailable；缓存 mandatory 可支持 24 小时内的离线门禁/下载，但不能授权打开安装包
  - 通过 `updates:openInstaller` 打开已校验 DMG/NSIS；不关闭问学或运行画像，安装由用户和系统完成
  - _Requirement: R7-R9_

- [ ] 10. 建立未签名构建、Ed25519 清单、COS 候选和注册流水线
  - [x] `desktop-release-candidate.yml`：受保护分支构建 macOS arm64/x64 未签名 DMG + Windows x64
        未签名 NSIS，不接触发布凭据；生成
        `artifactSetSha512`/`buildRunUrl` seal，原字节产物和 seal 保留 30 天
  - [x] `desktop-release-publish.yml`：只接受同 commit 成功首轮 build run，重验原字节/seal；tests 必须
        精确为 `quality`、`manual-installer-integrity`、`manifest-tamper-rejection` 且都绑定同一
        `buildRunUrl`，然后才签署 candidate Ed25519 manifest、COS 上传与注册；无外部 evidence 输入
  - [x] COSCLI 必须读到 bucket versioning `Closed`，每个上传使用 `--forbid-overwrite`，再从公开源逐字节复核
  - [ ] 创建并保护 GitHub Environment `desktop-release-production`，配置 candidate manifest Ed25519/COS/register
        的最小权限外部变量，并实际产出 `manual-unsigned` 候选
  - [x] 创建专用 COS 桶，验证从未启用版本控制、公开读/禁止列目录和禁止匿名写
  - [ ] 创建最小权限 CAM CI 身份，实际上传候选并验证不可变路径与 CI-only write
  - [ ] 验证仓库、Actions artifact、日志和后台均不出现私钥
  - _Requirement: R5, R10-R11_

- [ ] 11. 配置 CloudBase 生产资源
  - [x] 创建 8 个 collection、索引/读写规则、4 个 signal seed，并为
        `desktop_release_events.expiresAt` 建立 `expireAfterSeconds=0` TTL
  - [x] 为健康事件与 rollout 历史新增 `release_created_cursor` 和 `runtime_channel_published` 索引
  - [x] 配置新增 11 条 HTTP 精确路由，统一公开域名现有 18 条 routes
  - [ ] 配置 update 公开端点 Gateway/WAF QPS，并关闭或等价限制绕过 Gateway 的 CloudRun 默认域名
  - [x] 创建独立 public-read/no-list、禁止匿名写、从未启用版本控制的 COS 桶，不修改现有私有桶
  - [x] 部署 Gateway 030 / AdminApi 012 / AdminConsole 007，并验证组合运行时与独立 AdminApi 回滚路径
  - 当前资源信号：环境查询为 `NORMAL`，账单侧仍为 `EnvActivated=no`、`EnableOverrun=false`；不将前者误记为账单/超额已就绪
  - _Requirement: R1-R7, R10_

- [ ] 12. 完成自动化与真实安装验收
  - 跑共享包、desktop、admin、admin-api、llm-gateway 的单测、typecheck 和 build
  - 集成验证消息发布/定向/watch/ack/撤回及候选注册/灰度/暂停/下载/打开安装包
  - 用 `manual-unsigned` DMG/NSIS 完成三平台 `0.1.0 → 0.1.1` 手动安装交接，验证清单/哈希篡改拒绝、
    系统未签名警告、打开安装包不关闭 CfT 与画像无损
  - beta 按 5% → 25% → 50% → 100% 观察；完成故障暂停和更高版本 hotfix 演练
  - 更新事件健康率只作 advisory 信号；event token 不能作为真实安装或自动扩大 rollout 的单一证据
  - _Requirement: R1-R11_
