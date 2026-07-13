# 建立 AI 浏览器重构文档体系

- 日期：2026-07-14
- 类型：文档与项目治理
- 关联：AI 浏览器重构 G0 / 阶段 0.2
- 分支：codex/ai-browser-doc-system
- 提交：本日志所在的 docs commit（以 Git 历史记录为准）

## 做了什么

- 将已批准的 AI 浏览器 PRD、目标架构和实施计划迁入
  `.project.agents/docs/refactor/ai-browser/`。
- 建立 README 权威入口，以及 DECISIONS、INFRASTRUCTURE、READINESS、TESTING、MIGRATION 和
  UIUX 专项文档。
- 明确当前 Electron + CfT 文档域与目标 Chromium AI 浏览器文档域的边界和同步规则。
- 将旧 PRD、架构 spec 和实施 plan 路径改为兼容指针，避免维护重复正文。
- 更新 AGENTS、CLAUDE、SELF_CONSTRAINTS 与 VIBECODING_GUIDE，使后续 Agent 从正确文档域开工。
- 把“任务登录态不共享、任务 Agent 可并行”落实为隔离、并发、迁移、性能和 G0～G6 门禁。

## 工作区保护

开工前把用户已有改动分开保存，未应用或删除：

- `pre-ai-browser-doc-system-source`：最新 PRD / 架构 / 计划源稿；
- `pre-ai-browser-unrelated-work`：其他未提交代码、UI/UX 和生成输出。

## 验证

- Prettier 格式化全部新增/修改 Markdown；
- Git diff whitespace check 通过；
- 新文档域无模板占位符或 ADS:FILL 标记；
- 相对 Markdown 链接解析检查通过；
- 权威路径和阶段状态一致性检查通过。

## 状态变更

- G0 产品、目标架构和计划基线：已完成；
- 阶段 0.2 文档与治理入口：已完成；
- 当前阶段：0.3 / G1 开工就绪度；
- 目标 Chromium 产品代码：尚未开工。

## 下一步

关闭 READINESS 中 RDY-001～RDY-010：建立 wenxue-chromium 远端并锁定 revision，补齐
macOS/Windows runner 和工具链，冻结插件能力/隔离/性能基线及迁移 fixtures，然后召开 G1 开工评审。
