# 2026-09-28 — beta.3 → beta.4 N+1 升级演练准备

## 范围与起点

- 起始发布工作树提交：`3b04bce`。
- 用户确认 beta.3 在 Mac 上“正常打开了”。该反馈仅证明首次打开成功，不代表 CfT 启动、资料/Profile 保留或自动升级通过。
- 本轮准备候选 `0.1.1-beta.4`，演练方向为 beta.3 → beta.4。Sol 仅同步三包版本和必要测试，不改业务行为；root 候选测试 2/2、Sol extension 11/11、website 6/6、frozen-lock、format 和 lint 均通过。
- 用户说明 Windows 当前版本为 `0.1.1-beta.1` 或 `0.1.1-beta.2`，尚未精确到单一版本；可按该现状开始验收，无需先手动安装 beta.3。

## 当前状态

- CI run `36424859967`（source `eb5fbc3a6e8e5fe37c300515cbd1de3660e03d61`）四 jobs 全成功；root 实际对最终 DMG 执行严格签名门禁 exit 0。`prepare` / `prepare-upload` 通过；CloudBase 五对象上传的部分恢复为 1 reuse + 4 upload，随后全量 5 reuse，SHA-512 与签名均稳定；`register-upload` 完整公网回读后通过，候选 `electron:beta:0.1.1-beta.4` 为 verified，后台已显示。
- 根已在后台准备 optional、beta 通道、100% 草案；100% 范围是所有符合资格的 beta 用户，并非仅测试账号。具体发布范围批准已向用户明确询问，尚未收到答复；当前无 rollout。
- 2026-09-28 21:16:36 CST，prepare/签名/register/恢复均结束后，按用户持续授权，根在删除前重新计算五个本地对象的 SHA-512 与尺寸并确认匹配，随后清理 run 的三个 GitHub artifacts `10971427739`（macOS 277290453 bytes）、`10970914317`（seal 937 bytes）、`10970653526`（Windows 221054238 bytes），共 498345628 bytes；API 剩余数为 0。本地备份与 CloudBase 对象保留。证据：`/Users/outas/Downloads/WenXue-CI-36424859967/github-artifact-cleanup-preflight.json`、`github-artifact-cleanup.json`；`macos-verification-result.json` 记录 beta.4 尚未安装。
- Windows 用户报告当前为 beta.1 或 beta.2，尚无升级实测。Mac beta.3 首次打开已由用户确认正常；CfT 账号交接曾一次 cold 15 秒失败，之后 warm 316 ms 与两次真实 cold 1.709 秒、1.795 秒成功，原因未复现。未改业务代码或扩大 timeout；这不等于完成资料/Profile 或升级验收。
- Sol 新增同长度、不同 SHA-512 冲突拒绝回归，定向测试 1/1、format、lint 通过；root 已审核测试修改。此前上传恢复/缺文件阻止注册两项定向回归 2/2 通过；真实托管恢复、全量复用和本机登记成功。P4.5 的工具链门禁已勾选，设备升级仍归 P5 待验收。
- P4/P5 整体验收仍未完成，不因 beta.3 首次打开成功而勾选阶段项。

## 后续门禁

1. 用户确认 beta/optional/100% 的具体发布范围后，执行并核对服务端策略及客户端自动发现、下载。
2. rollout 获得确认并实际发布后，分别记录 Mac beta.3 及 Windows 实际起始版本（用户反馈为 beta.1 或 beta.2，需现场记录精确值）、beta.4 目标版本、操作系统、CfT/资料状态、是否自动升级及异常；Mac 安装交接按 DMG 手动覆盖路径验收。

## 工作记录

- `eb5fbc3`：beta.4 三包版本与构建前演练记录。
- 本记录所在提交 `test(desktop): reject same-size release artifact conflicts`：同大小异哈希回归及候选完成记录；仅测试和文档变化，不改变 beta.4 安装包的业务源码。
- 完整候选证据位于 `/Users/outas/Downloads/WenXue-CI-36424859967/`：`release-review.json`、`hosting-upload-initial.json`、`hosting-upload-partial-recovery.json`、`hosting-upload-complete-reuse.json`、`hosting-operation-result.json`、`publication-result.json` 和 Mac/清理校验记录。

- 当前 beta.4 CI、最终 DMG 严格签名门禁、本机 prepare/prepare-upload、CloudBase 上传恢复与 register-upload 均通过；GitHub 临时 artifacts 已在完成备份校验后清理，下载备份及 CloudBase 对象保留。尚无 rollout 或实机升级证据；root 完成测试与文档审核后与本记录同批提交。预算设置只读核验通过。
