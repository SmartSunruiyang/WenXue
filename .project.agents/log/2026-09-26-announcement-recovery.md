# 公告客户端恢复与迟到确认竞态修复进展

- **日期**：2026-09-26
- **关联**：正式发布、消息通知与客户端更新计划 P3.3；[实施计划](../docs/superpowers/plans/2026-09-25-desktop-release-notifications-updates.md)
- **会话上下文**：公告客户端恢复代码已通过主 Agent 验收，打包和实机闭环仍待完成。

## 做了什么

- `DesktopAnnouncementService` 在网络恢复、窗口重新聚焦和页面重新可见时补拉公告；重复恢复请求合并，同时不会吞掉新的 revision。
- 确认成功后，迟到的 pending 响应不会让公告重新出现。账号切换或 `stop()` 后，旧会话 ack 的成功、HTTP 失败及网络 reject 均静默作废；当前账号 ack 失败则保留公告供重试。
- 主 Agent 独立复核 18/18 个 `DesktopAnnouncementService` 测试、typecheck、目标 lint 与 format 通过。Sol 的 6 个迟到 ack 回归用例在修复前有 4 个失败，修复后全部通过；首批其余用例未保存修复前运行证据。
- 真实后台发布复现返回 `Invalid JSON body`，未创建公告。根因为 AdminApi 适配器将 Functions Framework 直接传入的业务 `body` 当作 HTTP 包装体拆解；服务端修复、部署和复测另行记录。
- 用户已登录后台并确认 Mac 测试 A 就绪，目前没有公告送达或确认实证。此日志只用 A/B 指代测试账号，不记录真实 UID 或邮箱。
- 同步 PRD 的恢复与确认行为、ARCHITECTURE 的 resume 接口及会话隔离约定。

## 提交

- 同批提交：`fix(desktop): recover announcements without reviving acknowledged messages`，包含实现、测试、上游文档、计划和本日志。

## 状态变更

- 架构与需求文档：已同步；未新增模块或依赖方向。
- 测试：Node 22.22.3 下相关 18/18 服务测试、desktop typecheck、目标 ESLint/Prettier 和 `git diff --check` 通过。
- 实机：P3 真实后台发布、客户端送达、确认与跨设备去重尚无实证，P3 出口未完成。

## 下一步

- 跟进 AdminApi 请求适配修复、部署和后台发布复测；后续冻结提交重新构建客户端。
- 在得到实际送达、确认和跨设备回执证据后，再更新 P3 实机验收状态。
