# visual_observe 截图观察工具实施计划

关联设计：`../specs/2026-07-04-visual-observe-tool-design.md`

## 任务

- [x] 创建功能分支 `codex/visual-observe-tool`。
- [x] 先写失败测试：工具、background bridge、模型传递、工具注册、日志隐私。
- [x] 新增 `visualObserve.ts`：输入/输出 schema、截图 RPC、视觉模型结构化调用、错误 JSON。
- [x] 新增 `visualObserve.background.ts`：当前活动 tab 可见视口截图。
- [x] 将 `RuntimeAgentModels.vision` 传入 `MultiPageAgent.visualObservationModel`。
- [x] 在 `MultiPageAgent` 注入 `visual_observe` custom tool，不做任何自动触发。
- [x] 在 background service worker 路由 `VISUAL_OBSERVE` 消息。
- [x] 更新 `loggingFetch`，对含 `data:image/` 的请求体只记录省略概要。
- [x] 更新 system prompt、PRD、ARCHITECTURE、TECH-INFRA。
- [x] 运行完整插件测试与构建验证。
- [x] 记录实施日志。
- [x] 修复持久画像复用旧 MV3 service worker：启动前构建、画像 Developer Mode、版本握手与单次 reload。
- [x] 将截图绑定 Agent 逻辑 tab，并在截图后复核 tab id/URL，目标缺失时 fail closed。
- [x] 收紧视觉供应商边界：不发送 tab URL/title，限制并校验输出，视觉请求/响应日志均省略正文。
- [x] 修复并发/错误契约：握手单飞、BrowserSupervisor 启动互斥、AbortError 传播、事件 Promise 收口、CloudBase envelope 诊断。
- [x] 真实 CfT 验证 `VISUAL_OBSERVE` v2 握手、JPEG 截图、target/captured tab 一致。

## 验收标准

- `pnpm -F extension test` 通过。
- `pnpm -F extension build` 通过。
- 代码搜索确认无自动 `pushObservation` 或生命周期自动截图逻辑。
- 任务历史中的视觉信息是工具 JSON 字符串，不包含截图 data URL。
