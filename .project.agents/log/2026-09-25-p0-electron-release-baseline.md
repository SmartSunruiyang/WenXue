# 恢复 Electron 正式发布基线

- **日期**：2026-09-25
- **关联**：[实施计划 P0–P7](../docs/superpowers/plans/2026-09-25-desktop-release-notifications-updates.md) / P0 文档与执行基线
- **会话上下文**：按已确认决定继续维护 Electron + 内置 CfT + 扩展 + CloudBase，废弃 Chromium AI 浏览器重构方案。

## 做了什么

- 恢复当前产品 PRD，保留 F1–F11 功能基线并写入已确认的 R1–R10；需求已确认不代表功能已实现。
- 修正规则入口中的当前路线、文档权威与阶段说明；AI 浏览器方案保留为历史资料。
- 为 10 篇 AI 浏览器历史正文加废弃标记，更新 2 个兼容入口，并修正当前功能 spec 对历史方案的引用。
- 在当前 ROADMAP 增加 P0–P7 交付阶段；仅 P0.1–P0.4 完成，P1–P7 保持未完成。
- 未修改业务代码、云资源、公告或版本发布；原工作区的 `visualObserve.background.ts` 未触碰。

## 提交

- `ccc2b3a` `docs: restore Electron product baseline and archive browser rewrite`（26 篇文档）
- `9f1c11f` 为前序计划提交。
- 本日志尚未提交，供后续统一提交。

## 状态变更与验证

- 当前 PRD 与路线入口已恢复；重构资料转为历史参考，旧验收记录未伪改。
- 26 篇文档通过 Prettier；`git diff --check` 通过；39 个新增相对链接与锚点有效。
- 计划 50 项任务中仅 P0.1–P0.4 勾选；10 个历史正文包含废弃标记。
- 未运行代码测试；本阶段没有业务代码变更。

## 下一步

- 执行 P1：复现公告、候选发布和客户端下载的真实问题，并核验生产配置与外部条件。
- 真实账号、GitHub/CAM/COS 配置、平台安装环境及旧版安装包状态均以 P1 实际核验为准。
