# visual_observe 截图观察工具设计

## 背景

问学 Agent 主要依赖 DOM 文本化理解页面，但 Canvas、图片题、复杂控件、弹窗遮挡或动态 UI 状态可能无法从 DOM 快照中可靠判断。需要一个由主 Agent 自主调用的视觉观察工具，在关键节点获得当前可见视口的结构化视觉信息。

## 目标

- 新增插件域 `visual_observe` 工具，由主 Agent 自主决定调用时机。
- 截取 Agent 当前管理 tab 的当前可见视口，不做长截图或元素裁剪；没有受管 tab 时 fail closed。
- 使用配置的视觉模型返回 schema 校验后的 JSON，不转写自然语言摘要。
- 支持观察、确认、审计三种用途：`observe | confirm | audit`。
- 图片本体只在单次工具调用内存中存在，不写历史、IndexedDB、插件日志或桌面日志。

## 非目标

- 不做自动触发；不在 `onBeforeTask` / `onBeforeStep` / `onAfterStep` 中主动截图。
- 不输出 DOM index、点击坐标或动作命令。
- 不绕过登录、验证码、权限确认、特权页、sandbox 或页面安全限制。
- 不改 `packages/llms` 的通用 `Message.content` 类型。

## 架构

`VisualObservation` 属于插件域 L5，由 `MultiPageAgent` 注入为 custom tool：

- `MultiPageAgent` 负责把 `visual_observe` 放入 PageAgentCore 工具集。
- `ExtensionSettingsConfig` / `runtimeModelConfig` 负责解析顶层 `vision` 模型配置。
- `visualObserve.background.ts` 负责在 background 中调用 `chrome.tabs.captureVisibleTab`。
- `visualObserve.ts` 负责 schema、截图 RPC、OpenAI-compatible 多模态结构化调用和错误 JSON。
- sidepanel/hub 初始化以 `VISUAL_OBSERVE` v2 握手确认当前 service worker；用 extension-origin Web Lock 跨 realm 单飞 reload 一次，仍失败仅降级视觉能力。v2 capture 强制 targetTabId，旧 v1 明确触发不兼容自愈。
- `Logging` 对含 `image_url` data URI 的 LLM 请求体只记录省略概要。

桌面域不参与截图或 Agent 控制，维持 I3。

## 工具接口

输入：

```json
{
	"purpose": "observe | confirm | audit",
	"reason": "string",
	"target": "string?",
	"checks": ["string?"]
}
```

输出为 JSON 字符串，成功时包含：

```json
{
	"pageType": "string",
	"visibleRegion": "string",
	"controls": [
		{
			"label": "string",
			"role": "button | input | link | checkbox | select | modal | other",
			"state": "enabled | disabled | selected | focused | unknown",
			"position": "top-left | top | top-right | center | bottom-left | bottom | bottom-right | unknown",
			"purpose": "string"
		}
	],
	"blockingElements": ["string"],
	"checks": [
		{
			"question": "string",
			"answer": "yes | no | unknown",
			"evidence": "string",
			"confidence": "high | medium | low"
		}
	],
	"visualWarnings": ["string"],
	"recommendedNextObservation": "none | scroll | wait | inspect_dom | ask_user",
	"confidence": "high | medium | low"
}
```

失败时返回同样可解析的 JSON，并附加：

```json
{
	"error": {
		"code": "vision_model_unavailable | screenshot_unavailable | extension_runtime_outdated | vision_observation_failed",
		"message": "string",
		"recommendedNextObservation": "inspect_dom | ask_user | wait | scroll | none"
	}
}
```

## 隐私与日志

- 截图 data URL 不写入任务历史，历史只记录工具返回 JSON。
- 视觉请求不携带 tab URL/title；截图后复核 tab id 与 URL 未切换。
- 内置视觉网关缺少 session token 时在截图前失败；自定义/local 无鉴权视觉端点仍允许调用。
- 视觉输出限制字段/数组/总 JSON 大小，拒绝任意 `data:image/` 或长 base64 回灌。
- LLM fetch 日志发现请求体中存在 `data:image/` 时，请求与响应正文均不记录，只保留 omitted 概要。
- Authorization、Bearer、access token、refresh token 和自定义 API Key 仍走既有脱敏规则。

## 测试与验收

- 单测 `visualObserve.ts`：结构化输出、可选 token、截图失败、旧协议自愈、并发单飞、AbortError、供应商错误 envelope、输出不含/不接受 `data:image`。
- 单测 `visualObserve.background.ts`：协议版本、目标 tab 截图、无 active tab、截图 API 抛错、截图期间 tab/URL 切换。
- 回归测试：`RuntimeAgentModels.vision`、`useAgent` 模型传递、`MultiPageAgent` 注册工具、`loggingFetch` 图片请求体省略。
- 手动验收：从专用持久画像启动 CfT，以 CDP 确认协议版本、JPEG data URL 与 requested/captured tab id 一致；再在已登录环境让主 Agent 主动调用 `visual_observe`，确认任务历史只含 JSON。
