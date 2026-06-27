# execute_javascript 全覆盖增强 — 设计

- 日期：2026-06-26
- 分支：`codex/extension-js-execution`（worktree，base `main`）
- 状态：设计待评审

## 1. 背景与目标

现有内置工具 `execute_javascript`（[packages/core/src/tools/index.ts](../../../../../packages/core/src/tools/index.ts)）已经实现了"在当前页执行任意 JS"的形态，但有三处局限卡住实际使用：

1. 默认关闭（受 `experimentalScriptExecutionTool` gate，[PageAgentCore.ts:157](../../../../../packages/core/src/PageAgentCore.ts)），LLM 根本看不到它；
2. 返回值用模板字符串插值 `Result: ${result}`，对象/数组退化成 `[object Object]`，结构化结果不可用；
3. 只在顶层 frame 的 isolated world 执行——读不到跨域 iframe 内容，也读不到页面 JS 运行时变量。

目标：把它增强成"DevTools Console 式的万能执行器"，让 LLM 能在当前标签页**任意执行上下文**实时手写 JS 并拿到结构化结果，覆盖四类场景：

| 场景 | 目标 world | 目标 frame |
|---|---|---|
| 动态渲染 / 异步插入的 DOM | isolated | 当前/指定 |
| 同源 iframe 内容 | isolated | 当前（脚本内 `contentDocument`）或指定 frame |
| 跨域 iframe 内容 | isolated | 指定 frame（脚本进该 frame 自己的上下文）|
| 页面 JS 运行时变量 / 框架状态 | main | 当前/指定 |

### 1.1 诚实的能力边界（写入 PRD §7.2）

以下是 Web 平台 / MV3 硬限，本特性**不**承诺突破，遇到时返回明确错误让 LLM 换策略：

- `<iframe sandbox>`（无 `allow-same-origin`）：Chrome 不注入脚本，读不到；
- 严格 CSP（`script-src` 无 `unsafe-eval`）的页面：main world `eval` 被挡，运行时变量读不到（isolated world 的 DOM 读取不受此影响）；
- `chrome://` / Web Store / PDF viewer 等特权页：content script 不注入（现有 `isContentScriptAllowed` 已挡）；
- Canvas / 纯视觉渲染内容：DOM 层读不到（本特性不引入视觉）。

## 2. 决策记录（已与用户对齐）

1. **复用增强** `execute_javascript`，不新增独立工具（避免语义重叠混淆 LLM）。
2. **默认启用**，保留 config 开关可关。
3. **加 `webNavigation` 权限**，用 `chrome.webNavigation.getAllFrames` 实现 frame 发现。
4. 在**独立 worktree** `codex/extension-js-execution`（base `main`）开发，隔离当前 website 线未提交改动。
5. **直接增强 vendor**（`@page-agent/core`、`@page-agent/page-controller`），配套回归测试 + 记录上游偏离。

## 3. 模块归属（对照 ARCHITECTURE.md）

全部落在**现有已登记模块**内，无新增"无处归属"模块（满足 SELF_CONSTRAINTS §B1）。

| 模块 | 层 | 性质 | 本特性改动 |
|---|---|---|---|
| `@page-agent/core` | L4 | vendor | `execute_javascript` 入参 schema 加 `world` / `frame_id`；gate 默认开 |
| `@page-agent/page-controller` | L3 | vendor | `executeJavascript` 返回值改用 `serializeResult`（修 `[object Object]`）|
| `ExtensionEntrypoints` | L6 | 我们的代码 | `allFrames` 注入 + top-frame guard；background 按 `frameId` 路由；main-world 执行通道；`webNavigation` 权限；`RemotePageController` world/frameId 透传 + `listFrames`；`list_frames` customTool |

> `list_frames` 作为 **extension 域 customTool**（经 MultiPageAgent `customTools` 注入，与 tab 工具同模式），不进 core 工具表、不动 `PageController` 接口——frame 编排本就是 MultiPageAgent 层职责。

## 4. 架构与数据流

