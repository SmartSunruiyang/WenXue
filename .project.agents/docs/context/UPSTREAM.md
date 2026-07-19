# UPSTREAM — page-agent vendor 记录

> 对应 ARCHITECTURE 不变量 I5。任何对 `packages/@page-agent 四包` 与 `apps/extension` 上游部分的改动，先登记本文再动代码。

## 当前快照

| 项                        | 值                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 上游                      | https://github.com/alibaba/page-agent.git                                                                                            |
| 基准                      | tag `v1.9.0`（2026-06-08 发布）                                                                                                      |
| 上游 commit               | `3a2f0a41ec697896730dc1b81b437e3842ac5e18`                                                                                           |
| 本仓 pristine 导入 commit | `f5131c2`                                                                                                                            |
| 本仓适配补丁 commit       | `2476e12`                                                                                                                            |
| 导入范围                  | packages/{core,llms,page-controller,ui} → packages/\*；packages/extension → apps/extension；LICENSE+NOTICE → third_party/page-agent/ |
| 未导入                    | packages/{page-agent,mcp,website}、scripts/、根配置（root 由本仓自管）                                                               |

## 本地补丁清单（相对 pristine）

| #   | 文件                                                                          | 改动                                                                                  | 原因                                                                                                 |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P1  | apps/extension/package.json                                                   | name → `extension`                                                                    | 对齐 `pnpm -F extension`；应用层 fork 不受 I5 约束                                                   |
| P2  | apps/extension/package.json                                                   | `@page-agent/*` 依赖 → `workspace:*`                                                  | 指向本仓 vendor 包                                                                                   |
| P3  | apps/extension/package.json                                                   | +devDep `zod@^4.4.3`                                                                  | peer 依赖在 pnpm 隔离下无提升来源                                                                    |
| P4  | packages/llms/package.json                                                    | +devDep `vitest@^4.1.8`                                                               | 同上，test 脚本所需                                                                                  |
| P5  | 根 package.json                                                               | `pnpm.overrides: { "wxt>vite": "^6.3.4" }`                                            | WXT 0.20.26 的 download 插件用 Vite 6+ hook filter 语法，Vite 5 不支持导致 wxt build 失败            |
| P6  | apps/extension/package.json                                                   | +script `"build": "wxt build"`                                                        | 对齐根 `pnpm -r build` 聚合脚本                                                                      |
| P7  | packages/{core,llms,page-controller,ui}/package.json                          | +devDep `vite@^8.0.16`                                                                | 各包 `build` 脚本直接执行 `vite build`；pnpm 隔离下必须显式声明 CLI 与 config import                 |
| P8  | packages/{core,llms,page-controller,ui}/package.json                          | +devDep `unplugin-dts@^1.0.2`                                                         | 各包 `vite.config.js` 直接 import `unplugin-dts/vite`                                                |
| P9  | packages/{core,page-controller,ui}/package.json                               | +devDep `vite-plugin-css-injected-by-js@^5.0.1`                                       | 对齐各包 `vite.config.js` 的 CSS 注入插件 import                                                     |
| P10 | packages/{page-controller,ui}/package.json                                    | +devDep `chalk@^5.6.2`                                                                | 对齐各包 `vite.config.js` 的构建日志 import                                                          |
| P11 | packages/page-controller/src/mask/{SimulatorMask.ts,SimulatorMask.module.css} | 页面遮罩边框由 ai-motion WebGL 跑马灯替换为自绘流体玻璃（Liquid Glass）CSS 边框       | 问学品牌动效（UIUX §5）；纯 CSS 实现，去除 WebGL2 依赖                                               |
| P12 | packages/page-controller/package.json                                         | 移除 dependency `ai-motion`                                                           | P11 后该包无引用（原唯一运行时依赖）                                                                 |
| P13 | packages/page-controller/src/{PageController.ts,assessmentSafety.ts}          | 在通用 click/input 边界拒绝题目最终提交、交卷与受保护答案控件，并保留普通题目控件操作 | QuestionSolver 之外的通用 PageController 也必须 fail closed；避免其他 Agent 工具绕过人工最终提交边界 |

## 已知差异与遗留

- 上游 `wxt.config.js` 保留其官方 manifest `key`：未打包加载与商店版 PageAgent 共享扩展 ID，**两者不可同时安装**；M4 更换为问学自有 key。
- 上游根 `overrides`（uuid、web-ext-run>tmp）未引入；install/audit 出问题时按需补 `pnpm.overrides` 并在此登记。
- P5 新增 `pnpm.overrides: { "wxt>vite": "^6.3.4" }`：WXT 0.20.26 的 `download` 插件 `{ filter, handler }` hook 语法需 Vite 6+，否则 handler 对所有模块调用 `fetch(filePath)` 报错。
- lib 四包的 `prepublishOnly`/`postpublish` 脚本在本仓为惰性脚本（源码直出，不发布）；`build` 脚本保留并补齐本地工具链依赖，用于根 `pnpm -r build` 门禁。

## 手动同步流程（升级上游时）

1. `git clone --depth 1 --branch <新tag> https://github.com/alibaba/page-agent.git /tmp/pa-new`
2. 逐包 `diff -ruN <本仓包目录> /tmp/pa-new/packages/<包>`，剔除 P1–P4 与 M4 品牌化改动后评审 diff；
3. 挑拣合入（不整目录覆盖），重跑本计划 Task 5 验证；
4. 更新本文快照表与补丁清单，commit message 注明新旧 tag。

