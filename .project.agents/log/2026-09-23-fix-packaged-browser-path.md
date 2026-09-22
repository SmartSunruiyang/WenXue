# 修复打包版无法拉起浏览器（CfT 路径解析 ENOENT）

- **日期**：2026-09-23
- **关联**：ROADMAP M5 打包分发；`docs/context/TECH-INFRA.md` §5.2
- **会话上下文**：首个本地 beta DMG（见同日 packaging 日志）安装后点击启动浏览器失败

## 做了什么

- 复现取证：打包版 main.log 显示 `BrowserSupervisor spawn /Applications/问学.app/Contents/Resources/browser/chrome-mac-arm64/... ENOENT`；而 extraResources 原样拷贝 `.browsers`，真实产物树为 `browser/chrome/mac_arm-149.0.7827.55/chrome-mac-arm64/...`。
- 根因：`BrowserResources.browserBinary()` 打包态分支用 `cacheDir: null` 算出丢掉了 `chrome/<platform>-<version>/` 前缀的路径。dev 态一直可用，打包态路径此前从未被触发（本项目首次打包）。
- 修复：以 Puppeteer 缓存相对路径（`path.relative` 相对 `.browsers`）拼接 `resources/browser` 前缀，dev 态行为不变；TDD 红绿验证（先改测试断言真实布局并补 win64 用例，见失败，再改实现转绿）。
- 同步 `TECH-INFRA.md` §5.2：extraResources 片段与运行时定位改为真实嵌套布局。
- 重打 beta DMG 并验证：新 `.app` 中解析路径存在、该二进制 `--version` 实际执行成功、`hdiutil verify` VALID、`verify-packaged-version` 通过。

## 提交

- `fix(desktop): resolve packaged CfT binary at the Puppeteer cache layout`（代码 + 测试 + 文档同 commit）

## 状态变更

- 架构文档：无需修改（模块边界与依赖未变；契约细节在 TECH-INFRA §5.2 同步）。
- 需求/UI 文档：无变更。
- 测试：`BrowserResources.test.ts` 7 项（新增/修正打包态断言 2 项）；desktop 全套 402 项通过；typecheck 通过。

## 下一步

- 用户重装新 DMG 后点击启动，确认浏览器拉起（真实 UI 点击路径仍待用户复测）。
- 打包态路径已与 Puppeteer 缓存布局一致，Windows NSIS 同逻辑，打 win 包时无需额外改动。
- 后续候选流水线（CI）产物同样受益；§8.3 冒烟脚本仍未实现。
