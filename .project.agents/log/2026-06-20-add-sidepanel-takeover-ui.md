# 完成侧边栏人工接管与暂停继续界面

- **日期**：2026-06-20
- **关联**：人工接管实施计划 Task 6 / `SidepanelApp`
- **会话上下文**：Task 3-5 已完成 core 可恢复接管协议、工具门控与重复动作检测。

## 做了什么

- 在 `useAgent` 中接入 `onUserTakeover`，增加可测试的单请求控制器，覆盖完成、暂停、终止、
  abort/dispose 清理与旧请求隔离。
- 暴露 `takeoverRequest`、完成/暂停操作和 `resume()`，并将运行、等待接管、暂停统一视为任务锁定态。
- 在对话流中增加软琥珀色接管卡片、暂停后继续卡片与紧凑完成记录，保留目标和最后动作详情，
  避免 waiting/paused 历史事件与活动行重复展示。
- 在侧边栏锁定新任务、恢复历史、模型切换与发送入口；等待/暂停时由卡片承载操作，运行态仍保留停止。
- 增加中英文接管文案与 waiting/paused 状态点，并补充 controller 与组件渲染回归测试。
- 规格审查修正：
  - 新增 `AgentSessionController` 绑定层，`execute()` 与 `configure()` 在任何 UI 状态变更、resolver
    取消或配置保存前读取 live agent 状态，并拒绝 running / waiting / paused。
  - 允许终态配置变更时，统一解绑并 dispose 旧 agent、只结算一次旧 takeover resolver，再从新 agent
    同步 status/history/activity/currentTask/takeover 可见状态。
  - Sidepanel 历史入口、历史列表/详情重新运行、模型与快捷语言配置在任务活动时显示禁用；
    Settings 入口仍可打开。
  - `useAgent({ enableUserTakeover })` 改为显式能力；Sidepanel 启用，Hub 关闭，因此 Hub 不安装
    `onUserTakeover`，core 会继续动态移除 takeover 工具与卡住守卫。
  - 用真实 EventTarget fake agent 测试状态/历史/活动事件、execute/configure guard、resume、
    reconfiguration cleanup 与 Hub capability；接管按钮测试直接调用生产 action model。

## 提交

- `c78abef feat(ext): add manual takeover controls`
- 本次规格审查修正：`fix(ext): harden manual takeover session guards`

## 状态变更

- ARCHITECTURE / PRD / UIUX：未修改；Task 1 已登记本任务的行为、模块职责与交互规则。
- 测试：
  - Task 6 focused tests：6 files、39 tests 通过，覆盖 controller、Conversation actions、
    HistoryList/HistoryDetail、Sidepanel history button 与 Hub capability。
  - `pnpm -F extension test`：19 files、108 tests 通过。
  - `pnpm -r test`：desktop 34、core 25、llms 58、extension 108 tests，共 225 tests 通过。
  - `pnpm -F extension build`：通过。
  - 目标文件 Prettier check 与 `git diff --check`：通过。
- 已知非失败项：
  - extension build 继续报告既有 `es2025` target 识别警告。
  - 独立 extension `tsc --noEmit` 仍被既有 `MultiPageAgent.test.ts`、未使用的
    `ActivityCard` 与 `misc.test.ts` 严格类型错误阻塞；本次修正无新增 TypeScript 错误。

## 下一步

- 继续 Task 7，接入 content / Hub 外部暂停结果；不在本任务实现外部 resume API 或 legacy UI adapter。
