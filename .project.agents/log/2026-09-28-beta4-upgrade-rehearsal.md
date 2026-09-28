# 2026-09-28 — beta.3 → beta.4 N+1 升级演练准备

## 范围与起点

- 起始发布工作树提交：`3b04bce`。
- 用户确认 beta.3 在 Mac 上“正常打开了”。该反馈仅证明首次打开成功，不代表 CfT 启动、资料/Profile 保留或自动升级通过。
- 本轮准备下一候选 `0.1.1-beta.4`，演练方向为 beta.3 → beta.4。Sol 仅同步三包版本，不改业务行为；root 候选测试 2/2 通过，Sol 的 extension 11/11、website 6/6、frozen-lock、format 和 lint 均通过。三包版本修改及必要测试已完成，但尚未触发 CI 或产出 beta.4 包。
- 用户说明 Windows 当前版本为 `0.1.1-beta.1` 或 `0.1.1-beta.2`，尚未精确到单一版本；可按该现状开始验收，无需先手动安装 beta.3。

## 当前状态

- beta.4 三包版本同步和所需测试已完成；CI 构建与签名门禁、prepare/上传/注册均待完成，没有 beta.4 verified 候选。
- 尚无 rollout，且具体发布范围仍待确认；未开始实机升级验收。
- GitHub Actions artifacts API 当前为 0，且无运行中任务。构建前账单只读快照：GitHub Free Product Actions 139/2000 分钟，storage UI 显示 0/0.5 GB（页面取整），gross `$0.84`、discount `$0.84`、billable `$0`；Actions budget `$0`、spent `$0`、Stop usage=Yes。设置未修改。
- beta.3 Mac 首次打开成功，但 CfT 启动、资料/Profile 保留和自动升级结果仍未知。Windows 端也尚无本轮 beta.1/beta.2 → beta.4 实机升级结果。
- P4/P5 整体验收仍未完成，不因 beta.3 首次打开成功而勾选阶段项。

## 后续门禁

1. 冻结 beta.4 源码并完成 CI，核对 Windows 与 Mac 打包和最终 DMG 严格签名门禁。
2. 本机 prepare、签名、五对象托管上传及 register-upload 公网回读通过后，再确认具体发布范围。
3. rollout 获得确认并实际发布后，分别记录 Mac beta.3 及 Windows beta.1 或 beta.2 的实际起始版本、beta.4 目标版本、操作系统、CfT/资料状态、是否自动升级及异常；Mac 安装交接按 DMG 手动覆盖路径验收。

## 工作记录

- 当前为待执行演练日志草案，未提交；beta.4 CI、候选登记、rollout 与实机升级证据尚未产生。预算设置只读核验通过。
