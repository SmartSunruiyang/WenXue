# 首次使用动画代码整理提交，缺失素材由就绪门禁保护

- 日期：2026-09-22
- 关联：[设计](../docs/superpowers/specs/2026-09-22-onboarding-animation-design.md)、[计划](../docs/superpowers/plans/2026-09-22-onboarding-animation.md)
- 工作树：`/Users/outas/.codex/worktrees/onboarding-animation/WenXue`，分支 `codex/onboarding-animation`。

## 已完成

- 保留原工作区的既有登录改动，以无引用快照 `cb6c8c5fa897742d7f2a108e91d839eb9524acf6` 建立独立工作树。没有修改原工作区。
- ConsoleUI 接入按账号的首次使用判定，已有画像不自动打断，完成/跳过分别持久化；关于页可重播。
- 六步视频播放器实现播放/暂停/重播、260ms 前后步转场、转场期间仍可跳过、加载错误重试、减少动态效果与键盘支持。
- 最后片段 ended 后进入 Logo / slogan 动画页；品牌展开后显示「开始探索」，必须点击才退出，不创建画像或发出模型任务。
- 通知/更新弹层与窗口隐藏暂停视频，过期媒体事件不推进新步骤。
- 独立预览脚本 `apps/desktop/scripts/preview-onboarding.mjs`；`http://127.0.0.1:5198/` 预览播放器，`/ending` 直接预览同一个收尾组件。独立预览退出只显示预览完成，不冒充真实工作台。
- 同步 ARCHITECTURE、UIUX、目标 PRD 与设计/计划。

## 未完成与真实录制状态

**六段正式 mp4 素材尚未生成或进入仓库，当前分支不能作为完整教程交付。** 用户随后授权汇总分支和未提交代码；本次保留实现并加入素材就绪门禁，缺任一片段时不自动打开教程、不展示重播入口，也不写入完成/跳过记录。 不得用模拟界面/响应填补素材，也不得把测试中派发 ended 事件当作真实录制验证。

已通过 CUA 确认当前真实问学的登录页随后变为已登录空工作台，录制工具可用。macOS `screencapture -v -k -x -l<windowId> -V<seconds>` 已录得一段真实窗口画面，但录制过程中出现同时操作（创建两条浏览器并切换设置），CUA 点击被用户控制保护中止。该段没有完整所需分镜，保留在 `/tmp/wenxue-onboarding-capture/01-create.mov`，**未当作正式素材使用**。已向用户发出协调请求，等待约五分钟连续操作窗口的时段，不以等待时长代替同意。

待录路径（renderer/public）：

- `onboarding/01-create.mp4`：新建、命名、点击对号；
- `onboarding/02-open.mp4`：打开、启动、实际浏览器出现；
- `onboarding/03-website.mp4`：点击快捷入口、网页加载；
- `onboarding/04-assistant.mp4`：扩展菜单、固定、打开侧栏；
- `onboarding/05-task.mp4`：通用示例任务、真实网页操作和结果；
- `onboarding/06-stop.mp4`：运行中点击停止，显示真实停止状态。

## 验证

- `pnpm -F desktop typecheck` 通过。
- `pnpm -F desktop build` 通过（仅代码构建，不代表缺失视频已验收）。
- 整理提交时重新执行 `pnpm -F desktop test`：25 个文件、327 个 vitest 测试，以及 14 个 Node 脚本测试全部通过。
- 进度与素材就绪测试 9 个（含缺单个/全部素材、错误名称与不写完成记录的回归）；播放器行为测试 6 个（使用媒体事件模拟验证 UI 状态，不替代实机视频）。
- 整理提交时再次通过 desktop typecheck / build、受影响 TS / TSX / mjs 文件 ESLint、Prettier 和 diff whitespace 检查。
- 独立临时 Vite 构建夹具验证 public MP4 存在时 glob 正确保留素材路径键；夹具已清理，不是正式视频或播放证据。
- 前序实现会话 CUA 浏览器检查 920×600 最小窗口下播放器布局和导航；品牌收尾真实渲染可见 Logo / slogan / 开始探索，并实际点击确认只在点击后退出。
- Windows 原生录制、六段素材播放、实际 LLM 全链路与最终打包素材检查尚未完成。

## 提交

- 基线快照 `cb6c8c5fa897742d7f2a108e91d839eb9524acf6`：保护原有登录工作，不是教程完成提交。
- 本日志与实现纳入 `feat(desktop): preserve onboarding with media readiness gate` 提交；可通过该唯一主题定位本次提交。全部改动仅在 `codex/onboarding-animation` 工作树内完成，没有合并 main 或推送。
- 已核查此次提交只包含源代码、测试、预览脚本与项目文档，没有正式/临时录屏、密钥、构建产物或个人 IDE 配置。

## 下一步

主集成任务负责将本提交并入主分支并保留最新账号弹窗。真实录制仍需获得连续操作窗口的时段后，通过 CUA 操作真实问学，录制六段。重新从 CGWindowList 获取目标窗口 ID（进程/窗口已发生变化，不复用旧 ID）。裁剪/压缩需保持真实按钮上下文与足够字号；仅压缩等待，明确标记加速。检查全部片段、真实结果和停止反馈，再核验教程整体、更新该日志。素材齐备后构建自动启用教程；需要再次核验实际视频、最小窗口、跨平台与打包资源，不以门禁测试替代教程验收。
