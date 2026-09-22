# 修复线上 Tokens 参考成本始终为零

- **日期**：2026-09-23
- **关联**：当前运行时 CloudBaseLlmGateway、TokenUsageStore、UsageCloudClient 与 ConsoleUI；`docs/context/ARCHITECTURE.md`「内置模型成本估算」
- **工作树**：`codex/fix-token-estimated-cost`，隔离于主工作区已有的侧边栏样式改动

## 做了什么

- 在真实桌面 Tokens 页复现：124,965 tokens，参考成本 ¥0.0000；当前线上 CloudRun 035 承接 100% 流量。
- 对照 035 发布包与已合并源码，确认 035 汇总每条记录时把金额固定为 0，历史 `token_usage` 记录没有金额字段；仓库里的 Qwen3.7 Plus / Max 计价与历史补算逻辑尚未发布。
- 用户确认目标环境 `wenxue-d8gz76tacc3659f05` 并授权发布。以原 035 白名单发布包为基线，仅替换 `apps/llm-gateway/src/gateway.mjs`，其余 12 个文件逐字节相同；发布到 `wenxue-llm-gateway` 036。云端 DeployTime `2026-09-23 02:56:30`，BuildId `2607262307`，RunId `1x95fKT8Fb8sZO`；状态 normal，流量 100%。运行资源配置、访问类型与环境变量沿用 035。
- 同步 `docs/context/TECH-INFRA.md` 的现行版本和发布验收记录。无新增代码、模块或架构依赖。

## 提交

- `e2bbded` `feat(desktop): 估算内置模型调用成本并展示计价规则`：本次发布所用计价实现。
- `ac0907f` `feat(desktop): merge token cost pricing`：计价实现并入主线。
- 本次部署文档与日志在 `codex/fix-token-estimated-cost` 单独提交；主工作区的既有未提交改动未触碰。

## 状态变更与验证

- 网关测试 124/124、typecheck 通过；036 发布包可解析，历史 5,807 tokens 的 Max 样例补算 ¥0.0730。
- CloudRun 036 为 normal，流量 100%；客户端使用的 `run.wxcloudrun.com` 入口 health 200、无凭据 usage 401；底层 CloudRun 入口旧注册 410、后台页面 200。
- 同一桌面 Tokens 页刷新后显示 152,720 tokens、参考成本 ¥1.9262；新增调用使刷新前后 token 总数不同，金额由 0 转为非零已得到真实 UI 验证。
- 历史记录未回写；缺少缓存明细时按普通输入补算，按现有架构契约属于参考估算。

## 下一步

- 用户可在 Tokens 页手动刷新查看当前金额；如遇已有离线缓存，需要在网络可用时再次刷新。
- 将本分支的部署文档提交整合到主工作区，保留主工作区已有的样式改动。
