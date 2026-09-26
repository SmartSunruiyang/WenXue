# 2026-09-27 — N+1 beta 升级演练准备

## 范围与版本控制

- 本次只记录 beta.1 实机安装反馈与 N+1 演练准备，不修改业务代码、UI 或发布配置。
- N+1 目标为 `0.1.1-beta.2`。desktop、extension、website 三个 package 版本元数据已同步，保留三包版本一致断言并调整一个显示版本断言；无 UI/业务变化，也未构建、上传或部署官网。根 Agent 独立通过候选脚本 2/2、extension options 11/11、website 6/6；Sol 已通过 frozen-lock 与 lint 检查。CI 尚未触发。
- 基线提交为 `4faa4a555dcce902dd8485b870247d4bf985a0a9`；本日志和当前发布计划随版本元数据及既有测试调整的同一提交保存。文档不额外运行测试，源码变更的验证如上。

## beta.1 实机反馈

- 用户明确反馈 Windows 与 macOS 均已安装测试通过。针对 beta.1 检查了版本、资料和 CfT 插件，结果正常。
- 该反馈属于用户实机结果；未收集系统具体版本与实机包哈希。
- 自动升级尚未测试，不能将本次安装反馈外推为 N→N+1 更新验证。P5 整体保持未完成且不勾选；具体覆盖安装过程、数据保留和多 Profile 等验收范围仍以计划矩阵为准。

## 当前 N+1 边界

- beta.1 候选 `electron:beta:0.1.1-beta.1` 已登记 verified。下一步构建 beta.2 后，应按计划完成来源、签名、托管回读与注册门禁，再安排 N→N+1 实机验证。
- 用户询问未来 Windows UI 是否需两套代码。已说明共享业务逻辑与 UI，并按需使用平台样式或局部组件；这只是答复，不构成本轮 UI 改造授权。
- 本轮暂不勾选 P5 整体，也不将安装检查描述为自动升级。

## GitHub 临时产物清理

- 用户明确授权：本次及以后，旧 CI 临时产物在完成备份、校验通过且确认不再供当前 prepare、签名或注册使用后，可以自动清理。
- run `36260499160` 的三个 GitHub artifacts 已只读核验：均属于该 run 与 commit `6fb2731a9e303e2ead81567b78d06c69b42e9a0c`，共 `498266780` bytes；五个待发布本地对象均与记录中的 SHA-512 和大小一致。
- 本地备份和三份发布记录保存在 `/Users/outas/Downloads/WenXue-CI-36260499160/`，CloudBase 候选保留。根 Agent 已精确删除上述三个 artifact，回查剩余为 0；永久操作证据保存在 `/Users/outas/Downloads/WenXue-CI-36260499160/github-artifact-cleanup.json`。
- 新 CI 触发前账单快照：GitHub Free，Actions 70.3/2000 分钟，存储 0 GB/0.5 GB（页面取整），当前应付 `$0`；Actions budget `$0`、spent `$0`、Stop usage=Yes，均未修改。

## 下一步

- 临时产物清理已回查完成；冻结本轮提交并触发双平台 CI。
- beta.2 完成构建、候选登记后，在 Windows 与 macOS 验证 N→N+1 行为并记录系统版本、候选身份、实机包哈希与结果；自动升级未实际测试前继续标为未验证。
- 当前没有 rollout 或受控发布结论。
