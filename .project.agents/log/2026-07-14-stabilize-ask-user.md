# 稳定 ask_user 与人工接管分流

- **日期**：2026-07-14
- **关联**：PRD CAP-10 / F13；ARCHITECTURE SidepanelApp / @page-agent/core
- **会话上下文**：用户要求先明确 `ask_user` 的职责，保证需要时可稳定调用，并保留登录、验证码等页面的人工接管提示。

## 做了什么

- 明确职责：`ask_user` 只收集页面无法确定的必要用户信息或歧义选择；登录、验证码、滑块、2FA、权限等受保护动作继续使用 `request_user_takeover`。
- Sidepanel 启用并绑定 `onAskUser`，新增可取消的单待处理问题控制器；回答直接 resolve 回原工具调用，不额外伪造 observation。
- Agent 等待普通回答时保持 `running`，只解锁输入与发送按钮；展示独立中性问题提示，保留停止按钮并关闭误导性的运行遮罩/活动文案。
- 保留人工接管控制器和醒目提示，支持完成、暂停、恢复；Hub 因无回答入口而显式禁用两类用户交互工具。
- stop、reset、restore、rebind、dispose 与 AbortSignal 均会清理挂起请求；重复问题只允许最新请求被回答。
- 收紧 core 工具 schema/说明与两份 system prompt，并补上工具单独启用时不泄漏不可用工具名的测试。
- 复审消除提示词内部冲突：普通歧义先澄清，不再同时要求直接 `done` 或“遇到任何困难就提问”。

## 提交

- `972e3a2` feat(extension): stabilize user clarification flow

## 状态变更

- ARCHITECTURE：更新 @page-agent/core 与 SidepanelApp 的职责、状态和取消契约。
- PRD / UIUX：补充普通澄清、受保护动作接管、停止清理及侧栏展示验收标准。
- UPSTREAM：登记 core 工具说明、提示词和测试的 vendor 偏离。
- 测试：用户交互相关定向测试通过；扩展全量 46 个文件、447 项通过；PageAgentCore 38 项通过；`pnpm test` 全仓共 713 项通过。
- 构建：`pnpm build` 全部 workspace 通过；保留既有 OXC/`es2025` 与缺少 API Extractor 的非阻断警告。
- 静态检查：`git diff --check` 通过；extension/core 的 `tsc` 仅剩本次修改前已有的测试窄化、IDB 与组件类型错误；ESLint 因根配置依赖的 `@eslint/js` 未安装而无法启动。
- 浏览器验证：Chrome 绑定中没有可访问的问学扩展侧边栏，仅有 CloudBase/后台标签页，因此未用普通网页模拟扩展运行时；普通澄清与登录/验证码接管仍需在已加载扩展的浏览器中各手工触发一次。

## 下一步

- 在可加载扩展的浏览器中分别触发一次普通澄清与一次登录/验证码接管，确认侧栏交互和控制台无新增错误。
- 后续独立清理仓库既有 TypeScript、ESLint 与 Prettier 基线问题，使静态检查可以作为无噪声门禁。
