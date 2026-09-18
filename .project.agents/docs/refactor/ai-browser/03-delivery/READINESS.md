# AI 浏览器重构开工就绪度

> - 状态：Phase 0.3 进行中；目标运行时代码尚未开工
> - 快照日期：2026-07-17
> - 规则：此表只记录可验证事实；未知项按未就绪处理。

## 1. 当前结论

产品方向、目标架构和实施阶段已经形成 G0 基线，新文档体系已建立。当前不满足 G1 工程开工条件，主要缺口是目标 Chromium 仓库与 revision、双平台工具链/runner、插件能力清单、对称性能基线和迁移样本。

在阻塞项补齐前，可以继续做只读审计、Spike 设计和基础设施准备，但不应在不受控的本地 Chromium checkout 上开始正式产品重构。

## 2. 工作区保护

文档体系建立前的已有工作已分别保存在 Git stash 中，未应用、未丢弃：

| stash message                    | 内容                                          | 处理规则                                             |
| -------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| pre-ai-browser-doc-system-source | 本次重构的最新 PRD、架构 Spec、实施 Plan 源稿 | 正文已迁入新文档域；stash 保留供审计，不直接回放覆盖 |
| pre-ai-browser-unrelated-work    | 其他未提交代码、UI/UX 与生成输出              | 完全不属于本次文档分支；未经用户指示不得应用或删除   |

当前文档分支：codex/ai-browser-doc-system。

## 3. G0 文档门禁

| 条目                                  | 状态   | 证据                                                       |
| ------------------------------------- | ------ | ---------------------------------------------------------- |
| 通用任务产品方向获批                  | 已完成 | [PRD](../01-product/PRD.md)                                |
| 每任务登录态与浏览器数据默认隔离      | 已完成 | PRD、[ARCHITECTURE](../02-design/ARCHITECTURE.md)、ADR-002 |
| 多任务可并行，多标签页 Agent 首版迁移 | 已完成 | PRD、ARCHITECTURE                                          |
| 目标架构与阶段计划获批                | 已完成 | ARCHITECTURE、[PLAN](PLAN.md)                              |
| 新重构文档域与权威入口                | 已完成 | [README](../README.md)                                     |
| 旧路径兼容指针和项目治理入口          | 已完成 | 旧路径仅保留迁移提示，治理文档指向本目录                   |
| 统一 UI 规范获批且保留功能骨架门禁    | 已完成 | [UIUX](../04-ui/UIUX.md)                                   |

## 4. G1 前置条件

### 4.1 阻塞项

| ID      | 条目                                                           | 状态   | 完成证据                                                                        |
| ------- | -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| RDY-001 | 建立 wenxue-chromium 远端仓库，明确可见性、访问权和 CODEOWNERS | 未开始 | 仓库地址、权限审计、责任人                                                      |
| RDY-002 | 锁定目标 Chromium milestone、commit/revision 与安全更新策略    | 未开始 | 已批准基线记录                                                                  |
| RDY-003 | 锁定 depot_tools、Python、编译器、SDK、Node 22 LTS 和 pnpm     | 未开始 | 机器可读工具链清单与校验脚本                                                    |
| RDY-004 | 配置 macOS arm64 原生构建 runner，安装完整 Xcode               | 未开始 | 干净 runner 构建日志                                                            |
| RDY-005 | 配置 Windows x64 原生构建 runner                               | 未开始 | 干净 runner 构建日志                                                            |
| RDY-006 | 制定源码、对象、缓存、符号和制品容量方案                       | 未开始 | 容量预算和清理策略                                                              |
| RDY-007 | 冻结现有插件能力矩阵和精确扩展 commit                          | 未开始 | CAP-01 至 CAP-13 基线报告；CAP-13 含 23 variant、run/cancel/crop/no-submit 证据 |
| RDY-008 | 采集 Chrome for Testing 对称性能基线                           | 未开始 | 单任务/双任务基线报告                                                           |
| RDY-009 | 准备脱敏迁移 fixtures，覆盖不同 Profile 状态                   | 未开始 | 版本化 fixtures 清单                                                            |
| RDY-010 | 完成任务承载机制 Spike 方案与验收脚本                          | 未开始 | ADR-006 决策输入                                                                |

### 4.2 已观察但未闭环

- 本机 Node 为 v26.1.0，与项目 Node 22 LTS 政策不一致；
- xcodebuild 未通过，当前只发现 Command Line Tools；
- fetch、gn、autoninja、siso、ninja 尚未发现；
- 本机没有 wenxue-chromium checkout；
- Windows runner 尚未确认；
- 曾观察到约 220 GiB 可用磁盘，但未完成 Chromium 全量源码、对象、缓存和符号容量预算；
- 目标 Chromium revision 尚未确定。

详见 [基础设施规范](../02-design/INFRASTRUCTURE.md)。

## 5. G2/G3 准备项

| ID      | 条目                                  | 状态         | 门禁 |
| ------- | ------------------------------------- | ------------ | ---- |
| RDY-101 | TaskBrowserHost 两种承载方式 Spike    | 待 G1 后执行 | G2   |
| RDY-102 | taskId 全链路归属与拒绝策略           | 待设计细化   | G2   |
| RDY-103 | Profile/OSCrypt/权限/密码存储隔离验证 | 待测试       | G2   |
| RDY-104 | 两任务并发 Agent 调度与焦点策略       | 待测试       | G2   |
| RDY-105 | 现有插件 API 与 Chromium 原生能力映射 | 待能力矩阵   | G3   |
| RDY-106 | MV3 生命周期、更新与回滚策略          | 待设计细化   | G3   |
| RDY-107 | 多标签页 Agent 行为等价               | 待实现       | G3   |

## 6. 开工判定规则

允许进入目标运行时代码实施，必须同时满足：

1. RDY-001 至 RDY-010 均有责任人、期限和可审计证据；
2. G1 所需双平台最小浏览器构建可在干净 runner 复现；
3. PRD、ARCHITECTURE、INFRASTRUCTURE、TESTING 和 MIGRATION 的 G1 相关内容评审无阻塞意见；
4. 现有插件能力与性能基线已冻结，避免实现完成后才定义“等价”；
5. 出现失败时有明确的源码、构建和文档回退点。

不满足上述条件时，不以“先写一点正式代码”绕过门禁。探索性 Spike 必须放在隔离分支，明确不可直接合入产品分支。

## 7. 下一步

建议按以下顺序推进 Phase 0.3：

1. 决定新 Chromium 仓库的归属、权限和责任人；
2. 选择两到三个候选 Chromium revision，完成兼容与安全评估后锁定一个；
3. 同时建立 macOS 和 Windows 干净构建 runner；
4. 从现有扩展和运行时生成 CAP-01 至 CAP-13 能力基线；
5. 采集 Chrome for Testing 单任务与双任务性能基线；
6. 准备迁移 fixtures 和 ADR-006 Spike 测试脚本；
7. 召开 G1 开工评审，所有阻塞项通过后再开始目标运行时实现。
