# 正式发布双目标矩阵与外部条件核验

日期：2026-09-26。执行分支：`codex/release-notifications-updates`。

## 本段结果

用户确认当前仅交付 Windows x64 与 macOS arm64；Intel Mac 暂不适配。按此范围完成了本地发布矩阵调整，尚未在 GitHub 构建、部署服务端或发布公告/版本。P1、P2、P4 整体继续待验收。

- 两份发布 workflow 仅构建/下载 macOS arm64 DMG 与 Windows x64 NSIS。
- 现有 `release-artifact-set.mjs` 统一校验两份安装包的目标与类型，供构建 seal、证据、候选生成、上传与公开验证复用；缺失、重复、额外目标、错误类型均拒绝。
- 保留两份最终 App 公钥指纹证明、seal schema v2、manifest schema v1、三项测试证据及全部原有发布门禁。
- AdminApi 登记和读取接受当前双目标，也兼容旧完整三目标清单；不改原签名、产物顺序或不可变性。上线时先部署 AdminApi/组合网关，再登记双目标候选，否则现网旧校验会拒绝新清单。
- PRD、ARCHITECTURE、TECH-INFRA、ROADMAP、执行计划与项目入口同步；未将下载/安装目标标为已实现。

## 验证

- Node 22.22.3：AdminApi 全部 **119 项测试通过**，包含真实 Ed25519 双目标登记、幂等、列表读取、发布后两平台策略与非法矩阵拒绝；旧三目标用例保留通过。
- 发布脚本完整 Node suite **17 项测试通过**，覆盖缺包、额外 Intel 包、重复/错误类型、两份公钥证明、清单签名与公开字节校验。
- AdminApi typecheck、全量 `pnpm lint:desktop-release`、改动代码 Prettier、两份 workflow YAML 解析和 `git diff --check` 通过。
- 主 Agent 审阅最终变更及 CloudBase SEC001 边界：本次只调整既有候选校验，无新增认证、数据库权限或运行时凭据回显。
- 未执行 Windows/macOS 真实安装或升级，因此这些测试不构成端到端验收。

## 外部条件新证据

- GitHub CLI 已认证，当前身份对 `SmartSunruiyang/WenXue` 具有 ADMIN 权限，仓库为 private，Actions 已启用。
- REST 元数据默认分支名为 `main`，但 GraphQL `defaultBranchRef=null`；contents API 明确返回 `This repository is empty`。远端无实际 main 提交、目标工作流或运行记录。
- Environment 列表为零项；仓库 variables/secrets 名称列表为空。未读取 secret 值。
- 分支保护与 Rulesets API 返回 HTTP 403，提示私有仓库套餐限制；不能据此声称保护规则已配置或工作流的 `ref_protected` 已通过。
- 用户已提供 Windows 和 Apple Silicon 测试机、两个测试邮箱。按邮箱查询后做精确匹配，每个账号均唯一且 `ACTIVE`；未执行登录或发送公告。本日志不记录邮箱、UID 或任何凭据。

GitHub 官方说明：私有仓库的[分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)和[发布 Environment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)需要相应付费套餐；Pro 可启用上述两项，但私有仓库的 required reviewers 仍有额外套餐限制。用户的“保持私有并升级 Pro / 保持私有不升级并调整发布流程”选择待回复，不代为购买或改变仓库可见性。

## 提交与下一步

矩阵实现提交：`56aaf58 ci(desktop): target Apple Silicon and Windows releases`，父提交为 `4aaaaf0`；代码、上游文档与日志一起验收并提交。

随后同步本地 main 固定提交 `2a55287`，保留其他任务已提交的官网页脚、产品版本与更新错误提示修复，以及原插件格式改动。唯一合并冲突位于 ARCHITECTURE 的 E2E 说明，保留当前双目标和“当前版本到更高 SemVer”两项要求。当前源码产品版本为 `0.0.1-beta`；此前安装包 `0.1.0` 的实测证据仍是历史事实，发布时不可把较低 SemVer 当成可自动升级的新版本。

合并复验暴露官网 `test` 脚本调用 `tsx` 却未声明依赖的 CI 阻断。为 `apps/website` 显式添加工作区已有的 `tsx ^4.22.4`，锁文件仅增加该 importer 的三行记录，未升级其他包。此同步与依赖修复为本日志更新所属合并提交，其父提交为 `56aaf58` 和 `2a55287`。

合并后的 Node 22.22.3 验证：

- `pnpm install --frozen-lockfile --offline` 通过。
- `pnpm -r test` 全部通过，共 **1,602 项**：AdminApi 119、Gateway 124、website 6、client-operations 14、llms 90、page-controller 17、core 38、admin 2、desktop 403 + scripts 18、extension 771。
- AdminApi、Gateway、desktop 三项 typecheck 以及全量发布 lint 通过；合并文件无未解决冲突，diff 检查通过。

下一步按用户选择确定可执行的 GitHub 发布门禁，再配置远端代码与 CI；P2 仍需落实新更新协议、Windows 安装器关联元数据、服务端统一资格判断、安装前复核与启动结果。P3 使用两个指定测试账号验证公告，不向全体真实用户广播测试内容。CAM 专用 CI 身份和 COS 版本状态仍待核验。
