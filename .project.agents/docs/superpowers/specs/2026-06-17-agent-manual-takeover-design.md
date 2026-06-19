# Agent Manual Takeover Spec

> 派生设计文档。上游行为依据：`PRD.md` §5 F3、§7.2、§7.3；架构边界依据：
> `ARCHITECTURE.md` §1.3、§2.2、§3；交互依据：`UIUX.md` §6。

## 1. 目标

将当前 PageAgent 的“最大步数”执行预算改为“无固定步数 + 人工接管 + 卡住检测”的协作模式。
用户不再感知或配置步骤数上限。Agent 在登录、验证码、权限确认、页面不可操作或连续重复操作时，
主动停在一个可恢复的人工接管点，由用户完成关键动作后继续同一任务。

## 2. 非目标

- 不实现验证码、滑块、反作弊、指纹伪装或任何绕过机制。
- 不增加隐藏熔断器、最大运行时间、最大 token 或最大调用次数。
- 不引入桌面域与插件域通信；仍保持 Demo 阶段 I3。
- 不改变 LLM 供应商接入边界；插件域仍只通过 OpenAI-compatible HTTP 调用模型。
- 不把用户登录态、验证码内容、API Key 或对话内容传给桌面进程。

## 3. 用户体验

### 3.1 登录 / 验证码 / 权限确认

当 Agent 判断需要用户本人操作时，侧边栏在当前对话流末尾展示人工接管提示：

- 标题：`需要你完成一步`
- 原因：`登录`、`验证码`、`权限确认`、`页面不可操作` 或 `其他`
- 当前目标：来自 Agent 的 `next_goal` 或工具入参中的 `goal`
- 说明：告诉用户在网页里完成操作后再回到侧边栏
- 主按钮：`已完成，继续`
- 次按钮：`暂停`

点击 `已完成，继续` 后，Agent 记录一条系统观察：
`User completed manual takeover. Re-observe the page and continue from the current task.`
随后重新观察页面并继续同一任务。

点击 `暂停` 后，任务进入 `paused` 状态。侧边栏保留当前任务、历史和人工接管卡片，并展示
`继续` 按钮。用户点击 `继续` 后，Agent 记录一条系统观察并从同一历史上下文继续。

### 3.2 模型原地打转

当 Agent 连续 3 次执行相同动作签名时，侧边栏展示卡住提示：

- 标题：`模型可能遇到无法解决的问题`
- 说明：`它连续尝试了 3 次相同操作，可能需要你暂时接管页面。`
- 它想完成：最近一步的 `reflection.next_goal`
- 它卡在：最近一步的 `action.name`、精简后的 `action.input` 与 `action.output`
- 主按钮：`我已接管，继续`
- 次按钮：`暂停`

点击主按钮后，Agent 重新观察当前页面并继续。点击次按钮后，进入 `paused` 状态。

## 4. 状态模型

`AgentStatus` 从当前：

```ts
type AgentStatus = 'idle' | 'running' | 'completed' | 'error'
```

扩展为：

```ts
type AgentStatus = 'idle' | 'running' | 'waiting_for_user' | 'paused' | 'completed' | 'error'
```

状态含义：

| 状态               | 含义                                         | 是否允许新任务 | 是否保留上下文 |
| ------------------ | -------------------------------------------- | -------------- | -------------- |
| `idle`             | 无任务                                       | 是             | 否             |
| `running`          | Agent 正在观察、思考或执行工具               | 否             | 是             |
| `waiting_for_user` | Agent 等待用户在网页中完成接管动作           | 否             | 是             |
| `paused`           | 用户选择稍后继续，执行循环已退出但上下文保留 | 否             | 是             |
| `completed`        | 任务完成                                     | 是             | 是             |
| `error`            | 任务出错或用户手动停止                       | 是             | 是             |

`paused` 与 `error` 不同：`paused` 可以通过 `resume()` 继续；`error` 只能新建任务或重新运行。

## 5. 事件与类型

新增人工接管请求类型：

```ts
export type UserTakeoverReason =
	| 'login'
	| 'captcha'
	| 'permission'
	| 'page_unavailable'
	| 'stuck'
	| 'other'

export interface UserTakeoverRequest {
	id: string
	reason: UserTakeoverReason
	title: string
	message: string
	goal?: string
	lastAction?: {
		name: string
		input: unknown
		output: string
	}
}

export type UserTakeoverResolution = 'completed' | 'paused'
```

扩展历史事件：

```ts
export interface UserTakeoverEvent {
	type: 'user_takeover'
	request: UserTakeoverRequest
	status: 'waiting' | 'completed' | 'paused'
}
```

扩展活动事件：

