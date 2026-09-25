# Chromium 基础设施与交付规范

> **已废弃（2026-09-25）：** 按用户决定，Chromium AI 浏览器重构方案停止执行。本文件是废弃前历史快照，不代表当前产品现状，也不得作为后续任务或实施依据。当前产品以[当前 PRD](../../../context/PRD.md)为准，发布工作见[桌面发布与通知计划](../../../superpowers/plans/2026-09-25-desktop-release-notifications-updates.md)。

> - 状态：G1 前待评审
> - 最后更新：2026-07-18
> - 适用平台：macOS arm64、Windows x64

## 1. 目标

建立可重复、可追溯、可签名、可更新的问学 Chromium 构建与发布链路。基础设施是否完成，以 CI 可从锁定源码坐标生成相同产品产物并附带证据为准，不以单台开发机“能够编译”为准。

## 2. 仓库模型

| 仓库            | 职责                                                           | 不应承载                            |
| --------------- | -------------------------------------------------------------- | ----------------------------------- |
| WenXue          | 当前运行时、产品服务、共享协议、迁移工具、文档与兼容层         | Chromium 完整源码历史和大型构建输出 |
| wenxue-chromium | Chromium 分支、问学浏览器模块、品牌资源、GN 配置与上游合并记录 | 业务后端密钥、用户数据、临时产物    |
| 制品仓库        | 签名安装包、增量包、符号、SBOM、provenance 和发布清单          | 可编辑源码真相                      |

wenxue-chromium 的远端地址、可见性、访问控制、CODEOWNERS 和维护责任人尚未锁定，是 G1 阻塞项。

## 3. 源码坐标

### 3.1 现有基线

迁移前语义与性能参考基线：

- Chrome for Testing：149.0.7827.55
- Chromium revision：1625079
- 问学扩展：必须在基线采集时记录精确 commit 和构建哈希
- 当前运行时：Electron 启动器 + 独立 Chrome for Testing Profile

现有版本只用于复现当前行为，不自动成为目标 Chromium revision。

### 3.2 目标基线

G1 前必须记录：

- Chromium milestone、完整 git commit 和 branch-head；
- depot_tools commit；
- 问学补丁基线 commit；
- Node/pnpm、Python、编译器、Windows SDK、Xcode 和 macOS SDK 精确版本；
- 所有第三方依赖锁文件与许可证快照；
- 上游安全修复合并策略。

目标 revision 当前未锁定。在完成站点兼容、扩展兼容、构建成本和安全窗口评估前，不得把任意本地 checkout 当成正式基线。

## 4. 分支与补丁策略

- 上游跟踪分支保持可辨识，问学功能以小而明确的提交序列叠加。
- 浏览器产品代码优先放在独立问学模块，修改 //chrome 入口时保留薄适配层。
- 不对生成文件、第三方源码或大范围格式做无关改写。
- 每次上游合并记录：起止 revision、冲突文件、行为变化、测试结果和回退点。
- 安全高危修复目标在上游可用后 7 天内进入受支持发布通道；更严格时以安全响应策略为准。
- 发布分支禁止直接携带未评审的本地补丁。

## 5. 构建环境

### 5.1 macOS arm64

最低要求：

- 完整 Xcode，而非仅 Command Line Tools；
- 与目标 Chromium revision 兼容的 macOS SDK；
- depot_tools，包括 fetch、gclient 和 gn；
- autoninja/siso 与目标 revision 要求一致；
- 足够的源码、对象、符号与缓存空间；
- 可访问签名、公证和崩溃符号服务的受控 runner。

### 5.2 Windows x64

最低要求：

- 受支持版本的 Visual Studio Build Tools 和 Windows SDK；
- 与目标 revision 对应的 depot_tools、Python 和编译工具；
- 代码签名能力、符号上传能力及独立 runner；
- 与 macOS 使用同一发布清单和测试门禁；
- 不允许只以开发者 Windows 机器的手工构建代替 CI。

### 5.3 GN 配置

开发、测试和发布使用独立 args 模板。发布构建优先使用 Chromium 官方推荐的优化组合，包括官方构建语义、ThinLTO 以及平台允许时的 PGO；具体参数必须由选定 revision 的官方构建文档确认。

不得为了短期编译速度关闭站点隔离、沙箱、OSCrypt、进程模型或其他安全关键能力。

## 6. 当前环境核查快照

2026-07-14 的前置核查发现：

