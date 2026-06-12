# 侧栏输入区重设计：模型快捷下拉 + 状态灯迁移 + 打字机占位

- **日期**：2026-06-12
- **关联**：插件域 SidepanelApp（PRD F4 / UIUX §6 侧边栏输入区）
- **会话上下文**：用户要求去掉输入框上方分隔线、加宽输入框、输入框底部左侧加模型选择下拉（显示当前模型名）、右上角状态灯移到发送按钮左侧、占位文本改为打字机轮播任务示例。

## 做了什么
- `sidepanel/App.tsx`：
  - footer 去掉 `border-t`，内边距 `p-3` → `px-2 pb-2 pt-1`（输入框加宽）。
  - 输入框改为上下结构：上为 textarea，下为 `InputGroupAddon align="block-end"` 操作行——左 `ModelMenu`、右 `StatusDot` + 发送/停止按钮；头部右上角的 `StatusDot` 移除。
  - 新增 `ModelMenu`：向上弹出菜单，列出内置模型（`BUILT_IN_MODEL_LABEL`）+ 自定义模型（`getCustomModelLabel`）+ 「管理模型」（打开 options 页）；触发钮显示当前模型名（内置→`DEMO_MODEL`，自定义→`model.model`，truncate）；切换走 `configure({...config, selectedModelId})`（saveStoredConfig 已会解析出 llmConfig）；执行中禁用，避免重建 Agent 杀掉运行中任务。
  - 新增 `TaskInput` + `useTypingPlaceholder`：占位文本打字机轮播（打字 90ms/字、停留 2.6s、删除 30ms/字），仅输入框为空时运行，文案 6 条走 i18n（`taskHint1–6`），尊重 `prefers-reduced-motion`（静态显示第一条，呼应 UIUX §8）；隔离在子组件内避免 tick 重渲染整个 App。
  - `LanguageMenuButton` 改名 `MenuRadioItem`（语言菜单与模型菜单共用）。
- `lib/i18n.tsx`：新增 `selectModel` / `manageModels` / `taskHint1–6`（中英），前两条提示文案为用户指定（「在作业页面让 AI 帮你完成」「直接输入你想要 AI 做什么」），其余四条生成（总结网页/填表单/找入口/比价）。
- 文档同步：PRD F4 新增侧栏模型快捷切换需求点；UIUX §6 新增「输入区（底部）」规范行。

## 补充：输入区视觉微调（同日）
- 输入框圆角 `rounded-lg` → `rounded-2xl`（16px）；输入正文 `text-xs` → `text-sm`（14px，符合 UIUX §3 正文档位）。
- 聚焦光晕从上游的蓝紫色（ai-motion 配色）改为中性黑灰（`ui/input-group.tsx`：边框 `foreground/30` + 三层黑色低透明度阴影），呼应品牌「克制黑灰」基调；该原语仅侧栏在用，无外溢影响。
- footer 底部新增居中 10px 灰字「内容由 AI 生成」（i18n `aiDisclaimer`，中英），输入框相应上移；PRD §7.3 增补 AIGC 标识合规条目，UIUX §6 输入区行同步。

## 提交
- 未提交，工作树已有多处未提交改动；本段在现有改动上继续。

## 状态变更
- 架构文档：未变更；全部归属既有插件域 SidepanelApp，复用既有 `lib/modelConfig` / `lib/configStorage` 契约。
- 需求/UI 文档：PRD F4、UIUX §6 已同步（与代码同一工作集）。
- 测试：`pnpm -F extension test` 10/10 通过；`tsc --noEmit` 仅剩 `extensionPages.test.ts` 既有错误（前会话遗留）。
- 构建：`pnpm -F extension build` 成功。
- 视觉验证：静态预览（真实构建 CSS）截图确认——无分隔线、加宽输入框、左下模型名 + 向上弹出菜单（勾选态/分组/管理入口）、右下状态点 + 发送按钮。

## 下一步
- Chrome 重新加载 unpacked extension，实际体验打字机占位与模型切换。
- 既有 `extensionPages.test.ts` 类型错误待其归属会话修复。
