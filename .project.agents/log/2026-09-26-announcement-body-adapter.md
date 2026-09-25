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
- 当前线上版本为 036，健康检查返回正常；尚未部署本修复。

## 下一步

- 完成公告入口回归验收，以冻结提交准备最小部署目录，保持既有服务资源、环境配置和访问类型。
- 部署后重试同一测试公告，核对客户端弹窗、确认回执、目标隔离及跨设备去重；实证未取得前不勾选 P3 出口。
