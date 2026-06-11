# 问学 WenXue — 开发规范（CONVENTIONS）

> 命名、目录、提交、风格、测试的权威。新约定先写本文，再落地代码。
> 与命名/目录相关的架构调整，`ARCHITECTURE.md` 与本文同步更新。

## 0. 阅读指引

适用范围：`apps/*` 与 `packages/*` 的全部代码与本仓库的全部提交。分工：`ARCHITECTURE.md` 管"拆成什么模块、依赖谁"；本文管"叫什么名字、怎么写、怎么提交"。例外：vendor 的 `@page-agent/*` 包以上游风格为准，不为本规范改名/重排（不变量 I5）。

## 1. 命名

### 1.1 标识符
- TypeScript，全仓 `strict` 模式。
- 类型 / 接口 / 枚举 / React 组件：`PascalCase`（接口不加 `I` 前缀）。
- 函数 / 变量 / 方法：`camelCase`。
- 常量：`SCREAMING_SNAKE_CASE`（仅真正的编译期常量；运行时配置不算）。
- IPC 通道名：`域:动作` 小写（`browser:launch`、`app:getVersions`），全集登记于 ARCHITECTURE §3.2。

### 1.2 模块命名（语义禁区）
- 禁止 `Manager` / `Helper` / `Util` / `Common` / `Misc` / `Tools` 这类语义为空的名字。
- 用"动词+名词"或"名词+职责"描述真实职责（本仓示例：`BrowserSupervisor`、`LaunchConfig`、`ProfileStore`）。

### 1.3 文件 / 1.4 目录 / 1.5 资产命名
- 文件按主导出命名：导出类/组件 → `PascalCase.ts(x)`（`BrowserSupervisor.ts`、`ConsoleApp.tsx`）；导出函数集 → `camelCase.ts`（`launchConfig.ts`）。
- 测试文件与被测单元同目录同名：`BrowserSupervisor.test.ts`。
- 目录：小写单词或 kebab-case（`main`、`preload`、`renderer`、`entrypoints`）。
- 资产：kebab-case + 尺寸后缀（`icon-128.png`、`app-icon-512.png`）。
- vendor 包内一律沿上游，不为风格改名。

### 1.6 字符串与本地化
- 桌面端用户可见文案集中于 `apps/desktop/src/renderer/strings.ts`（Demo 阶段简体中文），禁止组件内散落硬编码。
- 插件沿上游 `_locales/{zh_CN,en}/messages.json` 机制。
- 错误文案必须包含"发生了什么 + 下一步怎么办"（语气见 `UIUX.md §9`）。

## 2. 代码风格

### 2.1 排版
- Prettier 仓库根统一配置，**继承上游 page-agent**：tab 缩进、单引号、无分号、`printWidth: 100`、import 排序插件。
- ESLint：`typescript-eslint` + `@eslint-react`。
- 不手工调格式；格式全部交给工具，CI 门禁校验。

### 2.2 分层纪律
- 渲染层（ConsoleUI / SidepanelApp）只消费状态、发送意图；不触 Node API、不写业务判断。
- Node / OS 能力只存在于 Electron 主进程，经 `DesktopBridge` 的 typed IPC 暴露（4 通道之外的访问 = 违规）。
- 业务编排在 L3–L5 服务模块；类型定义保持瘦（优先无方法的 `interface`/`type`）。

### 2.3 并发 / 2.4 错误处理
- 主进程：单事件循环 + `child_process` 事件驱动；Demo 不引入 `worker_threads`。
- 统一 `async/await`；禁止 fire-and-forget——悬空 Promise 必须 `catch` 并落 AppLogger。
- 防御只在系统边界：IPC 入参、`child_process` 的 `error`/`exit`、LLM HTTP 响应、文件 IO。内部模块互信，不重复校验，不为不可能路径加 fallback（SELF_CONSTRAINTS §B5）。

### 2.5 注释
- 默认不写注释；只在 WHY 不明显时写一行。
- 不写解释 WHAT 的注释（命名应自解释），不写会随时间失效的注释。

## 3. 提交规范

### 3.1 Commit message 风格
- Conventional Commits：`type(scope): subject`，subject 中文允许、动词开头。
- type 允许集：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `build` / `ci`。
- scope 用模块域：`desktop` / `ext` / `vendor` / `infra` / `docs`（示例：`feat(desktop): BrowserSupervisor 状态机`）。

### 3.2 提交粒度 / 3.3 工作区纪律 / 3.4 分支模型
- 一次提交一个目的；不在脏工作区叠加不相关改动。
- ROADMAP 复选框在完成它的同一 commit 里打勾。
- 分支模型：主干 `main` + 短命功能分支（`feature/<slug>`），合并即删（最简：主干 + 短命功能分支）。

### 3.5 实施日志
- 规则见 `VIBECODING_GUIDE §5`。每个可独立验收的部分写一份日志。

## 4. 测试策略

### 4.1 框架 / 4.2 必须有测试的模块
- vitest（workspace 根统一版本）。
- 必须有单测：`LaunchConfig`、`BrowserResources`、`ProfileStore`、`BrowserSupervisor` 状态机（mock `child_process`）。
- vendor 四包的上游测试套件随包保留，禁止删除/跳过；对 vendor 的任何本地补丁必须配套回归测试。

### 4.3 必须真机/真环境验证
以下三类，mock / dev 模式证据**不算完成**：
- 打包产物的 CfT 启动 + 插件注入（CDP 冒烟，TECH-INFRA §8.3）；
- 双平台（macOS arm64 / Windows x64）干净机器安装与 PRD 验收清单；
- 真实 LLM 调用全链路（演示前人工走查）。

## 5. 与上游文档的同步矩阵

| 改动类型 | 必须同步（同一 commit） |
|---|---|
| 功能 / 范围增删改 | `PRD.md`，连带 `ROADMAP.md` 受影响里程碑 |
| 模块 / 依赖 / 对外签名 / 不变量 | `ARCHITECTURE.md` §2/§3 |
| 供应链 / 打包 / CI / 启动参数 | `TECH-INFRA.md` |
| 视觉 token / 交互规则 | `UIUX.md` |
| 新的命名/风格/测试约定 | 本文（先文后码） |

## 6. 不在本文范围（明确划清）
- 模块拆分与依赖方向 → `ARCHITECTURE.md`
- 行为与范围 → `PRD.md`
- 视觉与交互细节 → `UIUX.md`
- 供应链、打包、CI、签名 → `TECH-INFRA.md`
- 执行日志的写法与时机 → `VIBECODING_GUIDE.md §5` 与 `log/README.md`