```
LLM ── action:{ execute_javascript:{ script, world?, frame_id? } }
  │
  ▼  MacroTool.execute 路由
PageAgentCore → tools['execute_javascript'].execute
  │  this.pageController.executeJavascript(script, { world, frameId })
  ▼
RemotePageController (extension, agent 侧)
  │  PAGE_CONTROL { action:'execute_javascript', targetTabId, frameId, payload:[script,{world}] }
  ▼  chrome.runtime.sendMessage
background  handlePageControlMessage
  │  chrome.tabs.sendMessage(tabId, msg, frameId!=null ? {frameId} : undefined)   ← 新增 frame 维度
  ▼
content script（目标 frame 内，allFrames 注入）RemotePageController.content
  │  按 world 分发：
  ├─ isolated → PageController.executeJavascript(script) → eval 实时 document → serializeResult
  └─ main     → postMessage 到本 frame 的 main-world executor → eval → serializeResult → 回传
  ▼
结构化字符串结果 ── 原路 sendResponse ── 作为工具结果回填 LLM
```

`list_frames` 旁路：`RemotePageController.listFrames()` → background → `chrome.webNavigation.getAllFrames({tabId})` → 返回 `[{ frameId, url, origin, sameOriginWithTop, parentFrameId }]`。

### 4.1 world 分发

- **isolated**（默认）：复用现有 content-script `eval`（isolated world 不受页面/扩展 CSP，能 eval 任意字符串）。扩展点：经 `allFrames` 后，每个 frame 都有自己的 content script，可在各自 isolated world 读自己 DOM（含跨域 frame）。
- **main**：新增 main-world executor（unlisted script，复用现有 `injectScript` + `web_accessible_resources: ['main-world.js']` 注入机制 + postMessage 桥接模式）。isolated 侧按需注入 executor 到目标 frame，postMessage 发 script，executor 在 main world `eval` 后回传。

### 4.2 frame 路由

- `content.ts`：`matches:['<all_urls>']` 增加 **`allFrames: true`**。
- **top-frame guard**（关键副作用控制）：`initPageController` 每个 frame 都跑（各管各 frame 的 DOM）；但 `exposeAgentToPage`、`initChaoxingAdapter`（agent 单例 / 超星适配）用 `window.top === window` 包住，只在主 frame 跑，避免子 frame 重复实例化。
- background：`chrome.tabs.sendMessage` 增加可选 `{ frameId }` 精确投递。

## 5. 组件设计

### 5.1 core：`execute_javascript` 工具（packages/core）

- `inputSchema` 增加：`world?: enum('isolated','main')`（默认 `isolated`）、`frame_id?: int`（默认顶层/当前）。
- `execute` 改为 `this.pageController.executeJavascript(input.script, { world: input.world, frameId: input.frame_id })`。
- gate：`PageAgentCore` 构造中将 `if (!experimentalScriptExecutionTool) delete` 改为 `if (experimentalScriptExecutionTool === false) delete`，使默认（`undefined`）= 启用；config 显式传 `false` 仍可关。
- 描述重写为 Console 语义，并提示 world / frame_id 用法 + 先用 `list_frames` 探测。

### 5.2 page-controller：`executeJavascript` + `serializeResult`（packages/page-controller）

- `executeJavascript(script)` 的返回 `message` 改为 `✅ Result: ${serializeResult(result)}`。
- 新增 `serializeResult(value): string`（page-controller 内部函数，命名表意；不是新增模块）：
  - primitive / null / undefined → `String(value)`（undefined → `"undefined"`）；
  - object / array → 安全 `JSON.stringify`：去循环引用（WeakSet）、函数 → `"[Function]"`、DOM 节点 → `<tag id class>` 摘要；
  - `Error` → `name: message`；
  - 截断 ~8KB，超出尾标 `…(truncated, N chars)`。

### 5.3 extension：RemotePageController（apps/extension）

- `executeJavascript(script, { world, frameId })`：把 `world` 进 payload、`frameId` 进消息路由维度。
- 新增 `listFrames(): Promise<FrameInfo[]>` → background `webNavigation.getAllFrames`。

### 5.4 extension：content / background / main-world / manifest

- `RemotePageController.content.ts`：`execute_javascript` 分支按 `world` 分发（isolated 调 `PageController`；main 走 executor）；按需注入 main-world executor。
- `RemotePageController.background.ts` / `background.ts`：透传 `frameId`；新增 `list_frames` → `webNavigation.getAllFrames`（与 `handlePageControlMessage` 平行的处理，参照 `chaoxing/bridge.background.ts`）。
- 新增 main-world executor 脚本（`entrypoints/`，与 `main-world.ts` 同域）；它是独立 eval 通道，与上游 `window.PAGE_AGENT_EXT`（TECH-INFRA #5，默认关）互不影响、不得误开。
- `content.ts`：加 `allFrames: true` + top-frame guard。
- `wxt.config.js`：`permissions` 增加 `webNavigation`。

