# 修复 renderer 原生定时器接收者错误

- **日期**：2026-08-07
- **关联**：当前 Electron 运行时 / DesktopAnnouncementService / DesktopReleaseSignalService
- **会话上下文**：应用启动后右上角持续显示 `Illegal invocation`

## 做了什么

- 将两个 renderer 服务的默认 `setTimeout`、`clearTimeout`、`setInterval`、`clearInterval`
  绑定到 `globalThis`，避免类成员调用把服务实例作为浏览器原生函数接收者。
- 为公告服务和 release signal 服务新增原生定时器接收者回归测试。
- 将公告测试夹具的默认到期时间改为明确远期值，避免测试随真实日期推进失效；显式到期行为测试保持不变。
- 在运行中的 Electron 应用重载后等待后台服务启动，确认不再出现 `Illegal invocation`。

## 提交

- 未提交：工作树包含本问题链上一轮未提交修复与用户未跟踪文件，本次未获提交授权。

## 状态变更

- 架构文档：未改动；模块职责、依赖方向和对外接口均未变化。
- 需求/UI 文档：未改动；没有新增或调整产品行为。
- 测试：`pnpm typecheck` 通过；desktop 18 个 Vitest 文件共 147 个用例通过；14 个发布脚本测试通过；`pnpm build` 通过。
- 运行时复验：`Illegal invocation` 已消失；另观察到独立的 CloudBase realtime watch 初始化错误，轮询兜底仍可用，本次未扩大范围处理。

## 下一步

- 如需消除 CloudBase realtime watch 初始化错误，应单独诊断 SDK watch 失败原因及其用户提示策略。
