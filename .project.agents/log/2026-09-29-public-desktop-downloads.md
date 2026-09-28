# 官网正式下载来源与旧版撤回

## 范围与版本控制

- 实现基线：`605ba1f`；功能提交：`7808ff5`（已推送 `main`），工作树 `codex/release-notifications-updates`。
- 对应 P2.7、P6.3、P6.4 的接口/实现，以及 P6.2 的历史版本撤回边界；不创建 stable 候选，不改变 beta.4 rollout。
- 功能代码与随附设计文档已包含于 `7808ff5`；本次文档提交补记上线与验收结果。
- 主 Agent 负责方案、独立审查与验收；Sol 编写代码及测试，Luna 校准计划并补记部署文档。

## 改动

- AdminApi 公开稳定下载响应仅投影版本、发布时间、双目标安装器 URL/大小/SHA-512。无账号、CI、管理员和事件凭据；永久 HTTPS 链接不接受查询串/fragment，hex 哈希仅在公开投影规范为 base64。
- ReleaseChannelSlot 在既有发布事务中维护正式下载指针和最多 20 项明确保留历史。仅 verified、Electron stable、无预发布后缀、完整双目标且 100% 的新发布登记；旧 slot 不猜测迁移。
- 灰度保留此前全量稳定下载；暂停/撤回移除资格，恢复当前合格全量版本可重新加入。暂停旧版被标记 superseded 后不会复活。
- superseded 可单独撤回，保留当前 active/current/highestVersion；旧环境无 slot 时不创建空活动指针，有 slot 时保留字段缺省语义。禁止恢复旧 superseded 版本。
- WebsiteSite 消费同源 `/v1/public/desktop-downloads`，hero 不再使用构建版本。双平台显式选择、Mac 芯片说明、未签名提示、无版本/失败/加载状态；恢复页面和点击下载前重新检查，候选变化要求重新确认。
- 同步 PRD、ARCHITECTURE、UIUX、TECH-INFRA 操作手册与现有计划。手册明示灰度扩大操作尚待实现，不宣称当前支持完整灰度到全量。

## 验证

- Sol：AdminApi 193/193、Gateway 126/126、website 16/16；相关 typecheck、website/admin build 和定向 ESLint 通过。网站保留既有 lint warnings，admin build 保留既有 chunk 提示。
- 根 Agent 联合重跑 `pnpm -r --filter admin-api --filter llm-gateway --filter website test` exit 0，三个包全部通过；独立审查后补齐历史版本撤回及旧 slot 兼容回归。
- CUA 真实浏览器、本机合成 fixture：无版本禁用下载；1.2.3→1.2.4 点击重新核验阻止旧链接导航；503 禁用旧链接并可重试；键盘选择 Windows 后正确展示 EXE/大小；320px viewport 的 scrollWidth=320，无横向溢出。合成版本不属于线上候选，未下载真实安装包。
- `git diff --check` 通过。文档保留既有表格排版；Prettier 文档检查提示 ARCHITECTURE/PRD/计划存在排版差异，未为消除提示重排全文。
- 脱敏证据目录：`/Users/outas/Downloads/WenXue-public-download-20260929`，含联合测试日志与上线前官网 HTML。

## 上线与验收

- 上线前网关 039；保留既有 0.25 CPU / 0.5 GB、1–2 实例、访问类型、环境变量和 VPC，不增加套餐或运行规格。
- CloudRun `wenxue-llm-gateway` DeployId 040、BuildId `2607759180` / RunId `1xBGo9gKZohPJr` 部署为 normal 100%。配置对比中 CPU、内存、实例数、Env、VPC、端口、策略和开放访问类型均未变化；未增加计算规格。askwenxue.com 与默认 `app.tcloudbase.com` 的公开 GET 均为 200、`{release:null}` 并带 `no-store`；POST 为 405 且 `no-store`。`/healthz` 为 200，未授权 `/api/admin/v1/releases` 为 401。
- 官网四个资源和 `index.html` 已上传，公网字节与构建一致。新 Admin bundle `/admin/assets/index-Bh13JW83.js` 大小 1,027,940 字节，与部署 staging 完全一致。线上 CUA 确认没有正式版时下载按钮禁用、Windows 选择正确、重新获取可用。新建独立后台 tab 后成功登录并载入；beta.4 记录仍显示 optional 100%，检查 2、下载 2、交接 1、目标启动 2，状态“发布中”。未修改发布策略，未触碰原 tab 草稿。
- 七项 beta.4 只读策略回归与旧基线一致；`/Users/outas/Downloads/WenXue-public-download-20260929/policy-regression.json` 为正确检查证据。`http-probes.json` 中 `/health` 与 `/v1/admin/releases` 的 404 是对官网源站错误路径的探索结果，不代表服务退化；正确健康及管理接口结果记录于前述回归文件。
- 没有 stable 正式版本发布；官网公开接口当前返回空指针，不把 beta.4 伪装成正式版。无新 CI，未改 beta.4 rollout。部署配置布尔对比和网页资源核验详见脱敏 `deployment-verification.json`。

## 后续

- P6.4 完整灰度/全量/暂停/撤回的真实 stable 演练，P6.2 同候选灰度扩大，P4.4 验收证据模型及 P7 实机异常矩阵仍待完成。

## 本轮收尾

- 用户于 2026-09-29 要求直接收尾；本轮以现有已上线成果结束，剩余计划项保留未完成状态，不据此宣称整套正式发布流程已验收。
- 功能提交 `7808ff5` 与上线验收记录提交 `510aa00` 均已推送 `main`；收尾前实现工作树干净。本次仅补记交接状态，无业务代码变更，因此未重复运行已通过的测试。
- 保留后端 040、官网下载入口和 beta.4 optional 100% 策略；未发布 stable、未触发新 CI。临时预览服务已停止，备份、证据及后续可复用工作树保留。
