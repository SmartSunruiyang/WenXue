# 新标签页 NewTabHome 功能基线与统一设计入口

> 2026-09-18：原计划中的独立视觉代码、主题方案和动画实施步骤已被用户批准的 [统一 UIUX](../../context/UIUX.md) 覆盖。本页保留功能与运行时契约，避免旧计划重新引入已废止的视觉要求；历史执行日志不改写。

当前实施计划为 [问学统一 UI 实施计划](2026-09-18-unified-ui.md)，方案见 [统一 UI 设计方案](../specs/2026-09-18-unified-ui-design.md)。NewTabHome 的模块边界以 [ARCHITECTURE](../../context/ARCHITECTURE.md) 为准，视觉与可访问性以 [UIUX §9](../../context/UIUX.md#9-新标签页与-hub) 为准。

## 1. 入口与边界

- `NewTabHome` 是现有插件域 L5 模块，WXT 入口位于 `apps/extension/src/entrypoints/newtab/`。
- 构建产物保留 `newtab.html`，通过 `chrome_url_overrides.newtab` 注册；不重复创建模块或入口。
- 页面装配保留 ErrorBoundary、I18nProvider、品牌区、快捷入口、首次引导、刷新和设置入口。
- 仅使用插件域能力，不实现 Agent 循环、不发送 LLM 请求、不收集 API Key，不通过桌面进程传输用户内容。
- 视觉更新不修改持久化 schema、WXT 注册方式或模块依赖；不为装饰增加依赖。

## 2. 快捷入口契约

`QuickLink` 保留 `id`、`title`、`url`、可选 `icon`。模型仍由 `lib/quickLinks.ts` 提供：

- `normalizeUrl` 接受 HTTP(S) 地址，未写协议时补 HTTPS；空值或无法解析的 URL 无效。
- `normalizeQuickLinks` 校验存储输入，保留合法项，名称去空白且最多 40 字符；缺少 id 时生成 id。
- `addQuickLink`、`updateQuickLink`、`removeQuickLink`、`reorderQuickLinks` 保留原有增删改排序语义，不在展示组件重复实现数据规则。
- 默认入口沿当前产品基线：百度、学习通、必应中国；UI 改造不重置用户已有入口。
- 点击入口导航到真实 URL；图标接受用户保存的 emoji 或图片地址，无图标时使用名称首字。
- 编辑保留名称、URL 和图标字段；新增、编辑、删除、拖拽排序后均通过原存储入口持久化。键盘用户也能访问管理与排序动作。

## 3. 本地持久化与引导

`lib/quickLinksStorage.ts` 继续复用 `ConfigStorageArea`：

- `loadQuickLinks` / `saveQuickLinks` 使用既有 `newtabQuickLinks` 与 `newtabQuickLinksVersion`；既有版本策略保留，不在本轮更改或迁移数据。
- `loadOnboardingDone` / `saveOnboardingDone` 使用 `newtabOnboardingDone`。
- 用户第一次进入可看到四步引导：打开侧边栏、选择模型、在目标网页描述任务、执行中停止或接管。
- 引导可折叠、重新展开；完成状态保存在本机。
- 设置入口通过 `openExtensionOptionsPage` 打开 options 标签页，刷新入口重新加载页面。
- 加载或保存失败提供明确反馈与重试，保留用户正在编辑或尚未保存的内容。

## 4. 呈现与输入

不在本页重复定义字号、颜色、圆角、动画参数或组件实现。页面、菜单、编辑对话框和引导直接遵循统一 UIUX；浅色为当前验收基线。

- 页面结构默认可见且立即可用，不依赖入场完成事件。
- 编辑对话框提供名称焦点、焦点圈定、Escape / 取消、保存校验与焦点恢复。
- 低频入口管理动作保持可达，菜单不被滚动容器裁切；删除确认说明仅移除快捷入口。
- 旧 `newtabMode`、`GlassPortalScene`、`IntroSequence` 仅为历史未挂载实现，不再作为页面要求或验收依据；本文不据此指示删除其文件、依赖或历史测试。

## 5. 验证

- 运行 `quickLinks.test.ts`、`quickLinksStorage.test.ts`，保留数据归一化、CRUD、排序与持久化行为覆盖。
- 构建插件并确认 `chrome_url_overrides.newtab` 指向 `newtab.html`。
- 在 1440 / 1024 / 768 及窄视口验证无页面横向溢出；数量为零、默认数量、多项与长名称时布局可用。
- 验证新增 / 编辑 / 删除 / 拖拽与键盘排序；保存后刷新仍在；设置入口打开正确页面。
- 验证首次引导、收起与重新展开、完成状态持久化、加载 / 保存失败及重试。
- 验证菜单与对话框焦点、Escape、边缘位置、禁用状态及 reduced-motion。
- 类型、lint、构建、相关测试和可视证据写入本轮统一 UI 执行日志；fixture 不代替真实浏览器加载验收。
