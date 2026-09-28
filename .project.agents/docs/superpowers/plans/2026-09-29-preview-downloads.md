# 官网公开预览版下载

用户要求将 `0.1.2 preview` 安装包上到官网并向现有用户发布更新。本计划仅覆盖官网公开下载，版本、构建与上线由主任务负责。上游为 PRD §当前桌面发布要求、ARCHITECTURE 的 AdminApi / WebsiteSite 契约与 TECH-INFRA §8.2.2。

1. 保留 stable 明确保留指针和历史回退。仅在无合格 stable 时读取 beta 当前活动指针，要求 Electron、verified、active、100%、optional、SemVer 预发布首段为 `preview`，以及完整的 Windows x64 / macOS arm64 安装器。
2. 不公开普通 beta、候选、灰度、暂停、撤回或已被替代 preview；不扫描候选或引入 preview 历史回退。公开响应仍只含 version、publishedAt 和安装器投影。
3. 官网严格解析 stable / preview 版本，以“正式版”/“预览版”区分；沿用刷新、失败清空、点击复核和版本切换后再次确认。
4. 同步上游公开下载约定，补 selector 与下载状态回归测试，执行 admin-api 测试/typecheck、website 测试/build 和格式校验，写独立执行日志。

完成状态和本轮验证记录见 `.project.agents/log/2026-09-29-enable-preview-downloads.md`。