```ts
export type AgentActivity =
	| { type: 'thinking' }
	| { type: 'executing'; tool: string; input: unknown }
	| { type: 'executed'; tool: string; input: unknown; output: string; duration: number }
	| { type: 'retrying'; attempt: number; maxAttempts: number }
	| { type: 'waiting_for_user'; request: UserTakeoverRequest }
	| { type: 'error'; message: string }
```

## 6. Core 行为

### 6.1 删除最大步数

删除 `AgentConfig.maxSteps`、设置页最大步数输入、`Step X of Y max possible steps` prompt、
剩余步数观察提示、`Step count exceeded maximum limit` 终止分支，以及 system prompt 中
`max_steps` 相关规则。

保留步骤编号作为历史展示与调试用途，但不再表达“上限”。

### 6.2 人工接管工具

新增工具 `request_user_takeover`，供 LLM 主动请求用户接管：

```ts
tools.set(
	'request_user_takeover',
	tool({
		description:
			'Ask the user to manually handle login, captcha, permission dialogs, unavailable page areas, or other browser actions that must not be automated.',
		inputSchema: z.object({
			reason: z.enum(['login', 'captcha', 'permission', 'page_unavailable', 'other']),
			title: z.string(),
			message: z.string(),
			goal: z.string().optional(),
		}),
		execute: async function (this: PageAgentCore, input, { signal }) {
			const resolution = await this.requestUserTakeover(input, { signal })
			return resolution === 'completed'
				? 'User completed manual takeover. Continue by re-observing the page.'
				: 'User paused the task. Stop execution and keep context for resume.'
		},
	}),
)
```

该工具按宿主能力动态门控：只有宿主配置了 `onUserTakeover` 回调时才加入工具集合并写入
system prompt；未提供回调的 Hub 等宿主不会向模型暴露一个无法结算的接管能力。问学侧边栏启用该
能力，其他入口必须显式决定是否提供接管交互。

如果工具返回 `paused`，Core 结束当前 `execute()`，状态置为 `paused`，并返回暂停结果。
如果工具返回 `completed`，Core 继续下一轮循环。

### 6.3 可恢复暂停

新增 `resume()`：

```ts
resume(): Promise<ExecutionResult>
```

规则：

- 只有 `paused` 状态允许调用 `resume()`。
- `resume()` 不清空 `task`、`taskId`、`history` 或内部状态。
- `resume()` 在下一轮开始前注入 observation，告诉模型用户已接管并可能修改页面。
- `resume()` 复用原任务的 LLM 配置、工具集合与页面控制器。

## 7. 卡住检测

卡住检测在插件应用层执行，归属 `MultiPageAgent`，不放进 `@page-agent/core` 的通用循环。
原因：重复动作阈值与 UI 接管策略是问学产品行为，不是上游 PageAgent 的通用能力。

每一步结束后从最近一步生成动作签名：

```ts
interface ActionSignature {
	url: string
	name: string
	input: string
	output: string
}
```

生成规则：

- `url` 使用当前页面 URL，去掉 hash。
- `name` 使用工具名。
- `input` 使用稳定 JSON：对象 key 排序，长字符串截断到 160 字符。
- `output` 截断到 240 字符。
- `done`、`ask_user`、`request_user_takeover` 不参与重复检测。

如果连续 3 次签名相同，`MultiPageAgent` 调用 `agent.requestUserTakeover()`，reason 为 `stuck`。

## 8. 文档影响

实施时同步更新：

- `PRD.md`：F3 增加可恢复人工接管、去除最大步数作为用户能力。
- `UIUX.md`：移除 options 高级区的最大步数描述；细化人工接管卡片。
- `ARCHITECTURE.md`：更新 `@page-agent/core`、`MultiPageAgent`、`SidepanelApp` 的关键类型与职责。
- `UPSTREAM.md`：登记 vendor `@page-agent/core` 本地补丁。

外部入口必须把 `ExecutionResult.state` 原样透出：content page API 的 execute/resume 返回
`completed`、`paused` 或 `error`；Hub execute 响应同样携带 `state`。若某入口没有可用的人工
接管交互协议，则不启用 `onUserTakeover`，也不额外虚构 resume 消息。

## 9. 验收标准

- 设置页不再显示“最大步数”。
- Agent prompt 不再包含最大步数或剩余步数。
- 遇到登录/验证码类页面时，模型可调用人工接管工具，侧边栏出现接管卡片。
- 点击 `已完成，继续` 后，Agent 继续原任务并保留历史。
- 点击 `暂停` 后，任务状态为 `paused`，历史仍可见。
- 点击暂停后的 `继续` 后，Agent 继续原任务，不重置历史。
- 连续 3 次重复同一动作后，系统展示卡住接管卡片，包含目标与卡住动作。
- `stop()` 仍表示用户终止任务，进入不可恢复的 `error`/已停止展示，不与 `paused` 混淆。
