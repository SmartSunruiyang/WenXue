# 完成 Agent 人工接管与暂停继续

- **日期**：2026-06-20
- **关联**：`2026-06-17-agent-manual-takeover-design.md` /
  `2026-06-17-agent-manual-takeover.md`
- **分支**：`codex/agent-manual-takeover`

## 做了什么

- 删除用户设置、Core 配置、prompt 和循环中的最大步数概念；步骤编号仅用于历史与调试。
- 在 Core 增加 `waiting_for_user`、`paused`、人工接管历史事件和保留上下文的 `resume()`。
- 仅在宿主提供 `onUserTakeover` 时向模型开放 `request_user_takeover`，避免无 UI 宿主悬挂。
- 在问学侧边栏增加登录、验证码、权限、不可操作页面和模型卡住的人工接管卡片。
- 连续 3 次相同动作签名触发 `stuck` 接管，并展示当前目标、工具输入和输出。
- 暂停不清空任务、历史或页面状态；停止仍是不可恢复的终止。
- content page API 增加 `resume()`；Hub result 透出 `state`；legacy Panel 兼容等待、暂停与恢复。

## 提交

- `f74c469` docs: document agent manual takeover
- `3d77708` refactor(ext): remove step limit setting
- `c63c1b0` fix(ext): remove step limit wording
- `8f97962` fix(vendor): preserve core config snapshot
- `15d726c` test(vendor): remove step limit residue
- `17459d9` feat(vendor): add resumable takeover protocol
- `61a7e3a` fix(vendor): close paused task state gaps
- `89987b1` fix(vendor): settle takeover before resume
- `d8eaf36` fix(vendor): harden takeover lifecycle
- `826db3c` fix(vendor): finalize takeover cancellation
- `ac57e36` feat(vendor): add LLM manual takeover tool
- `01be733` fix(vendor): gate manual takeover capability
- `d9979ea` fix(vendor): gate user interaction tools
- `bf22ae2` feat(ext): detect repeated agent actions
- `96a172d` fix(ext): harden stuck action takeover guard
- `c78abef` feat(ext): add manual takeover controls
- `2cafea9` fix(ext): harden manual takeover session guards
- `9f27a72` fix(ext): await agent replacement during configure
- `4f3b506` feat(ext): expose paused task state externally

## 验证

- Core focused：`25/25` 通过。
- Extension focused：`83/83` 通过。
- 全 workspace 测试：
  - desktop：`34/34`
  - extension：`113/113`
  - core：`25/25`
  - llms：`58/58`
  - 合计：`230/230`
- 六个 workspace 构建通过：desktop、extension、core、llms、page-controller、ui。
- `packages/ui` TypeScript `--noEmit` 通过。
- `rg` 检查生产代码和权威文档中无 `maxSteps`、`max_steps`、`最大步数` 等残留。
- 420 × 720 侧栏组件走查通过：
  - 接管等待卡显示目标、卡住动作、输入与输出。
  - 点击「暂停」后上下文保留并出现「继续」。
  - 点击「继续」后历史仍在，流程进入重新观察。
  - 点击「我已接管，继续」后进入完成接管提示。
  - QA 页面无自身 console warning/error。

## 环境说明

- 当前运行时为 Node `v26.1.0`，项目约定为 Node 22 LTS。标准 `pnpm -r test` /
  `pnpm -F <vendor-package> build` 在此环境触发 `fetch failed`，因此使用各 workspace 已安装的
  本地 Vitest、Vite、WXT 和 electron-vite 二进制执行等价验证。
- Vendor Vite 构建会提示缺少 `@microsoft/api-extractor`，声明文件已生成，但跳过声明 bundle；
  命令仍以 0 退出。WXT 在 Node 26 下还会提示 `es2025` target 警告，扩展产物正常生成。

## 仍需真实环境验收

- 使用真实模型密钥确认模型在登录、验证码、权限弹窗等页面主动选择接管工具。
- 确认用户完成真实网页操作后，页面重新观察能识别新的登录态或权限状态。
- 覆盖跨域 iframe、canvas 和 MV3 service worker 生命周期中的暂停/恢复。
