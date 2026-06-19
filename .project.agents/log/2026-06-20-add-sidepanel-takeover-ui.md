# 完成侧边栏人工接管与暂停继续界面

- **日期**：2026-06-20
- **关联**：人工接管实施计划 Task 6 / `SidepanelApp`
- **会话上下文**：Task 3-5 已完成 core 可恢复接管协议、工具门控与重复动作检测。

## 做了什么

- 在 `useAgent` 中接入 `onUserTakeover`，增加可测试的单请求控制器，覆盖完成、暂停、终止、
  reconfiguration/dispose 清理与旧请求隔离。
- 暴露 `takeoverRequest`、完成/暂停操作和 `resume()`，并将运行、等待接管、暂停统一视为任务锁定态。
- 在对话流中增加软琥珀色接管卡片、暂停后继续卡片与紧凑完成记录，保留目标和最后动作详情，
  避免 waiting/paused 历史事件与活动行重复展示。
- 在侧边栏锁定新任务、恢复历史、模型切换与发送入口；等待/暂停时由卡片承载操作，运行态仍保留停止。
- 增加中英文接管文案与 waiting/paused 状态点，并补充 controller、渲染和 App 源码回归测试。

## 提交

- 本日志与功能同一提交：`feat(ext): add manual takeover controls`

## 状态变更

- ARCHITECTURE / PRD / UIUX：未修改；Task 1 已登记本任务的行为、模块职责与交互规则。
- 测试：
  - Task 6 focused tests：4 files、26 tests 通过。
  - `pnpm -F extension test`：17 files、92 tests 通过。
  - `pnpm -r test`：desktop 34、core 25、llms 58、extension 92 tests 全绿。
  - `pnpm -F extension build`：通过。
  - 目标文件 Prettier check 与 `git diff --check`：通过。
- 已知非失败项：
  - extension build 继续报告既有 `es2025` target 识别警告。
  - 独立 extension `tsc --noEmit` 仍被既有 `MultiPageAgent.test.ts`、未使用的
    `ActivityCard` 与 `misc.test.ts` 严格类型错误阻塞；本任务新增的 controller 类型错误已消除。

## 下一步

- 继续 Task 7，接入 content / Hub 外部暂停结果；不在本任务实现外部 resume API 或 legacy UI adapter。
