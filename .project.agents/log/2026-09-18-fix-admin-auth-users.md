# 后台用户管理统一使用 CloudBase Auth

- **日期**：2026-09-18
- **关联**：[方案](../docs/superpowers/specs/2026-09-18-admin-auth-users-design.md)、[计划](../docs/superpowers/plans/2026-09-18-admin-auth-users.md)
- **工作树**：`/private/tmp/wenxue-admin-auth-fix`，分支 `codex/fix-admin-auth-users`，基线 `69a1452`。原工作区的桌面界面和会话改动保留原样。

## 做了什么

- 注册已改为只创建 Auth 用户，而后台仍列出 `user_accounts`，造成新用户缺失；旧表的状态也不再影响 Gateway。将用户目录、启用/禁用统一接到 Auth `DescribeUserList` / `ModifyUser`。
- Auth 完整分页；旧表只按 UID 提供备注、历史时间，孤立记录不再显示。新增零用量用户直接可见，无需补写历史激活记录。
- 状态写入前持久化操作意图，写入后读取 Auth 确认结果；保留 `requested` / `succeeded` / `unconfirmed` 审计。不允许 viewer 操作或管理员禁用自己；已禁用管理员的旧会话也不能继续访问管理接口。
- UI 恢复状态操作，保存后重新查询人数、列表和用量，区分提交失败与提交后刷新失败。
- 补齐组合 Gateway 的部署包：Auth 适配器和现有 `@wenxue/client-operations` 运行时文件均包含在镜像中。

## 提交

- `03580b3` fix(admin): manage users through CloudBase Auth

## 状态变更与验证

- 同步当前运行时 ARCHITECTURE / TECH-INFRA，以及目标 AI 浏览器 PRD / ARCHITECTURE 中用户管理与兼容边界。
- AdminApi：120 项测试通过；Gateway：71 项测试通过，包含注册 → 新用户列表 → 禁用 → 模型调用 403 → 重新启用的真实模块集成测试，外部云端使用内存替身。
- AdminApi / Gateway TypeScript、全部修改源码的 ESLint、`git diff --check` 通过；AdminWeb 构建通过。既有单包体积警告保留，不扩展本次修复范围。
- AdminWeb 静态服务测试 2/2 通过。真实 Chrome 使用实际 App.tsx / adminApi.ts、本地内存会话和服务端进行验证：零用量新用户、启用/禁用人数刷新、保存后用量保留、筛选刷新、备注规范化、自禁用保护、viewer 只读、提交失败与刷新失败恢复均通过。控制台无 warning/error。
- 临时浏览器证据：`/private/tmp/wenxue-admin-ui-smoke/verification.md` 与 `trace.json`；没有修改真实用户状态，服务和临时标签页已关闭。
- 部署包 `/private/tmp/wenxue-admin-auth-deploy` 构建成功，共 16 个文件，1,283,655 bytes。

## 发布进展

- 最初携带原有 `EnvParams` 的部署被自动审批拒绝，理由是重新提交敏感配置。随后核实本机 MCP 2.19.5 使用 `UpdateCloudRunServer.Items` 差异更新，只提交 `Dockerfile` / `Port`，不传 `EnvParams`；该发布已获准并成功受理。
- MCP 要求代码目录处于原项目内，因此将构建产物逐文件哈希核对后复制到已忽略的 `.cloudbase-deploy/admin-auth-fix-20260918`，不包含 `.env` 文件，没有在原工作区修改源代码。
- 新发布版本 `wenxue-llm-gateway-031`，2026-09-18 02:35:25 提交，RunId `1x7GxB6DOGb6xq`。02:42:58 回读仍为 `creating` / BuildId `0` / 0% 流量。
- 过程日志显示 VPC、集群检查和 `create_build_image` 已成功，停在 `check_build_image: Image[BuildId=0] is still building`，尚未进入应用启动阶段；不能认定为应用代码失败。
- `getDeployLog` 返回 `User not created or may not qcloud user, please login CODING and try again`；这是构建日志读取限制，与构建是否最终成功需分开判断。已请求用户登录 CODING 以继续诊断，尚未获得可用日志。
- 原版本 `030` 保持 100% 流量，环境变量与发布前完全一致；线上 `/healthz` 返回 200 / `ok:true`，未登录 `/api/admin/v1/users` 返回 401。
- 线上新版本功能验证尚未完成；没有对真实账号执行禁用或其他写操作。只读验证脚本已准备于 `/private/tmp/wenxue-admin-live-check.mjs`，上线后校验健康、页面和 JS/CSS 哈希及鉴权。

## 下一步

- 查询 `031` 的构建和流量状态；如果出现失败，先查同一 RunId 的过程日志，不重复创建部署。
- 若成功上线，运行只读验证并将部署结果补充到 TECH-INFRA 与计划；若构建持续不推进，需在腾讯云/CODING 控制台解决平台构建问题。
