# 问学启动器 UI/UX 生成提示词

将下面提示词交给 UI 生成器、设计 Agent 或前端 Agent 使用，用于生成“问学 WenXue 桌面启动器”的重构 UI。

```text
你是一名资深产品设计师和前端 UI 设计师。请为“问学 WenXue”设计一个 Electron 桌面启动器 UI。输出高保真 UI 方案，优先可落地到 React + Tailwind CSS + shadcn token 体系。

背景：
问学是一个桌面应用。它启动一个预装了问学 AI 助手插件的 Chrome for Testing 浏览器。用户之后在浏览器侧边栏里用自然语言让 Agent 操作网页。桌面启动器本身不是营销页，也不是完整管理后台；Demo 阶段只负责启动、聚焦、监控这个浏览器实例，并向用户解释第一次使用的下一步。

重要限制：
- 当前不支持多开。不要设计“多个浏览器实例”“profile 列表”“实例管理”“并行窗口管理”等功能。
- 桌面端与插件端没有运行时通信。不要在启动器里设计聊天、API Key 输入、模型编辑、任务历史详情。
- API Key 和模型配置属于插件 options 设置页，启动器只能提供说明或入口提示。
- 启动器是小窗控制台，不要做 landing page，不要做大 hero，不要营销化。

现有品牌与设计语言：
- 品牌名：问学 WenXue。
- Slogan：ask for everything。
- 品牌气质：克制、学术、工具感、用户在场、过程可见。
- 当前 extension 使用黑白灰为主的 shadcn/Tailwind token 体系：background、foreground、card、popover、primary、muted、accent、border、input、ring、destructive。
- 主色是中性黑白灰。彩色只用于状态、provider 标识、运行态边缘流光，不做大面积渐变背景。
- 字体使用系统栈：system-ui, PingFang SC, Microsoft YaHei；版本号、日志路径使用 ui-monospace。
- 使用现有黑白 logo/字标资产；浅色和深色模式分别适配。不要重新发明吉祥物或插画。
- 形状：rounded-md / rounded-lg 为主；少量大圆角可用于主要输入或提示区域。避免卡片套卡片。
- 图标：使用 lucide-react 图标。启动、聚焦、日志、帮助、设置、完成、错误等动作优先用图标辅助。
- 动效：安静克制。状态切换 150-200ms；运行中可有轻量“问学流体玻璃”边缘效果：中性玻璃包边 + 低饱和蓝/紫/青/珊瑚沿边缘流动。减少动态效果时退化为静态。

窗口与布局：
- 目标窗口约 500 x 400，可在 480px 宽度下完整显示。
- 背景使用 semantic background，不使用装饰性圆球、bokeh、大片紫蓝渐变。
- 顶部展示问学字标和 slogan，可带一个很轻的状态胶囊。
- 中部是主状态区：浏览器状态、说明、主动作按钮。
- 下部是 onboarding / 辅助信息区：首次使用检查清单、版本三元组、日志入口、帮助入口。
- 版本 footer 展示 App / Browser / Extension，使用等宽字体，长版本截断。

必须设计的功能状态：
1. idle 未运行
   - 状态文案：未运行。
   - 主说明：浏览器尚未启动。
   - 主按钮：启动浏览器。
   - 展示首次 onboarding 检查清单。

2. launching 启动中
   - 状态文案：启动中。
   - 主按钮禁用，显示 spinner。
   - 说明：正在准备浏览器与问学插件。
   - 不要显示虚假百分比；可显示“检查资源 / 启动浏览器 / 加载插件”这类非百分比步骤。

3. running 浏览器运行中
   - 状态文案：浏览器运行中。
   - 主按钮：聚焦窗口。
   - 提示：在浏览器工具栏打开问学侧边栏，输入任务。
   - 可用轻量 liquid-glass 边缘或细光线表现运行态，但不要遮挡内容。

4. error 启动异常
   - 状态文案：启动异常。
   - 显示错误摘要。
   - 主按钮：重新启动。
   - 二级动作：查看日志。
   - 文案必须包含“发生了什么 + 下一步怎么办”。

5. 退出确认对话框
   - 标题：浏览器仍在运行。
   - 正文：退出问学 App 不会默认关闭浏览器，你可以让浏览器继续保留。
   - 主按钮：仅退出问学。
   - 次按钮：一并关闭浏览器。

Onboarding 必须包含：
- 标题：第一次使用问学。
- 呈现为紧凑 checklist，而不是教程长文。
- 步骤：
  1. 启动独立的问学浏览器。
  2. 在工具栏打开或固定问学插件。
  3. 需要自定义模型时，进入插件设置页添加 OpenAI-compatible 模型。
  4. 打开目标网页，在侧边栏输入自然语言任务。
  5. 执行过程中用户可随时停止或人工接管。
- 已完成步骤可显示 check 图标。未完成步骤使用空心圆点。
- Onboarding 可以在首次完成后折叠，并保留“新手引导”入口。

视觉细节要求：
- 使用 semantic token，不要散落 slate-* 或硬编码 hex。
- 主按钮使用 primary；危险操作使用 destructive；次级操作使用 outline/ghost。
- 状态不能只靠颜色，必须有文字标签。
- 错误详情、版本号、日志路径必须支持截断与展开。
- 所有图标按钮需要 tooltip 或 aria-label。
- 支持 light/dark mode。
- 支持 prefers-reduced-motion。
- 中文正文不小于 13px。
- 不要在界面内解释快捷键、技术架构、Chrome for Testing 参数、profile 目录等内部细节。

输出内容：
- 给出完整 UI 结构和每个状态的画面。
- 给出组件拆分建议：LauncherShell、BrandHeader、BrowserStatusPanel、OnboardingChecklist、VersionFooter、ExitConfirmDialog。
- 给出关键文案。
- 给出 Tailwind/shadcn token 使用建议。
- 如输出代码，请使用 React + TypeScript + Tailwind，严格让 UI 层只消费状态和发送意图，不触 Node API。
```
