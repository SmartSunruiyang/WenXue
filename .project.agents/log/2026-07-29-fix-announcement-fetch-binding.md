# 修复公告同步 fetch 的浏览器接收者绑定

- **日期**：2026-07-29
- **关联**：当前 Electron 运行时 `DesktopAnnouncementService`
- **会话上下文**：开发启动器右上角显示 `Illegal invocation`；在当前 Electron renderer 的
  DevTools 中确认原始错误为 `Failed to execute 'fetch' on 'Window': Illegal invocation`。

## 做了什么

- 将公告服务默认 `fetch` 适配为通过 `globalThis.fetch(...)` 调用的箭头函数，避免实例字段调用把
  `DesktopAnnouncementService` 错误地作为原生 `Window.fetch` 的接收者。
- 新增回归测试，捕获默认 `fetch` 的实际接收者并断言为 `globalThis`；旧实现会在该测试中暴露错误
  接收者。

## 提交

- 未提交：当前会话延续上一项开发模式更新提示修复，用户未要求创建提交；工作区原有未跟踪文件
  `问学官网与后台网址.txt` 保持未修改。

## 状态变更

- 架构文档：未修改；没有新增模块、依赖边或行为契约。
- 测试：
  - 新增 fetch 接收者回归测试：1 项通过。
  - 公告服务非过期场景：5 项通过、3 项已知固定日期场景按名称过滤未运行。
  - 桌面端 typecheck、生产 build、目标文件 Prettier 与 `git diff --check`：通过。
  - 3 项固定日期测试的默认 `expiresAt=2026-07-24T12:00:00.000Z` 早于当前日期的问题仍保留为独立
    任务，本修复未扩大范围。

## 下一步

- 重启当前 `pnpm dev` 桌面进程，确认公告同步不再产生右上角 `Illegal invocation` toast。
- 独立修复公告测试的固定过期日期，恢复桌面全量测试绿灯。