## Local patch: resumable manual takeover

- Scope: `packages/core`, `packages/ui`
- Reason: WenXue removes user-facing step limits and adds recoverable human takeover for login, captcha, permission, unavailable pages, and stuck repeated actions.
- Upstream sync note: keep the patch isolated to public types, PageAgentCore loop control, tools, and prompts so future alibaba/page-agent syncs can diff it cleanly.
- UI adapter note: `packages/ui` now recognizes waiting/paused statuses and supplies the legacy Panel takeover/resume controls.

## Local patch: conversational continuation + history compaction

- Scope: `packages/core`
- 内容：`followUp()` 续接、`restoreConversation()` 历史恢复、`user_message` / `summary` 事件与压缩配置、`#assembleUserPrompt` 历史投影、token 触发 LLM 摘要 + 机械降级、`recall_steps` 工具、硬阈值 FIFO 淘汰、system prompt 增 `<summary>` / `<user_message>` / `recall_steps` 说明。
- Upstream sync note: 隔离在 public types、PageAgentCore loop control、tools 与 prompts，便于对 alibaba/page-agent diff；应用层 `apps/extension` 只负责 Sidepanel 续接路由、IndexedDB 会话 upsert、近溢出横幅与 MultiPageAgent 配置透传。

## Local patch: execute_javascript full-context execution

- Scope: `packages/core`, `packages/page-controller`, `apps/extension`
- 内容：`@page-agent/core` 将 `execute_javascript` 改为默认启用（仅 `experimentalScriptExecutionTool === false` 时关闭），工具 schema 增加 `world: 'isolated' | 'main'` 与 `frame_id`；`@page-agent/page-controller` 新增零依赖 `serializeResult`，修复对象结果显示为 `[object Object]`，并允许 `executeJavascript(script, options?)` 签名供 extension 透传；`apps/extension` 增加 allFrames content script、background `frameId` 路由、`webNavigation.getAllFrames`、main-world executor postMessage 桥接、`RemotePageController.listFrames()` 与 `list_frames` customTool。
- 配套测试：`PageAgentCore` 覆盖默认开关与 schema 解析；`serializeResult` 覆盖基础类型、循环引用、函数、DOM、Error 与截断；extension 覆盖 `RemotePageController` payload、background frame 路由/list_frames、content world 分发/超时、`frameTools` 输出与 `MultiPageAgent` 注入。
- Upstream sync note: vendor 侧改动集中在公开工具 schema、公开/准公开 PageController 执行入口和独立序列化函数；extension 侧为 WenXue runtime 能力扩展。未来升级 alibaba/page-agent 时优先保留测试作为偏离哨兵，再逐项评估上游是否已提供等价能力。

## Local patch: automatic named tool_choice compatibility

- Scope: `packages/llms`, `apps/extension`
- 内容：当实际发送的 named `tool_choice` 被兼容端点以明确的 400/422 类型或格式错误拒绝时，`OpenAIClient` 自动记忆当前配置并以 `required` 重建一次请求；公开错误识别与能力标记函数供视觉观察、学习通直连请求复用。应用层按规范化 endpoint + model 将兼容结论保存为版本化、30 天 TTL 的本地记录，普通用户不再配置协议开关。
- 配套测试：覆盖 named→required、无关/思考模式错误不学习、CloudBase 逻辑错误 envelope、endpoint/model 隔离、TTL/无效记录裁剪，以及视觉观察和学习通直连路径。
- Upstream sync note：vendor 改动集中在 `LLMConfig` 的可选能力回调 / 动态读取器、`OpenAIClient` 单次降级和独立识别函数；升级上游时保留应用层存储契约，并评估上游是否已有等价的 tool-choice capability negotiation。

## Local patch: stable clarification and protected-action takeover routing

- Scope: `packages/core`, `apps/extension`
- 内容：收紧 `ask_user` schema、工具说明与提示词，只用于页面无法确定的必要用户信息或歧义选项；登录、验证码、滑块、2FA、权限等受保护动作立即进入 `request_user_takeover`。Sidepanel 绑定 `onAskUser`，用独立可取消控制器把回答返回原工具调用，并保留既有人工接管提示与暂停/恢复链路。
- 配套测试：覆盖两类工具的动态可用性与提示词隔离、`ask_user` 工具输出和 AbortSignal、回答一次性结算、重复问题覆盖、stop 清理、Hub 禁用、侧栏运行态输入解锁，以及登录/验证码接管提示。
- Upstream sync note：vendor 改动仅位于 `packages/core/src/tools/index.ts`、两份 system prompt 同步内容及 `PageAgentCore` 测试；升级上游时应保留工具动态裁剪测试，避免不可用工具名残留在 prompt/schema 中。

## Local patch: protected assessment action guard

- Scope: `packages/page-controller`
- 内容：新增零依赖 `assessmentSafety` 判定，并在 `PageController.click()` / `inputText()` 的最终 DOM 动作前拒绝最终提交、交卷及答案泄漏型受保护控件；QuestionSolver 自身仍使用更严格的 snapshot/verify/restore 与 no-submit adapter 契约。
- 配套测试：`assessmentSafety.test.ts` 覆盖最终提交/交卷、受保护答案字段与普通题目控件；`PageController` 既有测试继续覆盖正常 click/input。
- Upstream sync note：升级 alibaba/page-agent 时保留该边界测试；若上游提供等价的受保护评估动作策略，再用上游公开策略替换本补丁。
