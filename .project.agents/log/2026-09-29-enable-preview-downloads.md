# 支持官网公开下载已全量发布的 preview

- **日期**：2026-09-29
- **关联**：用户要求 0.1.2 preview 官网发布；[实现计划](../docs/superpowers/plans/2026-09-29-preview-downloads.md)

## 做了什么

- AdminApi 保留 stable 明确保留指针与历史行为；没有合格 stable 时，仅接受 beta 当前活动的 active / 100% / optional / verified Electron preview，要求合法 SemVer 预发布首段为 preview 和完整双目标安装器。
- preview 不进入历史下载指针。灰度、暂停、撤回、被替代、普通 beta/rc/dev、未验证候选与含 token URL 均不可公开。返回值仍为 version、publishedAt 与两个安装器白名单投影，不返回候选/管理员/签名/事件凭据或 NSIS metadata。
- 官网解析并标注预览版，沿用刷新清空、错误重试、点击重查与版本切换再次点击；正式版优先。将不适用的“正式”空态文案改为中性下载文案。
- 同步 PRD、ARCHITECTURE、TECH-INFRA、UIUX 的公开下载契约；顺带同步已实现的 `-beta` / `-preview` 默认 beta 通道说明。

## 提交

- 未提交，当前工作树仅包含本子任务的代码、文档和计划；由本子任务随后按明确文件清单提交，主任务继续冻结构建 SHA。日志随实现同一提交记录，具体提交号由 Git 历史索引。

## 验证

- `pnpm -F admin-api test`：219 个测试通过，包括 preview 正常投影、stable 优先、各失效边界与真实 store 的匿名请求。
- `pnpm -F admin-api typecheck`：通过。
- `pnpm -F website test`：18 个测试通过，包括 preview 解析/标注、点击复核与 preview → stable 切换。
- `pnpm -F website build`：TypeScript 和 Vite 构建通过。
- 变更代码 Prettier 校验与 `git diff --check`：通过。
- 变更代码 ESLint：0 error，1 个既有 `App.tsx` 通用按钮缺少 type 的 warning，本轮未修改该组件。
- CloudBase SEC001 语义检查：公开响应仅白名单业务字段，未新增 headers/context/env 回显、凭据读取或资源配置变更。
- 本子任务未部署，未声称真实官网或双平台安装验收通过；线上验证由主任务继续。

## 下一步

- 主任务提交冻结源码后构建 0.1.2-preview，部署组合后端与官网，注册并发布 beta/optional/100% 后核验公网下载与客户端策略。