| 项目           | 观察结果                                          | 判定                                                  |
| -------------- | ------------------------------------------------- | ----------------------------------------------------- |
| 工作分支       | codex/ai-browser-doc-system，文档工作树可独立管理 | 就绪                                                  |
| Node           | 本机为 v26.1.0，项目政策要求 Node 22 LTS          | 阻塞：切换并锁定                                      |
| Xcode          | xcodebuild 未通过，仅检测到 Command Line Tools    | 阻塞：安装/选择完整 Xcode                             |
| Chromium 工具  | fetch、gn、autoninja、siso、ninja 未发现          | 阻塞：安装匹配 revision 的 depot_tools                |
| Chromium 仓库  | 本机无 wenxue-chromium checkout                   | 阻塞：先建立远端与访问策略                            |
| Windows runner | 尚未确认                                          | 阻塞                                                  |
| 磁盘           | 观察到约 220 GiB 可用                             | 风险：不能据此判定足够，需源码/对象/缓存/符号容量方案 |
| 目标 revision  | 尚未确定                                          | 阻塞                                                  |
| 旧基线         | CfT 149.0.7827.55 / revision 1625079              | 可用于现状采样                                        |

该快照仅是就绪度证据，不是长期事实；环境变化后必须更新日期和验证命令结果。

## 7. 构建流水线

建议流水线：

1. 验证发布清单与源码坐标；
2. 同步 Chromium 与依赖，校验锁定 revision；
3. 应用或验证问学补丁序列；
4. 生成 GN 配置并保存 args；
5. 编译浏览器、扩展和辅助组件；
6. 执行单元、浏览器、扩展和隔离测试；
7. 生成 SBOM、许可证报告与 provenance；
8. 生成未签名候选产物；
9. 在隔离签名阶段完成 macOS 签名/公证和 Windows 签名；
10. 执行安装、升级、降级保护、启动和冒烟测试；
11. 发布到内部或灰度通道；
12. 保存符号、日志、测试报告和回滚坐标。

任何步骤不得从开发者未提交工作区隐式取文件。

## 8. 发布清单

每个候选版本至少包含：

| 字段                   | 内容                                |
| ---------------------- | ----------------------------------- |
| product_version        | 用户可见问学浏览器版本              |
| channel                | dev / canary / beta / stable        |
| chromium_version       | 完整 Chromium 版本                  |
| chromium_commit        | 40 位提交哈希                       |
| chromium_revision      | 可追溯 revision                     |
| wenxue_chromium_commit | 浏览器分支 commit                   |
| wenxue_commit          | 配套应用/服务 commit                |
| extension_version      | 内置问学扩展版本                    |
| extension_commit       | 扩展源码 commit                     |
| protocol_versions      | 浏览器、扩展、服务协议版本          |
| toolchain              | 各平台编译器、SDK、depot_tools 坐标 |
| build_args_digest      | GN args 内容哈希                    |
| artifact_digests       | 安装包、更新包、符号和 SBOM 哈希    |
| signing_identity       | 不含私钥的签名身份标识              |
| test_evidence          | 门禁报告和基线比较链接              |
| rollback_to            | 已验证的回滚版本                    |

## 9. 更新、签名与安全响应

- macOS 产物必须通过 Developer ID 签名、公证与 Gatekeeper 验证。
- Windows 产物必须使用受控代码签名证书，并通过 SmartScreen/安装验证流程。
- 更新清单必须签名，客户端验证来源、版本单调性、产物哈希和通道。
- 自动更新需支持分批灰度、暂停、撤回和回滚到已验证版本。
- 复用当前 Electron 建立的控制面：CI 把 runtime=`chromium` 的不可变候选上传专用 COS、以 Ed25519
  签署并注册；后台“版本更新”只发布 dynamic rollout，不持有上传能力或私钥。
- Chromium 流水线复用 Electron 已硬化的“原字节 build → protected publish”完整性模式。当前 Electron
  publish 只消费当前 commit 的成功首轮 source run，要求 `quality`、`manual-installer-integrity`、
  `manifest-tamper-rejection` 三项 passed tests 都绑定同一 `buildRunUrl`，再签署 Ed25519 candidate
  manifest、上传和注册；共享协议不定义外部 evidence 公钥、URL 或签名输入。Chromium 接入前必须以
  受评审的 schema 版本明确其 updater/平台安装 tests，不得静默改变 Electron v1 的固定三项约束。
  此外 Chromium G5 必须在 build 与 publish 之间增加隔离的平台签名阶段，
  并使用 Chromium 自己的受保护 signing 身份；不得把当前
  Electron 的 `manual-unsigned` 安装包下载器当作正式分发适配器。
