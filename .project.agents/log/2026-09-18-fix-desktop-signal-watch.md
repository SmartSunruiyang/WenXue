# 修复登录后公告信号监听查询条件

- **日期**：2026-09-18
- **关联**：当前运行时 DesktopAnnouncementService；`docs/context/TECH-INFRA.md` §7.3

## 做了什么

- 定位登录后 `SDK_DATABASE_REALTIME_LISTENER_INIT_WATCH_FAIL` 的界面来源：公告服务启动账号级 CloudBase watch，错误经服务状态显示给用户。
- 核对线上 `desktop_announcement_signal` 读规则。账号文档要求 `doc.uid == auth.uid`，原客户端只按 `_id` 查询；按 CloudBase 安全规则要求，为账号信号查询补充 `uid: '{openid}'`，全局消息与版本信号查询保持原样。
- 增加账号级与全局信号查询的回归测试，并在当前运行时技术文档中记录查询条件。
- 将本地 pnpm 缓存目录 `.pnpm-store/` 加入 `.gitignore`，保留用户已有缓存内容。

## 提交

- 未提交；修复留在工作树中供用户检查。改动为 `.gitignore`、`TECH-INFRA.md`、`cloudbase.ts`、`cloudbase.test.ts` 及本日志。

## 状态变更

- ARCHITECTURE：未改；模块、依赖方向及对外服务签名未变。
- PRD / UIUX：未改；产品行为与界面未变。当前运行时 `TECH-INFRA.md` §7.3 已同步查询契约。
- 验证：`cloudbase.test.ts` 与 `DesktopAnnouncementService.test.ts` 共 38 项通过；桌面 Web TypeScript 检查、改动文件 Prettier、`git diff --check`、`git check-ignore` 均通过。
- 运行环境：已核对线上集合、全局信号文档及读规则；未使用真实用户会话执行登录后的 watch，因此实际 CloudBase 实时连接仍待验证。线上 CLS 日志服务未启用。

## 下一步

- 在桌面应用中使用已授权账号重新登录，确认错误提示不再出现，并检查公告 watch 能收到后续 revision 变化。
- 若仍收到同一 `SYS_ERR`，分别记录全局与账号 watch 的 `onError`、请求 ID 和发生时间，以区分权限查询与 CloudBase 实时服务故障。
