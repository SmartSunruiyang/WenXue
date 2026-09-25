# 桌面手动更新提示与应用内消息推送设计

> 2026-09-25 状态说明：本文保留已实现的 Electron 手动更新与公告设计；Chromium 重构兼容要求已废弃。新的发布目标以 [当前 PRD §6](../../context/PRD.md#6-本轮正式发布公告和更新需求) 和 [实现计划](../plans/2026-09-25-desktop-release-notifications-updates.md) 为准，协议在 P2 更新、能力在后续阶段实现；本文不能继续限制已确认的新目标，也不能证明生产已可用。
> 2026-09-18 视觉规范更新：所有颜色、排版、布局、动效和组件样式以 [统一 UIUX](../../context/UIUX.md) 为准，旧视觉示例仅为历史。

> - 状态：已确认；2026-07-18 改为未签名安装包的用户触发下载/打开流程
> - 日期：2026-07-18
> - 当前运行时上游：[`ARCHITECTURE`](../../context/ARCHITECTURE.md)、
>   [`TECH-INFRA`](../../context/TECH-INFRA.md)、[`UIUX`](../../context/UIUX.md)
> - 历史兼容参考（已废弃，不再同步）：[`AI 浏览器 PRD`](../../refactor/ai-browser/01-product/PRD.md)、
>   [`历史目标架构`](../../refactor/ai-browser/02-design/ARCHITECTURE.md)
> - 实施计划：[`2026-07-17-desktop-update-announcements.md`](../plans/2026-07-17-desktop-update-announcements.md)

## 1. 目标与范围

当前 Electron + Chrome for Testing 桌面端增加两条可独立工作的交付链路：

1. 管理员在问学后台编辑固定样式的应用内消息，按账号、平台和版本定向立即推送；登录用户近实时
   收到消息，确认结果按账号同步。
2. CI 构建、测试并注册 Ed25519 清单保护的不可变版本候选；管理员在后台“版本更新”入口选择候选并
   配置灰度与可选/强制策略；桌面端自动发现并提示，用户点击后才下载安装包，校验 SHA-512 后由
   系统打开安装包，安装过程完全交给用户和操作系统。

协议与固定展示组件由一方包 `@wenxue/client-operations` 提供。历史方案曾计划供 Chromium 客户端
复用 wire schema、清单、匹配规则和 fixtures；该重构与其独立签名门禁于 2026-09-25 废弃，
不再要求为它增加兼容层。当前 Electron 的发布与平台能力按当前 PRD 和新计划推进。

### 1.1 非目标

- 不做消息中心、草稿、定时发布、富文本、自定义图标/颜色/按钮或用户标签分组。
- 不允许后台上传、替换或修改安装包、哈希、签名和产物 URL。
- 不静默下载，不关闭应用或 CfT，不由问学替换程序文件，不执行版本降级。
- 不把消息正文、目标 UID 清单或管理员操作权限暴露给桌面数据库监听器。
- 当前 Electron 安装包固定为 `manual-unsigned`；不把 COS/CI/Ed25519 私钥写入仓库、CloudBase
  前端配置或后台页面。

## 2. 关键决策

### 2.1 更新推送从哪里发起

“版本更新”是唯一人工发布入口，但不是二进制构建入口。完整链路固定为：

```text
desktop-release-candidate.yml（受保护分支，无发布凭据）
  → 构建/测试未签名 DMG/NSIS，生成 artifactSetSha512 + buildRunUrl seal
  → 原字节产物与 seal 在 Actions artifacts 保留 30 天
desktop-release-publish.yml（desktop-release-production）
  → 指定同 commit 的成功首轮 build run（run_attempt=1）并重下载原字节/seal
  → 验证 seal、artifactSetSha512、buildRunUrl 与三平台产物矩阵
  → 验证 quality / manual-installer-integrity / manifest-tamper-rejection 三项 tests 均指向该 buildRunUrl
  → 用 Ed25519 签署候选清单，不可覆盖地上传专用 COS
  → 公开源字节复核后注册到 AdminApi，不自动发布 rollout
  → 管理员在“版本更新”选择候选、通道、比例和模式并立即发布
  → release signal revision 变化
  → 客户端重新取策略、校验候选并向用户提示
  → 用户点击下载，SHA-512 校验通过后再点击“打开安装包”
  → 系统打开 DMG/NSIS，用户按操作系统提示手动完成安装
```

后台直接发布，不设置二人审批或输入确认文案；服务端仍必须做角色、候选状态、强制更新比例和版本
单调性校验，并写不可变审计记录。

只有 `desktop-release-production` 需要受保护 GitHub Environment，用于隔离 Ed25519 私钥、COS 写凭据
和候选注册 token。候选构建只在受保护分支运行且不接触发布凭据；工作流文件不能代替平台侧的分支、
审批与 secret 保护。

### 2.2 消息实时性

客户端只用 CloudBase `watch()` 监听 revision 文档；变化后通过带用户 bearer 的 HTTPS 接口拉取待展示
消息。这样数据库规则不需要把消息正文和目标 UID 暴露给所有登录用户。启动/登录时主动拉取，监听
失败时指数退避重连，并以 15 分钟轮询兜底。

### 2.3 更新信任边界

- 专用 COS 桶公开读取对象但禁止列目录，只有 CI 身份可写；现有私有 CloudBase 存储桶不改权限。
- 发布桶必须是从未启用过版本控制的新桶；“已暂停版本控制”不可接受。版本路径和候选标记写入后不可变，
  同一版本不得以新对象版本覆盖。候选清单由 CI 的 Ed25519 私钥签名，公钥固定进客户端。
- AdminApi 只发布已通过 Ed25519 清单验签、产物哈希、未签名手动分发模式、平台矩阵和测试状态校验的候选。
- 动态灰度策略通过 Gateway HTTPS 获取；打开安装包前必须完成一次实时策略请求并验证成功，缓存的
  mandatory 策略只能用于 24 小时内的离线提示/工作区门禁，不能授权打开。暂停或撤回应阻止新的下载
  或安装包打开动作。
- `update-policy` 绑定安装生成的匿名 `installIdHash` 签发短期事件 token；`update-events` 校验该 token 只能
  降低无关请求随意写入，不能证明客户端真实下载/安装。因此版本健康率始终是 advisory 运营信号，不是可信遥测或
  自动发布依据，且 token 不替代 Gateway/WAF QPS 限流。
- 当前 Electron 候选明确标记为 `manual-unsigned`。Ed25519 只证明问学发布的清单和产物字节未被替换，
  不会消除 macOS Gatekeeper 或 Windows SmartScreen 对未签名安装包的警告；UI 与后台必须明确展示此限制。

## 3. 需求与 EARS 验收标准

### R1. 后台入口与角色

1. 当 active `admin` 登录后台时，系统应展示“消息推送”和“版本更新”一级入口并允许写操作。
2. 当 active `viewer` 登录后台时，系统应展示相同数据但禁用发布、撤回、暂停和恢复操作。
3. 当非管理员、无效 token 或被停用的管理员访问任一管理接口时，AdminApi 应在读取或写入业务数据前
   拒绝请求。
4. 当管理员完成任一状态变更时，系统应记录 adminUid、动作、目标、变更前后摘要和服务端时间。

### R2. 消息创建与定向

1. 当管理员发布消息时，系统应要求标题 1–80 字、纯文本正文 1–1000 字，并只接受最多 2048 字符的
   HTTPS 详情 URL。
2. 当管理员未指定有效期时，系统应使用 7 天；当有效期超过 30 天或早于当前时间时，系统应拒绝。
3. 当管理员配置平台、包含式版本上下界和 UID 列表时，系统应在不同维度间执行 AND、同一维度内执行
   OR；空维度代表不限制。
4. 当 UID 列表超过 500、存在空值/重复值或版本范围无效时，系统应拒绝发布并返回字段级错误。
5. 当管理员点击“立即推送”且校验通过时，系统应原子写入 published 消息、审计记录并增加消息
   revision；不进入草稿或二次确认。

### R3. 消息接收与确认

1. 当用户登录或应用启动且 session 可用时，`DesktopAnnouncementService` 应拉取至多 10 条当前账号、
   平台和应用版本匹配且未确认、未过期、未撤回的消息。
2. 当消息 revision 变化时，客户端应重新拉取服务器权威队列，不把监听事件本身当作消息正文。
3. 当 watch 失败时，客户端应指数退避重连；在 watch 未恢复期间，应至少每 15 分钟轮询一次。
4. 当用户退出账号时，客户端应停止监听、取消轮询并清空该账号尚未展示的消息。
5. 当用户确认消息时，服务端应以 `announcementId + uid` 幂等写入回执；同一账号在其他设备上不得
   再收到该消息。
6. 当一条消息被撤回且正在展示时，revision 触发的权威拉取应关闭该消息并移出队列。

### R4. 固定消息交互

1. 当队列存在多条消息时，系统应一次只展示一条，重要消息优先，其余按发布时间从旧到新。
2. 当展示普通消息时，关闭按钮、Escape、遮罩和“我知道了”均应关闭弹窗并提交确认。
3. 当展示重要消息时，系统应隐藏关闭按钮、忽略 Escape/遮罩，只允许“我知道了”提交确认；用户仍可
   关闭整个应用。
4. 当用户未确认重要消息就退出应用时，系统下次登录应再次返回该消息。
5. 当消息带详情 URL 时，系统应显示目标域名和固定文案“查看详情”，只通过校验后的 HTTPS URL 在
   系统浏览器打开。

### R5. CI 候选注册

1. 当 CI 注册候选时，AdminApi 应校验 CI 专用 bearer、Ed25519 签名、schema、semver、运行时、通道、
   平台/架构矩阵、产物 URL、SHA-512/size、`manual-unsigned` 分发模式和测试证据；tests 必须精确为
   `quality`、`manual-installer-integrity`、`manifest-tamper-rejection` 三项 passed 记录，且 URL 全部等于
   同一成功 `buildRunUrl`。
2. 当候选 ID 或 `runtime + channel + version` 已存在且内容相同时，系统应幂等返回原候选；内容不同时
   应拒绝覆盖。
3. 当清单、签名或产物元数据无效时，系统应把候选拒绝在可发布列表之外，并不得增加 release
   revision。
4. 当后台读取候选时，系统应只返回已验证候选及不含密钥的签名/测试摘要。

### R6. 更新策略发布

1. 当管理员发布版本时，系统应要求选择 verified 候选、`dev|beta|stable` 通道、1/5/25/50/100 的
   放量比例和 `optional|mandatory` 模式。
2. 当模式为 mandatory 时，系统应强制使用 100% 放量；其他比例应被拒绝。
3. 当发布成功时，系统应使相同 `runtime + channel` 的旧 active rollout 失效，写审计并增加对应通道
   release revision。
4. 当管理员暂停或撤回时，系统应立即更新权威策略并增加 revision；客户端不得开始新的下载或打开安装包。
5. 当管理员恢复时，系统应保留原候选与稳定分桶语义，不为同一安装随机更换灰度资格。

### R7. 更新发现与分桶

1. 当已安装应用启动 30 秒、距离上次定时检查达到 4 小时或用户手动检查时，
   `DesktopUpdateService` 应请求当前平台、架构、通道和版本的策略；当 renderer 的
   `DesktopReleaseSignalService` 发现 release revision 变化时，它应只经 typed IPC 发送
   `updates:check(reason='signal')`，不得在 main 加载 CloudBase Web SDK。
2. 当应用是 unpackaged/dev 构建时，服务应报告 unavailable，不调用真实更新器。
3. 当 rollout 小于 100% 时，服务应以随机本地 installId 和 releaseId 的 SHA-256 稳定分桶；installId
   不得由硬件、账号或浏览器画像生成。
4. 当候选版本不高于当前版本、平台/架构不匹配、清单签名/哈希无效、策略已暂停/撤回或分桶未命中时，系统
   不得提示可下载更新。
5. 当手动检查时，系统仍应遵守通道、签名、版本单调性和灰度资格，不绕过发布控制。

### R8. 下载与手动安装交接

1. 当可选更新可用时，系统应展示“稍后 / 下载更新”；只有点击“下载更新”后才开始下载。
2. 当下载进行时，系统应展示百分比、已下载/总大小和速度，并保持工作区可用。
3. 当下载完成并完成 SHA-512/size 校验时，系统应展示“稍后 / 打开安装包”；退出应用不触发任何更新动作。
4. 当用户点击“打开安装包”时，服务应实时重新获取并校验策略；网络失败、已暂停、撤回、过期或
   指向不同候选时，应拒绝打开并清除 ready 状态。最近缓存的 mandatory 策略不得代替这次实时复核。
5. 当策略复核成功时，main 应通过系统 API 打开已校验的 DMG/NSIS，不关闭问学或托管 CfT；后续
   关闭应用、替换程序和重启均由用户按系统安装器提示完成。
6. 当已经安装故障版本时，系统不得自动降级；修复应以更高版本候选前向发布。

### R9. 强制更新与离线安全

1. 当 fresh mandatory 策略命中当前版本时，系统应阻止进入工作区并只提供更新、重试和退出应用；
   不得阻止用户关闭应用。
2. 当策略获取失败但最近一次已验证策略不超过 24 小时时，系统可继续执行该 mandatory 策略并重试。
3. 当策略超过 24 小时且服务器不可达时，系统应降级为持续警告与重试，不得无限期锁死工作区。
4. 当下载、哈希校验或打开安装包失败时，系统应保留可启动的当前版本，提供可理解错误与重试，
   不删除用户画像。

### R10. 安全、隐私与留存

1. 当客户端读取消息 signal 时，数据库规则应只允许已登录用户读取 revision，不允许客户端写入。
2. 当客户端读取 release signal 时，规则可公开只读 revision，但不得包含私有候选元数据或凭据。
3. 当记录更新事件时，系统不得写 uid、提示词、页面正文、Cookie、session 或硬件指纹；只允许
   releaseId、匿名 installId hash、平台、版本、阶段、结果、服务端时间和 `expiresAt`。客户端必须携带策略签发的
   短期事件 token，但该 token 不得被表述为安装真实性证明。
4. 当更新事件的 `expiresAt` 到期时，CloudBase TTL 索引应删除事件；服务端把它设为创建后 30 天，
   审计与消息回执按运营策略保留。
5. 当任何日志记录 API 错误时，日志应移除 Authorization、access/refresh token、CI token、签名私钥
   和消息目标 UID 列表。

### R11. 双运行时兼容

1. 当未来 Chromium 客户端接入时，服务端 API、集合语义、候选签名和稳定分桶算法应保持兼容；只
   替换客户端更新适配器为 Chromium Updater。
2. 当发布策略指定 runtime 时，Electron 与 Chromium 客户端应只消费各自候选，不得交叉安装。
3. 当旧 Electron 运行时退役时，历史审计、消息回执和 release 记录应继续可读，不要求迁移用户网站
   Profile 数据。

## 4. 数据模型与权限

| 集合                           | 核心字段                                                                                                                                                                                                                                                                      | 权限、索引与生命周期                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client_announcements`         | `_id`, schemaVersion, status, importance, title, body, detailUrl?, audience, publishedAt, expiresAt, publishedBy, withdrawnAt?                                                                                                                                                | `ADMINONLY`；索引 `status+expiresAt+publishedAt`；正文与 UID 不进入 signal                                                                                         |
| `client_announcement_receipts` | `_id=announcementId:uid`, announcementId, uid, acknowledgedAt, expiresAt                                                                                                                                                                                                      | `ADMINONLY`；唯一 `_id` 保证幂等；`expiresAt` 为公告到期后 24 小时的 BSON Date，`expireAfterSeconds=0` TTL 主清理，5 分钟节流/20 条限量删除兜底；客户端只经 API 写 |
| `desktop_release_candidates`   | `_id`, runtime, version, channel, manifestUrl, manifestSignature, artifacts, sourceCoordinates（含 `releasePublicKeyFingerprint`）, `distribution.mode=manual-unsigned`, tests, status, registeredAt                                                                          | `ADMINONLY`；唯一 `runtime+channel+version`；内容不可覆盖                                                                                                          |
| `desktop_release_rollouts`     | rollout：`_id`, runtime, channel, releaseId, status, percentage, mode, minSupportedVersion?, title, notes, publishedAt, publishedBy；slot：`_id=release-slot:<runtime>:<channel>`, `recordType=release-slot`, currentRolloutId?, activeRolloutId?, highestVersion?, updatedAt | `ADMINONLY`；slot 是同集合内的交易保留文档，不进入 rollout API/后台历史；原子维护单活动发布与通道最高版本；索引 `runtime_channel_published` 服务于发布历史         |
| `desktop_release_events`       | `_id`, releaseId, installIdHash, platform, arch, fromVersion, stage, result, createdAt, expiresAt                                                                                                                                                                             | `ADMINONLY`；无 uid；`expiresAt` 是 BSON Date，TTL 在创建后 30 天清理；`release_created_cursor` 固定健康扫描的 release/createdAt/\_id 游标顺序                     |
| `desktop_announcement_signal`  | `_id=global` 或 `user:<sha256(uid)>`, revision, updatedAt, uid?                                                                                                                                                                                                               | `CUSTOM`：登录用户只可读 global 或 `doc.uid == auth.uid`；global 仅发布/撤回递增，账号文档仅该账号确认递增；客户端不可写                                           |
| `desktop_release_signal`       | `_id=runtime:channel`, revision, updatedAt                                                                                                                                                                                                                                    | `CUSTOM`：公开只读，客户端不可写；不含候选正文                                                                                                                     |
| `admin_dispatch_audit`         | `_id`, adminUid, action, targetType, targetId, before?, after?, createdAt                                                                                                                                                                                                     | `ADMINONLY`；纯审计、只追加，不承担 release slot/互斥/版本门禁，不由后台修改                                                                                       |

`audience` 固定为：

```ts
interface AnnouncementAudience {
	platforms?: Array<'darwin' | 'win32'>
	minVersion?: string
	maxVersion?: string
	userIds?: string[]
}
```

## 5. HTTP 与 IPC 契约

### 5.1 后台与 CI

| Method   | Path                                           | 关键请求/响应                                                           |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------------- | -------- | ------------- |
| GET/POST | `/api/admin/v1/announcements`                  | 列表；或 `AnnouncementInput → { announcement }`                         |
| POST     | `/api/admin/v1/announcement-withdraw`          | `{ id } → { announcement }`                                             |
| GET      | `/api/admin/v1/release-candidates`             | `runtime/channel` 过滤后的 verified 候选                                |
| GET      | `/api/admin/v1/releases`                       | rollout 历史与当前状态                                                  |
| POST     | `/api/admin/v1/release-publish`                | `{ candidateId, title, notes, percentage, mode, minSupportedVersion? }` |
| POST     | `/api/admin/v1/release-state`                  | `{ releaseId, action: 'pause'                                           | 'resume' | 'withdraw' }` |
| POST     | `/api/internal/v1/release-candidates/register` | CI bearer + 完整签名候选；幂等注册                                      |

### 5.2 桌面客户端

| Method | Path                                                                                 | 关键请求/响应                                                                        |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| GET    | `/v1/client/announcements/pending?platform=&version=`                                | 用户 bearer；返回至多 10 条安全消息视图                                              |
| POST   | `/v1/client/announcement-ack`                                                        | 用户 bearer；`{ announcementId }` 幂等确认                                           |
| GET    | `/v1/client/update-policy?runtime=&platform=&arch=&channel=&version=&installIdHash=` | 无登录；返回适用策略/no-update 及绑定本次安装匿名坐标的短期 event token              |
| POST   | `/v1/client/update-events`                                                           | 无登录、必须携带 event token；只接受匿名允许字段；服务端写入 `expiresAt` 供 TTL 清理 |

更新状态经 typed IPC 暴露：

```ts
type UpdateState =
	| { phase: 'idle' | 'checking' }
	| { phase: 'available'; release: UpdateReleaseView }
	| { phase: 'downloading'; release: UpdateReleaseView; progress: DownloadProgress }
	| { phase: 'ready'; release: UpdateReleaseView }
	| { phase: 'opening'; release: UpdateReleaseView }
	| { phase: 'handedOff'; release: UpdateReleaseView }
	| { phase: 'error'; message: string; retryable: boolean }

// updates:getState / updates:check / updates:download / updates:openInstaller
// updates:state-changed (main → renderer)
// app:openExternal，仅接受 https URL
```

## 6. UI 规范与中断交互

视觉由 [统一 UIUX §11](../../context/UIUX.md#11-应用内消息与更新) 唯一规定；本方案不再维护独立的工业风、状态轨、字号、圆角或动效要求。桌面实显与后台预览复用同一规范。

应用内消息和更新是高优先级但低频的系统中断。界面必须让用户立即识别来源、重要性和唯一下一步，同时保护浏览器工作与退出权；后台只控制文字和目标，不控制视觉与 CTA，不播放声音。

- 内容保留标题、正文、可选域名与“查看详情”、操作区；图标和语义状态辅助理解。
- update 变体保留版本、说明、大小、进度和速度，并固定显示“未签名安装包”说明；按平台提示 Gatekeeper/SmartScreen 可能要求用户手动确认，后台不能隐藏或改写该提示。
- 普通 / 重要消息和可选 / 强制更新维持既定关闭矩阵、系统优先级和动作权限；视觉统一不改变安装前策略复核。
- 使用 focus trap、`aria-modal`、焦点恢复；重要 / 强制变体使用 alert 语义；键盘和 reduced-motion 遵守统一规范。
- 后台“消息推送”保留编辑、同组件实时预览与历史；“版本更新”保留候选和发布控制。后台业务布局与既有 inspector 不因本次视觉统一扩展。

## 7. 测试设计

### 7.1 单元与组件

- semver 包含式范围、三维 audience 匹配、输入上限、HTTPS URL、默认/最大有效期。
- 稳定 rollout 分桶、通道/runtime/platform/arch 匹配、策略 24 小时 freshness。
- Ed25519 清单验证、字段篡改、哈希不匹配、重复版本覆盖拒绝。
- 事件 token 与 release/install/runtime/platform/arch/fromVersion/过期时间绑定、篡改拒绝、
  `expiresAt` BSON Date 与 TTL；健康统计只作 advisory 展示。
- release slot 文档在发布/暂停/恢复/撤回事务中原子维护 active/current/highestVersion，且不出现在后台 rollout 列表；
  `admin_dispatch_audit` 只验证追加审计，不被当作 release slot。
- release candidate seal 与重下载原字节的 `artifactSetSha512`/`buildRunUrl` 一致；首轮成功 source run 约束；
  tests 精确等于 `quality`、`manual-installer-integrity`、`manifest-tamper-rejection` 三项 passed 记录，且 URL
  均等于该 `buildRunUrl`；COS `Closed` 版本状态与 `--forbid-overwrite` 失败关闭。Ed25519 只签 candidate
  manifest，不另设 evidence 公钥、URL 或签名输入。
- 消息排序、普通/重要关闭矩阵、回执幂等、撤回后当前弹窗关闭。
- UpdateState 状态机、IPC 入参、打开安装包前实时策略复核、下载后的 SHA-512/size 复核、离线缓存不能
  授权打开安装包和 dev/unpackaged unavailable。
- admin/viewer/未授权角色矩阵、固定预览与实际组件一致性。

### 7.2 集成

- 发布消息 → signal → 目标账号展示 → ack → 另一设备不再展示。
- all/platform/version/UID 组合及非目标用户排除；断网、watch 重连、15 分钟兜底和退出登录清队列。
- CI 注册候选 → 后台发布 → 合格/不合格安装分桶 → 下载进度 → ready → opening → handedOff。
- 下载前、下载后和打开安装包前分别 pause/withdraw，断言不启动新下载或新交接。
- 多条消息、消息与更新同时到达时，强制更新最高，其次重要消息、普通消息、可选更新。

### 7.3 未签名安装包手动交接 E2E

- macOS arm64、macOS x64、Windows x64 从 `0.1.0` 下载并打开 `0.1.1` 安装包，由测试人员按系统提示
  手动完成覆盖安装。
- 篡改清单/包拒绝、size/SHA-512 不匹配拒绝，断点/重试后仍验证目标候选。
- 打开安装包时不关闭问学或运行中的 CfT；人工完成安装后画像、Cookie 和插件数据无损。
- 故障版本执行更高版本前向热修复，不用降级覆盖验证成功。

## 8. 实施快照、前置条件与运维约束

- 2026-07-17 已在 `wenxue-d8gz76tacc3659f05` 创建本设计的 8 个 collection、必要索引与读写规则；
  已初始化 `desktop_announcement_signal/global` 和
  `desktop_release_signal/electron:{dev,beta,stable}` 共 4 个 revision seed。
- `desktop_release_events.expiresAt` 已以 `expireAfterSeconds=0` 的 TTL 索引生效；服务将每条匿名事件的
  `expiresAt` 写为创建后 30 天的 BSON Date。
- CloudBase 环境状态查询为 `NORMAL`，当前个人版有效期至 2027-02-01；但账单侧仍显示 `EnvActivated=no` 且
  `EnableOverrun=false`；这两组信号必须分别记录，不得以 `NORMAL` 推导资源超额或生产发布已就绪。
- 2026-07-18 已发布 Gateway 030、独立 AdminApi 012 与 AdminWeb 007，三者均为 `NORMAL` 且当前版本
  承接 100% 流量；统一公开域名现有 18 条 routes，包含本功能新增的 11 条精确路由。candidate manifest
  验签公钥、release CI token 与 event HMAC secret 已配置到 CloudRun，配置值不进入仓库或本文。
- 独立 COS 桶 `wenxue-desktop-releases-1427406869` 已创建：private ACL、匿名只允许 `GetObject`、禁止
  匿名 list/write，且从未启用版本控制。Gateway/WAF QPS 与 CloudRun 直达入口的等价限制仍需在真实
  发布前确认，event token 不能替代该边界。
- GitHub 受保护 Environment、仓库 variables/secrets、CI 专用最小权限 CAM 身份和 Ed25519 私钥仍未
  就绪；不得用 Gateway 高权限身份替代 CI 身份，私钥只允许进入 GitHub secret store。
- 构建/发布流水线已拆成 `desktop-release-candidate.yml` 与 `desktop-release-publish.yml`；候选段在受保护
  分支生成未签名 DMG/NSIS 且无发布凭据；publish 只接受上述三项同 run tests。仅受保护 Environment
  `desktop-release-production`、所需仓库/组织规则以及 candidate manifest Ed25519/COS/register 配置
  尚未就绪，所以仍是显式生产阻塞。
- 应用、AdminApi/Gateway、AdminConsole、数据资源、路由和 CI 代码已落地；控制面可以表述为已上线，
  但尚未产出真实发布候选，也未完成 macOS arm64、macOS x64、Windows x64 的未签名安装包
  `0.1.0 → 0.1.1` 手动真机 E2E，因此不得声称发布 CI 或桌面更新闭环已验收。
- beta 按 5% → 25% → 50% → 100%，每阶段观察至少 24 小时。完整性错误、阻断回归或安装包交接失败率
  超过 2% 时立即暂停；该失败率来自可被客户端伪造的匿名事件，只能作为需人工交叉验证的 advisory
  信号，不触发无人监督的自动发布决策。已安装故障版本以前向 hotfix 修复。
