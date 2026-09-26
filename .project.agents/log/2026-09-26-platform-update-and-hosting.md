# 实现双平台桌面更新协调并核验 CloudBase 托管分发

- **日期**：2026-09-26
- **关联**：正式发布计划 P5 客户端更新 / P4 托管分发准备；同步 PRD、ARCHITECTURE、UIUX 与 active plan
- **会话上下文**：记录本轮桌面更新与发布工具实现、CloudBase 托管分发实测及文档同步。未部署服务端或发布正式候选。

## 做了什么

- PRD 从 COS-only 分发更新为复用 CloudBase 静态托管公开文件；保留 PRIVATE 业务 bucket，声明现有套餐配额限制、`EnableOverrun=false`，不承诺永久免费；明确候选不可变规则由应用层执行，不代表 WORM。
- ARCHITECTURE 同步 `DesktopUpdateService` schema 1/2、Windows `electron-updater` 6.8.9 / `NsisUpdater`、严格 metadata 与 EXE 校验、安装动作及取消 epoch；同步 BrowserSupervisor 安装 launch lock / 异步 `allProfilesIdleForInstall()`、typed IPC 的独立 `restartInstall` 与 `UpdateMutationResult`。
- 更新协调约束记录：Windows 仅对验证过的本应用 CfT 发 `WM_CLOSE` 并等待退出，不 kill；`allProfilesIdleForInstall()` 空闲确认后才交接；`withInstallLaunchLock(operation, retainAfterSuccess?)` 在 Windows 已接受交接后保持至进程退出。shutdown/session-end 不安装；窗口关闭不安装；Mac 提示用户关闭占用浏览器并手动打开 DMG。正常退出安装不重启，明确请求立即更新时才重启。
- DesktopReleaseTooling 记录为 `prepare` 下载核验 CI seal → `prepare-upload` 通过安全注入的私钥签署并生成 `hosting-upload.json` → 根 Agent 经现有 MCP 托管上传五对象 → `register-upload` 完整公网回读并注册。register-upload 不负责上传；旧 COSCLI 路径仍为可选，不新增 CAM 身份、不复制主 API Key。
- 记录 CloudBase 存储核验：业务 bucket `7765-wenxue-d8gz76tacc3659f05-1427406869` 为 PRIVATE；静态托管公开文件 bucket `4877-static-wenxue-d8gz76tacc3659f05-1427406869` 为 public-online；`askwenxue.com` 根路径 HTTP gateway 路由到现有托管站点。300 MiB 无敏感探针匿名 HTTPS 完整下载 314572800 字节，SHA-256 `17a88af83717f68b8bd97873ffcf022c8aed703416fe9b08e0fa9e3287692bf0` 匹配，用时 3.8 秒；对象已精确删除并复核。Range 返回 200 全文而非 206，续传未验证。
- 托管上传路径固定为 `desktop-releases/electron/channel/version/`；同路径同哈希复用、异哈希拒绝。签名私钥已在 Keychain `service=com.wenxue.desktop-release` 且匹配已有公钥，不记载任何 secret。
- UIUX 同步 capability 驱动的更新交互：“退出并安装”明确为退出桌面进程后交接安装器且不自动重启；立即重启为独立动作；macOS 打开 DMG 后由用户手动覆盖。版本显示使用构建元数据，当前过渡版 `0.1.1-beta.1`。

## 提交

- 本日志与本轮实现、修复和文档同步由根 Agent 一并封存，无独立提交 SHA。

## 状态变更

- 本轮包含 DesktopUpdateService、BrowserSupervisor、DesktopBridge/MainBootstrap/preload/renderer 的更新协调实现，更新 UI、自绘窗口确认和版本元数据同步，候选注册工具校验，以及 PRD、ARCHITECTURE、UIUX、active plan 文档同步。
- P2 AdminApi schema 2 / 服务端与本机发布脚本此前提交 `6915974`；API 141/141、发布脚本 31/31 已通过，但服务端尚未部署。
- 验证结果：根 Agent 首次全仓 `pnpm -r test` 以 exit 1 结束，唯一失败是 extension 过时的版本断言；Sol 修正断言后，extension 全套 771/771 通过，根 Agent 定向 App 回归 11/11 通过。其他套件已在首次全仓运行中通过，但未在修复后重新跑全仓，不将全仓命令记为通过。根 Agent 独立桌面 443/443 与 typecheck、signal 尾随修正 7/7、shared React 16/16；scripts 33/33、release scoped lint、desktop typecheck、admin build、desktop build 与内嵌公钥验证通过。`DesktopUpdateService` 34/34。
- P5 整体仍未验收。更新 UI 自绘确认在代码和本地测试层已由根 Agent 验收：MainBootstrap、DesktopBridge、WindowCloseDialog 共 85/85，desktop typecheck 通过。新安装包中的 UI 以及 Windows 用户实机安装/升级、macOS DMG 实际覆盖和目标版本启动仍待验证。安装器交接成功只表示系统安装器接手，重启后目标版本启动确认及幂等结果契约仍待完成。
- 候选注册工具的本机 seal 与最终签名 manifest/CI run 换包绑定已实现并验收；正式五对象上传、完整公网回读和候选注册尚未执行，P4 仍未完成。
- P6 官网同源正式下载指针、后台发布闭环与暂停/撤回验证待完成；P7 两跳升级和受控正式发布待完成。CloudBase Range 续传和配额外持续可用性未经验证。

## 下一步

- 补齐安装交接/启动结果契约，再冻结本阶段代码生成新候选；新安装包 UI 与 Windows/macOS 设备端验收仍需执行。
- 通过现有 MCP 授权托管上传正式五对象，执行匿名完整回读与 register-upload；保持存储 ACL 和套餐不变。
- 在 Windows x64 执行用户实机步骤，在 macOS arm64 验证 DMG 覆盖与启动回报；随后完成 P6 同源指针和 P7 两跳演练。
