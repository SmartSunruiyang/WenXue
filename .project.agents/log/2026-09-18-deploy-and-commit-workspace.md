# 部署画像账单修复并提交工作区改动

- **日期**：2026-09-18
- **授权**：用户明确要求“部署并提交所有未提交改动”。
- **范围**：发布当前 CloudBase 网关代码；将工作区既有桌面端、扩展、官网与文档改动全部纳入版本控制。

## 执行计划

- [x] 核对工作区范围、现有部署记录与线上网关配置。
- [x] 完整回归受影响应用，生成白名单部署包。
- [x] 保留线上环境变量与运行规格，部署并验证网关。
- [x] 同步上线记录、提交全部改动并确认工作区状态。

## 开工基线

- 当前分支 main；工作区包含本日多项 UI 调整、账号信号修复、画像账单归属修复及其文档。
- CloudBase 环境 wenxue-d8gz76tacc3659f05 / ap-shanghai 为 NORMAL。
- 网关在线版本 wenxue-llm-gateway-032，100% 流量，服务与版本状态 normal。
- 保留容器模式、0.25 CPU / 0.5 GB、MinNum=1、MaxNum=2、Port=3000，以及 OA/PUBLIC/MINIAPP 入口和现有环境变量。
- 官网备案页脚已有单独上线验证记录，本次纳入源码提交。

## 验证与部署结果

- 本地分组回归合计 1160 项通过：Desktop Vitest 219、桌面发布脚本 14、Extension 764、Gateway 83、AdminApi 74、AdminConsole 静态服务 2、Website 4。
- 扩展全量运行先通过 763 项；双 localhost fixture 在受限沙箱超时，允许本地监听后该项重跑通过。桌面 handoff 与后台静态服务测试也使用允许本地监听的环境。
- Desktop、Gateway、AdminApi、AdminConsole、Website 类型检查通过；Desktop、Extension、AdminConsole、Website 生产构建通过。
- 扩展全量类型检查仍有 7 项既存诊断（TabsController.test.ts、cards.tsx、LogViewer.tsx、db.ts），账单修复阶段已做 HEAD 基线对照，不将其表述为全仓类型检查通过。现有 es2025/esbuild 与 bundle 大小警告仍在。
- 待提交代码 ESLint 0 错误、25 条既有提示；源码 Prettier 和 git diff --check 通过。修正官网 HTML 的格式后重新构建与上传，未改动其页面行为。
- 包管理器 pnpm 11 自动切换仓库固定版本时遭遇网络失败，自动依赖检查也试图重装依赖但被无 TTY 保护中止。测试优先直接调用已安装 CLI；部署脚本通过仅本次进程的 pm_on_fail=ignore、verify_deps_before_run=false、update_notifier=false 运行原有 admin build，未安装或更新依赖。
- 原有白名单脚本生成 12 个文件、1250207 字节的部署包，含 /admin/ base 的后台产物。MCP 拒绝工作区外 targetPath 后，将已扫描的包逐字节复制到 Git 忽略的 .cloudbase-deploy/billing-20260918，再按原配置发布。
- 新版本 wenxue-llm-gateway-033，构建 ID 2605704907，RunId 1x7WPYBuyKoKli；最终服务与版本 normal，100% 流量，无发布进行中。上线前版本 032 保留作回滚参照。
- 发布前后比对 CPU、内存、实例上下限、端口、访问类型、伸缩策略、Dockerfile/命令、VPC、运行模式及内部访问配置均一致；环境变量按内容比较完全相同，未记录任何密钥值。
- 生产 13 项检查通过：直连与客户端原入口健康、两个入口非法画像 ID 拒绝、有效/缺失画像 ID 的未登录拒绝、usage/admin/announcement 鉴权、注册 CORS，以及后台 HTML 和实际 JS/CSS。两个静态资源逐字节匹配本地构建。
- 新画像逻辑的线上证据：同一非法 ID 请求在 032 返回未登录错误，033 返回 Invalid X-WenXue-Browser-Id header；有效 ID 仍要求登录，没有把画像 ID 当作授权。
- 官网备案页脚已在较早任务上线；本轮重新上传格式统一后的 index.html，下载托管文件核对，首页与 site-footer.css 均逐字节匹配最终构建。
- 提交期间另一任务继续完成登录入场动效与密码显示控件。本轮用临时索引快照分离 UI 和账单修改，全程未覆盖工作区源码；最新密码控件再经桌面双类型检查、生产构建、ESLint、Prettier 与 diff 检查，另有原任务的隔离交互验证记录。
- 临时验证证据：/private/tmp/wenxue-deploy-before.json、wenxue-deploy-after.json、wenxue-deploy-*-tests.log 与各应用构建日志。

## 验证边界与后续

- Chat 非流式错误沿用发布前已存在的 HTTP 200 外层、body.statusCode=400/401 协议；本轮按业务错误字段判断拒绝，未误报为 HTTP 400/401。usage、admin 与 announcement 端点实际 HTTP 401。
- /v1/chat/completions 的直接 OPTIONS 探针未通过通用网页 CORS 预检：返回 Unsupported chat model，未带允许跨域头。本轮没有修改该入口适配器；当前扩展以 manifest 中的 <all_urls> 主机权限执行跨域 fetch，桌面用量请求来自 main。注册端点的既有 OPTIONS 实际返回 204 / Allow-Origin=*；不把它等同于 chat CORS 通过。
- 未使用真实用户凭据、未调用收费模型、未改写历史用量；因此没有把真实账号的新计量写入列为生产验收。此前隔离 Electron 已验证名称、重命名与导出行为。
- 需使用更新后的启动器/扩展并重新打开画像，后续调用才带画像归属；历史缺失 ID 的用量无法可靠回填。本轮没有发布新安装包。
- 工作区内各任务旧日志里的“未提交”描述的是各自结束时的历史状态；以下统一列出本轮补提交结果。

## 提交

- 176a092 fix(infra): publish website ICP footer
- db897be fix(desktop): scope account announcement signal watches
- 81ea73a feat(desktop): unify launcher and extension interfaces
- ddc4972 fix(desktop): attribute cloud usage to browser profiles
- d4f321a feat(desktop): add password visibility controls

以上五个实现提交位于 main，本文件以独立文档提交记录发布与验证结果；未执行远端推送。