- `WenXueUpdatePolicy` 消费共同的 runtime/channel/platform/arch/version/policy schema，但以 Chromium
  Updater/平台 installer 执行。mandatory 只允许 100%，安装前必须实时复核策略成功，
  缓存策略不能授权安装；stale 超过 24 小时且离线时不锁死工作区。
- COS 必须使用从未启用过版本控制的新桶，COSCLI 必须证明 versioning 为 `Closed`（已暂停不可接受）；
  对象公开读、禁止列目录、CI-only write，每次写入使用 `--forbid-overwrite`；版本路径与候选标记写入后不可变；
  Apple/Windows 平台签名、manifest
  签名和 artifact digest 均是 G5 门禁。
- 匿名 update event token 只防未取得 policy 的随意写入，不证明下载/安装真实性；事件通过
  `expiresAt` TTL 保留 30 天，健康统计只作 advisory 运营信号，不得单独触发自动扩大 rollout。
- Chromium 安全公告、CVE 和高风险上游提交需有明确值班与升级 SLA。
- 崩溃转储、日志和遥测遵循最小采集原则，不收集任务页面正文、Cookie 或用户凭证。
- 符号和诊断数据按版本、平台和构建哈希管理。

### 9.1 可复用 Electron 控制面快照（2026-07-17）

这是 Chromium G5 将复用的现有控制面现状，不代表 Chromium 客户端已实施：

- CloudBase 环境查询为 `NORMAL`，当前个人版有效期至 2027-02-01；账单侧仍为
  `EnvActivated=no`、`EnableOverrun=false`。
- 8 个分发 collection、索引/规则、4 个 Electron signal seed 与 `desktop_release_events.expiresAt`
  `expireAfterSeconds=0` TTL 已创建；新增 `release_created_cursor` 与 `runtime_channel_published` 索引。
- `desktop_release_rollouts` 内部 `recordType=release-slot` 文档保留 active/current/highestVersion 通道状态，
  `admin_dispatch_audit` 只追加审计。
- 统一 HTTPSERVICE 网关只有 `/admin`、assets 和 4 个旧 admin API 路由；本功能新增 11 条路由不存在，
  当前所有路由 `QPSPolicy` 为空。三个 CloudRun 默认域名仍为 `PUBLIC`，可绕过 Gateway；新控制面实现未部署。
- Gateway/AdminApi 尚未配置 release CI token、candidate manifest 验签公钥和 event HMAC secret；
  这些安全配置齐备前不得部署新 target。
- GitHub 受保护 Environment `desktop-release-production` 和其 candidate manifest Ed25519/COS/register 配置
  尚未就绪；当前 Electron 两阶段流水线因此仍被生产条件阻塞。
- 独立 COS 桶、CI/Ed25519 凭据和 Electron 三平台 `manual-unsigned` 下载/打开安装包 E2E 均未就绪。
  这些前置项完成后只证明共享控制面与完整性链路可用；Chromium 仍须在 G5 单独完成双平台正式签名、
  updater 和真实升级门禁。

## 10. 性能基线方法

性能比较必须是对称配置：

- 场景 A：一个问学任务、10 个标签页，对比一个 Chrome for Testing Profile、同样 10 个标签页；
- 场景 B：两个问学任务、每个 5 个标签页，对比两个 Chrome for Testing Profile、每个 5 个标签页；
- 使用相同 Chromium 基线、页面集合、缓存冷暖状态、扩展能力、网络条件和采样时长；
- 同时记录启动时间、页面加载、交互延迟、CPU、内存、GPU、磁盘 I/O、崩溃与长任务；
- 报告中区分 Chromium 本体成本、问学 UI 成本、扩展/Agent 成本和任务隔离成本；
- 目标阈值以 PRD 为准，未采集旧基线前不得自定义放宽。

## 11. G1 出口

G1 只有在以下项目全部完成后通过：

- 新仓库远端、权限、责任人与分支策略已批准；
- 目标 Chromium revision 与安全更新节奏已锁定；
- macOS arm64、Windows x64 原生 runner 可重复构建；
- 完整工具链版本被锁定并可自动校验；
- 开发、测试、发布 GN 配置评审完成；
- 产物包含发布清单、SBOM、符号和 provenance；
- 签名/公证或其受控测试替身链路可运行；
- 旧基线性能数据已采集；
- 所有证据在 [开工就绪度](../03-delivery/READINESS.md) 中可追溯。
