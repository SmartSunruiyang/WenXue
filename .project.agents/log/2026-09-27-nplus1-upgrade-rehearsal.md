# 2026-09-27 — N+1 beta.2 构建与候选登记

## 版本与 CI

- N+1 为 `0.1.1-beta.2`，desktop、extension、website 三个 package 的版本元数据同步；保留三包版本一致断言并调整显示版本断言。无 UI/业务变化，未部署官网。
- CI run [36271403682](https://github.com/SmartSunruiyang/WenXue/actions/runs/36271403682) 从 main 的冻结 commit `1534b7c18a16ba7b92735a10cdd346c8ee3f8677` 构建，quality、macOS、Windows、seal-artifacts 四个 jobs 全部成功。
- 根 Agent 独立验证候选脚本 2/2、extension options 11/11、website 6/6（共 19 项）；Sol 验证 frozen-lock 与 release lint 通过。
- 本轮 CI 触发前账单快照为 GitHub Free、Actions 70.3/2000 分钟、storage 0 GB/0.5 GB（页面取整）、billable `$0`、budget `$0`、spent `$0`、Stop usage=Yes；设置均未修改。

## 候选登记与备份

- `prepare`、`prepare-upload`、五对象 CloudBase hosting 上传及 `register-upload` 公网全量回读均通过。候选 `electron:beta:0.1.1-beta.2` 状态为 `verified`。
- `artifactSetSha512`：`L9159hjWZ1hgDf7M9eGqbJTFEoZtFXpNmR0A9wPrx6RY731jeAmw0s99c/tgUZnI3AZJjbPiZCyXmjpk3+J8MA==`；Ed25519 公钥指纹仍为 `bbacf14f6a6de5f743cf499bd85ccad61434d83f8f110ae4119b2b02eb01c336`。
- 五个发布对象及证据保存在 `/Users/outas/Downloads/WenXue-CI-36271403682/`，包括 `release-review.json`、`hosting-upload.json`、`hosting-operation-result.json`、`publication-result.json`。本轮三个 GitHub artifacts 保留：Windows ID `10916061409`（221052559 B）、macOS ID `10915313222`（277213410 B）、seal ID `10914979058`（939 B）。
- 旧 run `36260499160` 的三个临时 artifacts 已精确删除并回查剩余为 0；五对象备份与 CloudBase beta.1 候选保留。清理证据在 `/Users/outas/Downloads/WenXue-CI-36260499160/github-artifact-cleanup.json`。
- 用户授权今后在备份并校验通过、且旧 CI artifacts 不再用于当前 prepare/签名/注册门禁后自动清理。该授权不适用于当前仍需保留的新 run artifacts。

## 实机与放量状态

- 用户此前反馈 Windows 和 macOS 安装检查通过，但 beta.1 对应的设备与起始版本尚待对齐。本机 macOS 26.5 arm64 正在运行的 `/Applications/问学.app` 仍为 `0.0.1-beta`，不能据此认定本机已完成 beta.1 安装；相关澄清已发出，未收到答复。
- beta.2 候选已在后台显示为 verified，尚未发起版本发布。100% beta/optional 升级演练草案已填写：会面向所有版本低于 beta.2 且符合协议 2、平台/架构条件的 beta 客户端，不能限定两个测试账号；stable 通道不受影响。已询问用户是否启用该范围，未点击“立即发布”，等待确认。
- 草案证据位于 `/Users/outas/Downloads/WenXue-CI-36271403682/rollout-draft.json`。用户询问 Windows UI 是否需要两套代码；已答复共享逻辑与 UI、局部采用平台样式或组件，本轮不改 UI。
- 本轮没有 rollout、自动升级或 N→N+1 实机结果。P4.5 的复用/冲突/半成品恢复，P4.6 与 P5/P7 的相应验收仍未完成，不勾选。

## 工作记录

- 版本元数据和显示版本断言已在 `1534b7c` 提交并完成 CI。本次收尾仅更新发布计划与本日志，二者一同保存为后续文档提交；候选来源仍固定为 `1534b7c`。纯文档修改通过 `git diff --check`，未运行新测试。
