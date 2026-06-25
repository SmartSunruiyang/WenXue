# 修复人工接管时侧边栏无法退出

- **日期**：2026-06-26
- **关联**：F3 侧边栏对话与网页操作 Agent / SidepanelApp 人工接管
- **会话上下文**：用户反馈登录或验证码弹窗出现后，无法继续发送消息、新建对话或结束对话。

## 做了什么
- 定位根因：Sidepanel 将 `waiting_for_user` / `paused` 与 `running` 一样作为全 UI 锁，导致输入框、新建对话与底部停止入口不可用。
- 增加 `getSidepanelControlState`，把运行中锁定与等待人工接管分开；等待登录/验证码时保留输入、新建对话与停止按钮。
- 增加活跃任务消息提交通道：等待接管/暂停时输入内容会写入当前 Agent observation，并完成接管或恢复暂停，继续沿用本次对话记忆。
- 保留 `resetActiveConversation` 作为显式新建对话的逃生出口：用户点新建对话时才停止并释放旧 Agent，绑定新 Agent。
- 补充回归测试覆盖等待接管时的逃生控件、活跃任务消息提交，以及重置活跃接管会话时的 Agent 替换与弹窗清理。

## 提交
- 未提交，工作树状态：本次修复仍在当前会话中等待用户确认。

## 状态变更
- ARCHITECTURE：未修改；改动仍在既有 SidepanelApp / useAgent 边界内。
- PRD / UIUX：未修改；符合 F3 已定义的人工接管后可继续、可暂停/退出的行为。
- 测试：`pnpm -F extension test -- App.test.ts useAgent.test.ts` 通过；`pnpm -F extension test` 通过（38 files / 340 tests）；`pnpm -F extension build` 通过（WXT 构建成功，保留既有 esbuild target 警告）。

## 下一步
- 如需更强保证，可在真实浏览器里触发 `request_user_takeover`，手动验证验证码/登录等待态下停止、新建对话，以及输入补充信息后继续同一任务的交互。
