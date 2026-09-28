# 准备 0.1.2 preview 的版本号与预览标识

- **日期**：2026-09-29
- **关联**：用户要求合并全部改动并构建、官网分发、全量推送 0.1.2 preview；本段仅负责版本元数据与显示。

## 做了什么

- desktop、extension、website 三个包统一为合法 SemVer `0.1.2-preview`，保留各包原有脚本。
- 桌面构建的默认通道同时识别 `-beta`、`-preview` 为 `beta`；显式 `WENXUE_UPDATE_CHANNEL` 仍优先。
- 桌面账号菜单、关于页、更新弹窗及扩展 `version_name` / 显示常量将该版本显示为 `0.1.2 preview`，更新弹窗保留 `beta` 通道标识。
- 官网公开下载策略由同轮独立改动处理；本段不更改候选协议或发布策略，也不声称已经构建或上线。

## 提交

- 日志落盘时未提交：由负责本段的 Agent 在验证后将以下改动与本日志精确提交为 `chore(infra): prepare 0.1.2 preview version`，完整提交号由总发布日志登记。

## 验证

- Node `v22.22.3` / pnpm `9.15.0`。
- `pnpm -F desktop exec vitest run src/renderer/src/App.onboarding.test.ts`：5/5 通过，包含 preview 菜单与关于页回归。
- `pnpm -F @wenxue/client-operations test`：18/18 通过，包含 preview 更新弹窗的版本和 beta 通道回归。
- 清除 `WENXUE_UPDATE_CHANNEL` 后直接加载桌面构建配置，main 和 renderer 注入值均为 `beta`。
- 直接加载扩展构建配置，`version_name` 为 `0.1.2 preview`，`__DISPLAY_VERSION__` 为 `v0.1.2 preview`。
- 对本段全部修改文件执行 Prettier，均通过。

## 下一步

- 主发布流程同步 TECH-INFRA 的默认通道描述并汇总全仓验证、CI 构建与发布证据。
- 本段验证不能替代 macOS arm64 / Windows x64 安装包构建与实机升级验收。
