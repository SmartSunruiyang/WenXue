# 统一 0.0.1beta 版本并关闭更新不可用提示

- **日期**：2026-09-25
- **关联**：当前 Electron 运行时 `DesktopUpdateService` / `DesktopBridge` / `ConsoleUI`；插件与官网产品版本

## 做了什么

- 缺少内置更新签名公钥时，顶部错误提示提供关闭按钮；关闭后同一错误不会重复遮挡，关于页仍显示原因。
- 桌面、插件、官网包版本统一为 `0.0.1-beta`，用户可见版本统一为 `0.0.1beta`；Chrome 清单保持数值 `version=0.0.1` 并提供 `version_name=0.0.1beta`。
- beta 桌面包默认检查 beta 通道；CI 显式设置的通道仍优先。新增跨产品包版本一致性回归检查。
- 在独立工作树生成 macOS arm64 未签名安装包 `WenXue-0.0.1-beta-mac-arm64.dmg`。

## 提交

- `3e0506e` fix(desktop): align beta versions and dismiss update warning。原工作树的独立改动由本次分支整合另行保存，未混入此提交。

## 状态变更

- 架构文档：补充 `app:getVersions` 的插件 `version_name` 读取与 ConsoleUI 可关闭的无候选错误提示；未改变模块或依赖边。
- 工程/UI 文档：记录 SemVer 与界面版本、beta 通道默认值和提示关闭行为；将旧 `0.1.0 → 0.1.1` E2E 样例改为当前版本到更高 SemVer 版本。
- 测试：桌面 Vitest 403 项与发布脚本 14 项通过；插件 Vitest 771 项通过；官网 6 项测试通过，三端生产构建通过；新增版本一致性测试与相关 UI/IPC 测试通过。`pnpm -F website test` 因官网包未声明 `tsx` 无法启动，使用已安装的 `tsx` 直接运行同一批测试通过。目标文件 ESLint 无错误，Prettier 与 `git diff --check` 通过。
- 打包核对：DMG 文件名、App `Info.plist`、`app.asar` 包版本均为 `0.0.1-beta`；包内插件清单可见版本为 `0.0.1beta`；主/渲染进程 beta 通道及关闭提示控件均在包内。未对真实用户画像启动安装包。

## 下一步

- 在隔离的测试账号/画像上打开本次 DMG，确认顶部提示可关闭且关于页保留错误说明。
- 若要启用真实更新检查，按发布流程配置并嵌入 Ed25519 更新公钥；当前未配置的构建仍会显示更新不可用。
