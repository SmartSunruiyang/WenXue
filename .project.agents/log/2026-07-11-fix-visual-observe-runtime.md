# 修复 visual_observe 持久画像截图链路

- **日期**：2026-07-11
- **关联**：`docs/superpowers/specs/2026-07-04-visual-observe-tool-design.md` / `docs/superpowers/plans/2026-07-04-visual-observe-tool.md`
- **会话上下文**：用户实测 `visual_observe` 返回 `screenshot_unavailable` / `Unknown message type`，要求审查全部视觉链路、修复所有可确认问题，并以真实使用链路和复审作为交付门禁。

## 根因

- 仓库当前 `.output/chrome-mv3/background.js` 已包含视觉路由，但持久 CfT 画像仍注册旧版 MV3 service worker；旧 worker 的默认分支返回 `{ error: "Unknown message type" }`。
- 前台截图 RPC 未验证响应契约，把旧 worker 的错误对象当作截图 API 失败，最终误报 `screenshot_unavailable`。
- 原开发命令只启动 desktop，不保证先重建 extension；仅传 `--load-extension` 也不会可靠刷新持久画像中的 unpacked service worker。实际验证表明专用画像需在启动前开启 Developer Mode，随后当前构建才能重新注册。

## 做了什么

- 将 `VISUAL_OBSERVE` 升级为 v2 判别协议：protocol ping 无 target，capture 强制合法 `targetTabId`；v1 明确返回 `protocol_mismatch`。
- sidepanel/hub 初始化以 extension-origin Web Lock 跨 realm 单飞握手；旧 background 最多触发一次 `chrome.runtime.reload()`，失败只降级视觉工具，不阻断 DOM Agent。
- 截图绑定 `TabsController.currentTabId`，目标缺失 fail closed；background 激活指定 tab 后截图，并复核 tab id 与 URL，拒绝 tab 切换/导航 TOCTOU。
- 修复 TabsController 激活失败、tab 删除 replacement 失败、事件 Promise 未处理等状态问题；失败后不会保留已删除的逻辑 tab id。
- 修复视觉模型请求契约：Qwen 强制工具时关闭 thinking，兼容开关正确传给视觉模型，重试仍保持 system→user 顺序；自定义无鉴权端点可用，内置网关缺 session token 时在截图前失败。
- 修复 CloudBase HTTP-200 error envelope、纯文本诊断、HTTP error body AbortError、消息拒绝和旧响应的结构化错误处理。
- 收紧隐私边界：不向视觉供应商额外发送 tab URL/title；schema、数组、字段和总 JSON 有上限；拒绝 data URI/疑似长截图 base64；错误诊断按当前 API key 精确去密。
- 视觉 LLM 请求与响应正文均只记 omitted 概要，防止供应商在 tool arguments 中回显截图后落入 IndexedDB 日志。
- desktop 启动前构建 extension，并为专用画像安全设置 `extensions.ui.developer_mode`；Preferences 使用保留权限的同目录临时文件、fsync、原子 rename，且在需要写入时检查 POSIX `SingletonLock`、Windows `lockfile` 与异机/未知锁。
- BrowserSupervisor 在首个 await 前占用 launching 状态，阻止并发重复 spawn；stop/requestShutdown 可取消尚在画像准备阶段的 pending launch。
- background 消息改为集中式 router，未知消息不再抢占其他 listener，也不再返回误导性的全局 `Unknown message type`。

## 审查闭环

- 使用三路只读复审分别检查行为回归、安全/隐私、性能/并发；主线同时审查协议与测试契约。
- 首轮与后续复审发现的 target fallback、URL/title 外传、截图回灌、响应日志泄漏、并发 reload/spawn、pending launch、stale tab、AbortError、API key 回显、Windows/异机画像锁、Qwen 重试顺序和协议版本谎报均已修复并补回归测试。
- 最终复审结论：协议/回归、安全/隐私、可靠性三个方向均无剩余 P0–P3。

## 验证

- `pnpm -r test`：通过。Extension 46 files / 411 tests；Desktop 15 files / 87 tests；其余 workspace 测试全部通过。
- `pnpm -F extension build`：通过，生成 MV3 v1.9.1 当前产物（构建器仍输出既有 `es2025` target 与 React OXC 建议警告）。
- `pnpm -F desktop build`：通过。
- `pnpm -F desktop exec tsc --noEmit -p tsconfig.node.json` 与 web tsconfig：通过。
- Extension 全量 `tsc --noEmit` 仍被本任务外既有 `cards.tsx`、`HistoryDetail.test.ts`、`LogViewer.tsx`、`misc.test.ts`、`db.ts` 类型错误阻断；本次修改文件无新增类型错误。
- Scoped ESLint 无法启动：仓库现有 `eslint.config.js` 引用未安装的 `@eslint/js`；未为本任务修改依赖。
- `git diff --check` 与视觉/桌面/文档范围 Prettier check：通过。
- 真实 CfT 持久画像 smoke：旧 v1 ping 返回 `protocol_mismatch` 且声明当前 v2；v2 ping 返回 ready；v2 capture 返回 `data:image/jpeg;base64,`，requested tab id 与 captured tab id 相同，URL 为 `https://www.baidu.com/`。
- 根因定位阶段在已有登录 session 的真实 Agent 链中调用 `visual_observe`，成功识别百度搜索首页及“百度一下”控件；最终隔离 smoke 未复制登录 token，只验证协议、service worker、截图与目标 tab 绑定。

## 提交

- 未提交。当前分支为 `codex/visual-observe-tool`；工作树原有 admin、gateway、website、桌面图标及部分视觉功能 WIP 均保留，未回退或覆盖无关改动。

## 状态变更

- ARCHITECTURE：登记 VisualObservation v2、Web Lock 自愈、目标 tab/隐私边界、ProfileStore 安全迁移与 BrowserSupervisor pending launch 契约。
- TECH-INFRA：登记启动参数、构建顺序、unpacked service worker 刷新机制、双平台画像锁、真实截图 smoke 与日志省略策略。
- PRD：既有 `visual_observe` 产品行为不变；本次只修复实现与运行时可靠性，无新增产品范围。
