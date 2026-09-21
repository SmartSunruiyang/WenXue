# 后台用户管理修复已发布到 Gateway 032

- **日期**：2026-09-18
- **关联**：[修复计划](../docs/superpowers/plans/2026-09-18-admin-auth-users.md)、[实现和初次发布记录](./2026-09-18-fix-admin-auth-users.md)
- **会话上下文**：用户完成 CODING 登录后继续先前发布；仍使用 `codex/fix-admin-auth-users` 独立工作树，原项目未提交改动保留。

## 做了什么

- 登录后获得版本 031 完整构建日志：Docker build、镜像导出和 TCR push 全部成功，但 CloudRun 将源码发布标为 `build_failed`。因此更正此前仅能观察到的“等待构建”状态；不能将其归因于业务代码编译失败，也没有证据证明 CODING 登录本身是发布失败的根因。
- 使用 TCR `DescribeImagePersonal` 核验构建 2605697728 的镜像标签和摘要，摘要与构建日志完全一致。
- 通过官方 `UpdateCloudRunServer` 的 `DeployType=image` 发布同一构建产物，以摘要固定镜像，`Items:[]` 保留所有服务配置，没有重新提交密钥或扩大访问范围。
- 版本 032 于 02:49:02 创建，随后状态 `normal`、`FlowRatio=100`。服务环境变量与发布前一致。

## 发布坐标

- 环境：`wenxue-d8gz76tacc3659f05`，服务：`wenxue-llm-gateway`。
- 版本：`wenxue-llm-gateway-032`，RunId：`1x7HAMnkUF4Rs6`，发布 TaskId：`2176639`。
- 镜像：`ccr.ccs.tencentyun.com/tcb-100048524831-qezw/wenxue-d8gz76tacc3659f05_wenxue-llm-gateway@sha256:c100a21f839c5524011f8564eebc9335ffdf5a8b857715d3ead88493c91bf269`。
- 镜像源码：`03580b3` 的部署包；未重新构建或改变业务实现。

## 提交

- `03580b3` fix(admin): manage users through CloudBase Auth
- `df2ce65` docs(admin): record verification and pending cloud build
- 本段归档提交：`docs(admin): record successful production rollout`（上线证据、TECH-INFRA 与完成勾选和本日志同一提交）。

## 验证

- `/healthz` 返回 200 / `ok:true`。
- 默认公网入口与底层服务的 `/admin` 均返回 200；HTML、`index-IwJfqjtd.js`、`index-Cs89cLaW.css` 的 SHA-256 与本次本地构建逐一一致。
- 未登录的 `/api/admin/v1/me` 和 `/api/admin/v1/users` 返回 401。
- 在内存中读取原服务配置，使用修复后的实际 Store 与原服务凭据只读访问生产 Auth/NoSQL：完整返回 8 个账号（7 启用、1 禁用、5 个 externalUser），其中 5 个账号无用量，读取 82 条用量记录成功。无敏感凭据或用户身份输出，没有真实数据写入。
- 本轮没有使用真实管理员会话执行账号写操作。启用/禁用、审计、权限与网关拒绝链路的依据为上一段通过的 191 项后端测试及真实 Chrome 本地测试；线上验证覆盖部署、静态资源、未登录边界与真实目录读取。
- 临时只读探针：`/private/tmp/wenxue-admin-live-check.mjs`、`/private/tmp/wenxue-admin-live-directory-check.mjs`。

## 状态与下一步

- 修复与发布计划全部完成，刷新后台即可加载新版本。
- 当前源码保存在修复分支；原工作区另有未提交修改，因此没有向其中叠加或强行合并本次提交。
- 后续若源码发布出现“镜像已 push、构建状态仍失败”，需依据构建日志、镜像摘要和过程日志诊断，不能仅凭 BuildId=0 将其判断为业务编译问题。
