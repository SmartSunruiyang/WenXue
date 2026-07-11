# 提交并收敛本地分支到 main

- **日期**：2026-07-12
- **关联**：工作区提交整理 / 本地 Git 分支收敛
- **会话上下文**：用户要求提交当前两套 worktree 的全部代码改动，将所有本地分支整合到 `main`，仅保留 `main` 分支。

## 做了什么

- 将根工作区中后台网关、视觉观察、官网演示和桌面图标改动拆分为四个功能提交。
- 将独立 worktree 中的桌面启动器 UI 优化提交到其功能分支。
- 将视觉观察分支快进合入 `main`，并将桌面 UI 分支以无冲突三方合并纳入 `main`。
- 删除两个已合并的本地功能分支；第二 worktree 改为 detached HEAD，避免删除用户目录。
- 未提交 `apps/desktop/out/main/index.js`：它是生成产物，按项目规则已还原为仓库版本。

## 提交

- `af3826d` feat(admin): align CloudBase gateway routing
- `4358e76` fix(ext): harden visual observation protocol
- `a6b8f85` feat(website): add product demo animations
- `33ceb86` feat(desktop): add platform app icons
- `f3faff2` refactor(desktop): polish launcher UI workflows
- `be9b403` Merge branch 'codex/desktop-ui-refresh'

## 状态变更

- 架构文档：随各功能提交同步，未在本次收敛中新增架构改动。
- 测试：`pnpm -r test` 通过；desktop 87、extension 411、admin-api 13、llm-gateway 26、website 4，以及 vendor 包测试全部通过。
- 分支：本地仅保留 `main`。`/Users/outas/WebstormProjects/WenXue-ui-refresh` 保留为 detached worktree，不占用任何分支。
- 远端：`origin` 已配置但本地无远程跟踪 refs，且当前环境缺少 GitHub 凭据，无法验证或删除远端分支。

## 下一步

- 配置 GitHub 凭据后，先拉取并核对远端 `main` 与其他远端分支，再按共享仓库策略推送 `main` 或删除远端分支。
