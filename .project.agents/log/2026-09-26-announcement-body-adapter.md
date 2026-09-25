# 修复真实公告发布的请求体适配错误

- **日期**：2026-09-26
- **关联**：正式发布计划 P1.2、P3.1；AdminApi / CloudBaseLlmGateway。

## 复现与根因

- 已登录后台向测试账号 A 发布普通定向公告，界面返回 `Invalid JSON body`；按测试标题查询集合，记录数为 0。
- AdminConsole 已正确序列化完整业务对象。Functions Framework 1.18.2 将 `ctx.request.body` 直接传给 event，HTTP 元数据另存于 context。
- AdminApi 的 `readEventBody` 仅凭 `event.body` 为字符串就拆包，误把公告正文当作整个 JSON 请求体。
- 组合网关重导出 AdminApi 的入口；修复同一适配器即可覆盖管理站点和组合运行时，无需复制业务处理器。

## 变更

- 只拆解全部顶层键均属于已支持 HTTP 包装字段、且含 body/rawBody 的事件；含业务键的事件整体序列化。
- 保留现有字符串、对象、base64、rawBody 包装；body-only 保持原包装语义，畸形 JSON 仍返回 400。
- 同步 ARCHITECTURE 的 HTTP 入口契约。未改变公告鉴权、定向规则、signal 内容或业务校验。
- CloudBase SEC001 语义审查：适配器不记录或返回 event、headers、context 或环境变量；部署 Dockerfile 关闭框架请求头/正文日志。

## 提交与验证

- 同批提交：`fix(infra): preserve announcement body in direct HTTP events`，包括实现、回归测试、架构约定和本日志。
- 原用户状态接口的扩展回归先复现普通及 JSON-looking body 的两项失败；新增公告公共入口测试进一步断言响应及事务写入正文逐字不变。
- AdminApi 最终 128 项与组合网关 124 项测试、两包类型检查通过。主 Agent 独立复核原 250 项及新增后入口 17 项；目标 ESLint/Prettier 与 `git diff --check` 通过。
- 实现提交 `12ad186`；客户端恢复提交 `866466c`，两者均已快进合入 main 并推送。

## 部署与真实复测

- 冻结提交 `12ad186` 的 AdminConsole 构建通过，白名单发布包 16 个文件、1,278,858 字节；敏感文件和符号链接检查通过。
- MCP 要求部署目录位于主工作区内，首次 `/tmp` 路径调用在上传前被拒；逐字节复制至 gitignored `.cloudbase-deploy/announcement-12ad186` 后部署成功。
- CloudRun 037：DeployTime `2026-09-26 05:30:38`、BuildId `2607399952`、RunId `1xADV8Eoy4KhrL`，normal、100% 流量。CPU/内存/实例数/端口/环境变量/扩缩容策略保持一致，访问类型仅返回顺序变化。
- 037 同时包含此前已验收的双目标候选兼容改动。036 曾由 035 包单独替换计价文件生成，历史整包源码 SHA 不明，因此不声称此次生产差异只有公告适配器。
- 客户端网关 `/healthz` 正常。管理 UI 重试成功，定向公告只保存 1 条，状态 published，全局 signal revision=1；未向全体真实用户推送测试。
- 发布后 Mac 截图暂未出现弹窗，首次核对无确认回执。已请求测试 A 反馈并核对实际安装包；发布成功不等于送达或已读。
- signal 安全规则只允许登录用户读取 global 或自己的 uid 文档，客户端写入禁止；本次未修改权限。
- 部署日志查询接口返回 CODING 用户不可用，未扩大权限；部署结果依据服务版本状态、100% 流量、健康检查及真实管理操作验证。

## 下一步

- 继续定位客户端收取，核对确认回执、目标隔离及跨设备去重；实证未取得前不勾选 P3 出口。
- 当前测试公告有短有效期；复测结束后撤回。新客户端恢复实现仍需重新打包。
