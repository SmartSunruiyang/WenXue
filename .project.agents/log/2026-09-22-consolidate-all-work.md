# 汇总本地分支与全部工作区改动

- 日期：2026-09-22
- 用户要求：把所有分支和未提交代码全部合并、处理、提交。
- 目标工作区：`/Users/outas/WebstormProjects/WenXue` 的 `main`。
- 计划：`../docs/superpowers/plans/2026-09-22-consolidate-all-work.md`。

## 已保存的提交

- `3fca08d`：保存主工作区账号弹层、关闭确认、会话无界面交接与同期视觉调整。
- `efb8ab5`：整合计划。
- `09f80cc`：合入 `codex/restore-askwenxue-domain`。
- `cfe6abf`：保存旧 macOS 外观工作区。
- `fab7a41`：保存新手引导并增加素材就绪门禁。
- `e2bbded` / `c9c060c`：保存模型定价及验证记录。
- `fc117f9`：保存官网文档、隐私页和原首页动效。
- `dd371e1`：合入后台用户管理并与邮箱认证整合。
- `4385f01`：合入 macOS 分支历史，保留当前细化后的外观。
- `ac0907f`：合入模型费用统计。
- `2a5e691`：合入官网文档与隐私页面。
- `dc76d81`：合入教程，兼容账号与关闭弹窗并修正关于页重播入口。

## 整合取舍

- AdminApi 保留当前邮箱/昵称字段、Auth 权威与分离 store 接口；将旧分支的写后回读、未确认审计和后台交互改进适配到当前实现。
- macOS 首版 96px/sidebar 方案已在主干演进为 72px/under-window；保留后续用户调整，不恢复旧视觉参数。
- onboarding 六段正式 MP4 尚未录制。缺少任一素材时关闭自动引导与重播入口，不把用户标为已完成；源码、预览与进度逻辑保留。
- 官网和定价在各自独立工作区测试、提交后合入。

## 旧 stash 核对

- `pre-ai-browser-unrelated-work` 的插件模型同步已由 `e6dd441` 语义移植，见 `2026-09-18-merge-extension-model-sync.md`；当前保留运行中延迟重载等后续修复，不重复套用旧补丁。
- 其中 `apps/desktop/out/main/index.js` 是生成产物，不回填到版本控制。
- `pre-ai-browser-doc-system-source` 是已迁移文档的旧源稿；`9f2bcd2` 已建立正式重构文档域并将旧路径改为指针，见 `2026-07-14-ai-browser-doc-system.md`。
- 两份 stash 保留为历史备份，不删除，不用旧草稿覆盖正式文档。

## 验证与状态

- 初始桌面汇总：27 个 Vitest 文件 / 380 项测试及 14 项 Node 脚本测试通过；desktop typecheck 通过。
- 扩展：83 个文件 / 771 项测试通过；会话交接独立只读审查未发现阻塞问题。
- 非桌面最终验证：`pnpm --filter '!desktop' -r test`、`pnpm --filter '!desktop' -r build`、`pnpm --filter '!desktop' -r --if-present typecheck` 全部通过。
- 非桌面测试共 1174 项：AdminApi 113、Gateway 124、扩展 771、官网 6、后台静态服务 2、client-operations 13、llms 90、page-controller 17、core 38。
- 后台整合另外验证默认返回 501 个 Auth-only 用户、写后回读、未确认审计和邮箱 Auth-only 账号禁用/启用后网关行为。
- 桌面最终验证：30 个 Vitest 文件 / 401 项测试及 14 项 Node 脚本测试通过，`pnpm -F desktop build` 通过，整合后的 desktop typecheck 通过。全仓合计 1589 项测试通过。
- 新增集成回归覆盖缺素材时工作台/我的/关于可用且不写进度、素材齐备时跳过和关于页重播、公告/更新暂停及解除、关闭确认焦点与暂停及取消后解除。
- 本次变更的 58 个源码文件 ESLint 通过（0 errors；官网原改动有 6 warnings），96 个可格式检查文件仅有两份日志排版问题，已用 Prettier 修正；源码格式检查通过。`git diff --check` 和暂存检查通过。
- 最终分支审计：全部 7 个本地分支（含 main）的 tip 均已从 main 可达；全部 7 个 worktree 干净，无未提交或未跟踪文件。保留功能分支与工作区方便回溯。
- 各工作区定向验证见其原执行日志。本日志初版已随 `dd371e1` 保存，最终验证记录随本次汇总文档提交保存。

## 完成状态

- 本地分支与未提交工作区整合已完成，无剩余 Git 冲突或本地合并事项。
- 后续若需同步远端，先恢复 GitHub 认证，再重新 fetch 核对远端分支并推送；本次未作远端已同步的声明。
- 视频教学功能仍需正式录制六段素材后才会启用，其限制已同步原功能日志和架构文档。

## 外部限制

- `git fetch origin` 与 `git ls-remote --heads origin` 因 HTTPS GitHub 认证不可用失败（无法读取用户名）。本次不能验证未抓取的远端分支，也未推送。
- 不部署云端服务，不修改真实用户数据；安装包、线上模型调用及新手视频录制不属于本次 Git 整合验证。
