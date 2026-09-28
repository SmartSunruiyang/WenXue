# 官网正式下载来源与旧版撤回

## 范围与版本控制

- 基线：`605ba1f`，工作树 `codex/release-notifications-updates`。
- 对应 P2.7、P6.3、P6.4 的接口/实现，以及 P6.2 的历史版本撤回边界；不创建 stable 候选，不改变 beta.4 rollout。
- 本段代码及同步文档尚未提交：正在由根 Agent 封存、上线；提交与部署结果随后追加。
- 主 Agent 负责方案、独立审查与验收；Sol 编写服务端/官网/后台代码及测试，Luna 校准计划历史记录。

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

## 部署准备与后续

- 上线前网关 039；保留既有 0.25 CPU / 0.5 GB、1–2 实例、访问类型、环境变量和 VPC，不增加套餐或运行规格。
- 已为 askwenxue.com 与默认 app.tcloudbase.com 域名新增唯一 `/v1/public/desktop-downloads` CBR 路由，使用公开接口、开启路径透传；其余路由不变。具体线上验证结果随后记录。
- 当前只有 beta.4 实机升级证据，没有 stable 全量正式版本。预期上线后的公开响应为 `{release:null}`，官网暂不可下载；不把 beta.4 伪装成正式版。
- P6.4 完整灰度/全量/暂停/撤回的真实 stable 演练，P6.2 同候选灰度扩大，P4.4 验收证据模型及 P7 实机异常矩阵仍待完成。
