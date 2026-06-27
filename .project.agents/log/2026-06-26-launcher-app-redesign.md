# 启动器 App 化重构完成

- **日期**：2026-06-26
- **关联**：ROADMAP M3.5；`2026-06-26-launcher-app-redesign-design.md`；`design.pen`
- **会话上下文**：从旧 500×440 单按钮启动器，重构为 1120×720 白色桌面工作台。

## 做了什么

- 将桌面启动器改为无边框白色 App shell：常驻窄侧栏、浏览器 / 日志 / Tokens / 设置路由、Windows/macOS 顶部安全区与拖拽区。
- BrowserSupervisor 升级为按画像并行看护；新增 BrowserProfileStore、LauncherSettingsStore、LauncherLogStore、LauncherTelemetryIngest、TokenUsageStore。
- 浏览器页支持持久画像列表、添加、就地重命名、单开/聚焦/停止、复制、删除、打开画像目录、多选批量打开、并发上限与错峰间隔、空状态。
- 日志页支持实时轮询 tail、级别/全文筛选、详情展开、清空确认、按默认格式导出；主进程系统日志会同步写入启动器日志。
- 扩展设置页下线 LogViewer 入口，保留 Logging 采集与存储，桌面启动器日志页接管查看入口。
- Tokens 页支持总量、成本估算、按画像/模型/日期聚合与最近调用；Telemetry ingest 会从已脱敏 LLM usage 载荷提取 token 用量。
- 设置页补齐 5 组分类：启动默认值、启动器行为、日志、浏览器内核、关于，并即时保存。
- 使用 Pencil 主态设计图校验视觉结构，并通过 localhost mock bridge 验证 1120×720 与 920×600 UI。

## 提交

- 未提交，工作树状态：源码、桌面构建产物、项目上下文文档与本日志均未提交；用户提供的 spec、`design.pen`、`images/`、`ocsjs/` 仍为未跟踪输入。

## 状态变更

- SELF_CONSTRAINTS：为 I3 增加单向日志/tokens 遥测出口豁免，禁止反向控制。
- PRD / UIUX / ROADMAP：同步 M3.5 启动器 App 化、日志与 Tokens 统计需求。
- ARCHITECTURE：补充 BrowserProfileStore、LauncherSettingsStore、LauncherLogStore、LauncherTelemetryIngest、TokenUsageStore 与新 IPC 契约。
- 测试：`npx -y pnpm@9.15.0 -F desktop test` 通过，10 个文件、49 个用例。
- 扩展验证：`npx -y pnpm@9.15.0 -F extension test` 通过，36 个文件、326 个用例；`npx -y pnpm@9.15.0 -F extension build` 通过。
- 构建：`npx -y pnpm@9.15.0 -F desktop build` 通过。
- UI 验证：Browser localhost 预览 1120×720 / 920×600 均无控制台错误、无横向溢出；设置 5 分组切换与日志导出按钮状态已验证。

## 下一步

- 后续第一件事：实现 Chrome Native Messaging host 的跨平台注册与扩展侧补传队列，让 LauncherTelemetryIngest 接入真实插件遥测通道。
- 已知后续项：日志页按来源/画像/时间范围的高级筛选面板与虚拟滚动可以继续增强；本轮已覆盖级别、全文、清空、导出与持久化。

## 2026-06-28 UI 收束补记

- 将侧栏浏览器入口换为 Chrome 标识，保留日志 / Tokens 入口，并将设置入口固定到侧栏底部。
- 调整浏览器详情面板选择逻辑：优先展示当前选中画像，其次展示运行中画像，避免始终固定第一行。
- 补强响应式布局：浏览器列表窄宽度隐藏“上次使用”列，设置页窄宽度改为横向换行分类标签，日志 / tokens / 设置页均避免横向溢出。
- 同步补充 UI 设计 prompt 与功能需求文档中的 Tokens 入口/页面要求。
- 验证：直接调用本地 `electron-vite build` 通过；直接调用本地 `vitest run` 通过（10 个文件、49 个用例）；用构建后的 renderer + mock bridge 在 1120×720 与 920×600 下截图检查浏览器页、多选条、日志页、日志详情、Tokens 页与设置页，未发现遮挡或横向溢出。
