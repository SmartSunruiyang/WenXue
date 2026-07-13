# 优化高级设置默认值与模型工具选择兼容

- **日期**：2026-07-12
- **关联**：当前插件基线；[设计规格](../docs/superpowers/specs/2026-07-12-advanced-settings-model-compatibility-design.md)；[实施计划](../docs/superpowers/plans/2026-07-12-advanced-settings-model-compatibility.md)
- **会话上下文**：用户要求移除普通用户对 named `tool_choice` 的判断、保留默认关闭且带可信站点说明的 `llms.txt`、默认开启包含所有标签页。并行存在 PRD v0.2 浏览器化草案和 `apps/desktop/out/**` 构建产物改动，用户确认保留且本任务不修改 PRD 草案。

## 做了什么

- `@page-agent/llms` 严格识别实际已发送的 named `tool_choice` 400/422 类型/格式错误，自动以 `required` 重建一次请求；CloudBase 逻辑错误 envelope 也可识别，无关、鉴权、限流、服务端与 Qwen thinking 错误不学习。
- 插件按规范化 endpoint + exact model 将不兼容结论保存为版本化、30 天 TTL 的 `chrome.storage.local` 记录；记录不含 API Key、session、错误正文或鉴权头。主 Agent、视觉观察和学习通共享实时能力状态；跨扩展页面用 Web Lock + 读合并写避免并发覆盖，但不同 API Key 的完整模型配置保持隔离。
- 复审补强：复制后的主 Agent / 视觉配置通过动态能力读取器继续共享状态；可选能力缓存读取或清理失败时 fail-open，不再阻断 Agent 初始化。
- options 删除 named-tool 用户开关并清理旧 `llmConfig` / `advancedConfig` 字段；`llms.txt` 默认关闭并增加“仅建议可信网站开启”的中英文说明。
- “包含所有标签页”在存储、设置页、MultiPageAgent、TabsController 与 main-world 契约中默认开启，显式 `false` 和 `includeInitialTab: false` 保持有效；运行中新增标签仅纳入当前窗口、非固定且内容脚本可操作的页面。标签失去资格时自动移出，异步激活在标签关闭或 Controller dispose 后不得迟到写回。
- 同步更新 ARCHITECTURE、UIUX、UPSTREAM 与派生设计/计划；按用户确认未改动并行 PRD v0.2 草案。

## 提交

- `8b732fd` feat(extension): automate model compatibility settings

## 状态变更

- 架构文档：更新 `@page-agent/llms`、ExtensionSettingsConfig、MultiPageAgent、持久化表与测试边界；依赖 DAG 未变化。
- UI 文档：options 高级区不再展示 tool-choice 协议开关，明确 `llms.txt` 与全标签页默认值。
- 上游记录：登记 `packages/llms` automatic named tool-choice compatibility 本地补丁。
- 测试：
  - `pnpm -F @page-agent/llms test`：4 files / 90 tests 通过。
  - 模型、标签、Agent、视觉与学习通聚焦测试：5 files / 118 tests 通过。
  - `pnpm test`：全部 workspace 测试通过，共 713 项；插件 46 files / 447 tests 通过。
  - `pnpm build`：全部 workspace 构建通过；保留既有可选 `@microsoft/api-extractor`、Vite/es2025 与 React Babel 建议警告。
  - `git diff --check`：通过。
  - `pnpm -F extension exec tsc --noEmit`：被既有 `cards.tsx`、`HistoryDetail.test.ts`、`LogViewer.tsx`、`misc.test.ts`、`db.ts` 错误阻断，本次文件未产生诊断。
  - ESLint：仓库缺少 `@eslint/js`，配置加载失败，未执行规则检查；全仓 Prettier 仍有 170 个历史文件不合规，本次全部改动文件单独通过格式检查。
  - 浏览器 smoke：浏览器控制策略禁止访问 `chrome-extension://` options 页面，未绕过；构建产物与组件行为由构建及测试覆盖。

## 下一步

- 在实际加载本次 `.output/chrome-mv3` 的 CfT 画像中手动打开 options：确认高级区仅两个开关、`llms.txt` 说明排版、全标签页首次默认开启且可关闭。
- Chromium PRD v0.2 与迁移设计已在独立文档提交中处理；`apps/desktop/out/**` 构建产物按仓库规则未提交。
