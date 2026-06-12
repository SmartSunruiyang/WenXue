# 插件设置页与三点菜单改造

- **日期**：2026-06-12
- **关联**：PRD F4 / ARCHITECTURE SidepanelApp + ExtensionEntrypoints / UIUX 侧边栏与 options 设置页
- **会话上下文**：接手时工作区已有未提交的桌面、品牌资产、插件本地化等改动；用户确认允许在现有改动上继续，并允许初始化 CodeGraph。

## 做了什么

- 初始化 CodeGraph，并在根 `.gitignore` 忽略 `.codegraph/` 本地索引目录。
- 将侧边栏右上角设置齿轮改为三点更多菜单，菜单包含设置入口与语言快捷入口。
- 新增扩展 `options` 页面，左侧按账户与连接 / 模型 / 语言 / 高级 / 关于分类，右侧复用完整设置表单。
- 抽出 `SettingsForm` 复用原 `ConfigPanel` 的全部设置项；`ConfigPanel` 保留为薄包装。
- 抽出 `configStorage`，让 sidepanel 与 options 页面共享 ModelConfig 读写、默认值初始化与 legacy endpoint 迁移逻辑。
- 为 extension 增加 vitest 测试脚本、配置与配置存储单测。
- 同步更新 PRD / ARCHITECTURE / UIUX 中与 options 设置页、三点菜单、ModelConfig 字段相关的描述。
- 修复三点菜单「设置」无法跳转：从仅调用 `chrome.runtime.openOptionsPage()` 改为直接 `chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })` 打开扩展设置标签页，并补充跳转 helper 单测。
- 按用户反馈移除 options 设置页保存按钮，改为字段变更后延迟自动保存；初次加载配置不会误写默认值。
- 按用户反馈隐藏问学 Hub 入口；保留用户认证令牌，并将说明改为「用于订阅和用量管理」。
- 将模型设置改为「默认模型下拉 + 自定义模型列表」：内置默认模型为 `qwen3.5-plus`；自定义模型通过加号弹窗添加，厂商预设先含 DeepSeek 与千问，选择厂商自动填 URL。
- 为每个自定义模型单独保存 API Key；新增 `modelConfig` / `settingsConfig` 纯配置层，将 `selectedModelId + customModels[]` 解析为 Agent 当前运行时 `llmConfig`。
- 添加模型弹窗使用缩放/淡入淡出动效，关闭时延迟卸载以呈现收回动画；添加成功后新模型自动成为当前默认模型。
- 按用户反馈移除设置页所有浏览器原生 `<select>/<option>`：新增问学自绘 `MagicSelect`，用于默认模型、厂商、界面语言、回复语言；打开/收回、选中项与触发器均有轻量“神奇效果”。
- 将 options 左侧分类选项卡从通用 Button variant 改为自绘按钮，增加选中/悬停高亮、顶部光线与小光点过渡。
- 厂商选择最下方新增「自定义厂商」；选中后用户可填写厂商名称与 URL，自定义模型会持久化 `providerName`。
- 厂商下拉与自定义模型列表展示厂商标识；MagicSelect 修复 hover 其他选项时当前选中项仍保持高亮的问题。

## 提交

- 未提交，工作树状态：本会话开始前已有多项未提交改动；本次改动在用户许可下叠加，等待统一整理提交。

## 状态变更

- 架构文档：更新 ModelConfig 字段、ExtensionSettingsConfig 模块、SidepanelApp 职责、ExtensionEntrypoints 入口职责、ModelConfig 写入方。
- 需求/UI 文档：更新 F4 自定义模型列表、自定义厂商、独立 API Key、令牌说明、Hub 入口隐藏与插件 options 设置页规范。
- 测试：
  - `pnpm -F extension test` 通过（3 files / 11 tests）。
  - `pnpm -F extension test -- settingsConfig configStorage` 通过（9 tests）。
  - `pnpm -F extension build` 通过；构建产物包含 `options.html`，manifest 输出 `options_ui.open_in_tab: true`。
  - `pnpm exec prettier --check ...` 通过。
  - Playwright 加载 `.output/chrome-mv3` 真实扩展上下文，打开 `options.html`，经自绘 `MagicSelect` 打开默认模型/厂商下拉，选择千问并添加自定义模型后验证：默认模型下拉出现「千问 · qwen-plus」，`customModels[0].apiKey` 独立保存，`llmConfig` 切换到该模型。
  - Playwright 再次验证厂商下拉：hover 千问时 DeepSeek 的 `data-selected-highlighted` 为 `false`；选择「自定义厂商」后填写 Moonshot，验证默认模型下拉出现「Moonshot · moonshot-v1」，并持久化 `provider: custom` / `providerName: Moonshot`。
  - `rg "<select|</select>|<option|</option>" apps/extension/src` 无匹配，设置页源码不再使用原生选择控件。
  - 构建仍打印既有 WXT/Vite/esbuild warning（`module.register()` deprecation、React OXC 建议、`es2025` target warning），但退出码为 0。

## 下一步

- 在实际加载扩展的浏览器里手动点测三点菜单、语言切换、设置跳转、自定义模型添加/删除/默认选择与自动保存。
- 统一整理现有未提交改动的提交范围，避免把桌面/品牌资源改动与本次设置页改造混在同一个提交中。