### 5.5 extension：`list_frames` customTool + MultiPageAgent 注入

- 形如 `createFrameTools(remotePageController)`，返回 `{ list_frames }`，经 `customTools` 注入。
- 输出每个 frame 的 `frameId / url / origin / sameOriginWithTop / parentFrameId`，供 LLM 定向。

## 6. 错误处理（SELF_CONSTRAINTS §B5：仅系统边界防御）

执行类失败一律**返回明确文本**（不 throw，避免主循环把可恢复错误当 task error 中断）：

- main world 被页面 CSP 阻止 → `❌ main world 执行被页面 CSP 阻止，改用 world:'isolated' 读 DOM`；
- 指定 `frame_id` 不存在 / 已失效 → `❌ frame N 不存在，请先用 list_frames 重新获取`；
- 脚本内跨域 `contentDocument` 抛 SecurityError → 由脚本自身 try/catch 处理，工具如实回传错误文本，并由描述引导改用 `frame_id`；
- 执行超时（默认 10s，`Promise.race` + `ctx.signal`）→ `❌ 执行超时（10s）`。边界：同步死循环阻塞单线程，超时也无法打断（描述中告知 LLM 避免写同步死循环）；
- 序列化遇不可序列化值 → 安全降级，不抛；
- 特权页：`isContentScriptAllowed` 维持现有拦截。

## 7. 上游文档同步（SELF_CONSTRAINTS §B3，与实现 commit 同提交）

- **PRD.md**：
  - §7.2 改写跨域 iframe 能力边界（"无法操作" → "可经 `execute_javascript` 在跨域 frame 内执行；sandbox / 严格 CSP 仍受限"）；
  - §3（Agent 循环动作，line 79 区域）补充"任意 JS 执行（含 main world / 跨 frame）"能力 + 安全声明。
- **ARCHITECTURE.md**：`@page-agent/core`、`@page-agent/page-controller`、`ExtensionEntrypoints` 三张模块卡职责描述微调（序列化、frameId 路由、main-world 执行通道、`list_frames`）；依赖图补 `ExtensionEntrypoints → webNavigation`（外部 API）。
- **TECH-INFRA.md**（权限/安全口径）：
  - 权限审计表（改造清单 #4）新增 `webNavigation` 行，记录保留理由（frame 发现，支撑跨 frame JS 执行）——与"权限最小化"基调的权衡需写明；
  - 改造清单 #5 注记：本特性的 main-world executor 是**独立 eval 通道**，**不**启用上游 `window.PAGE_AGENT_EXT`（维持默认关闭）；
  - 记录 `execute_javascript` 由默认关闭改为**默认启用**（保留 `experimentalScriptExecutionTool` 开关）的安全权衡。
- **UPSTREAM.md**：记录 `core` / `page-controller` 本地补丁（schema + gate + serializeResult），标注上游偏离。
- **CONVENTIONS.md**：遵循现有命名/测试约定，无新增约定。

## 8. vendor 偏离与回归测试（不变量 I5）

- core / page-controller 改动属"对 vendor 的本地补丁"，**`pnpm -r test` 必须保持绿**。
- 新增针对性测试：`serializeResult`（各类型 / 循环 / 截断 / DOM / Error）、gate 默认开、`execute_javascript` 新 schema 解析。

## 9. 测试计划

- 单元（vitest，参照 `RemotePageController.test.ts`）：
  - `serializeResult` 全类型矩阵；
  - frame 路由消息格式（带/不带 `frameId`）；
  - world 分发分支；
  - gate 默认启用 / 显式关闭；
  - `list_frames` 输出结构（mock `webNavigation`）。
- 手动验证清单：
  - 同源 iframe 站点：脚本读到 iframe 内文本；
  - 跨域 iframe 站点：`list_frames` → 指定 `frame_id` 读到内容；
  - 严格 CSP 站点：main world 失败且报错友好；
  - `<iframe sandbox>`：如实失败、提示明确。

## 10. 非目标（YAGNI）

- 不引入视觉 / 截图；
- 不做持久脚本 / 固定模板（脚本由 LLM 每步现写）；
- 不突破 sandbox iframe / 严格 CSP（平台硬限）；
- 不做跨 tab JS（仅当前 tab 及其 frames，跨 tab 仍走 tab 工具）。
