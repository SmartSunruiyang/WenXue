# Windows 更新器兼容性源码研究记录

- **日期**：2026-09-26
- **关联**：[桌面发布与更新实施计划 P2 / P5](../docs/superpowers/plans/2026-09-25-desktop-release-notifications-updates.md)
- **范围**：记录 electron-builder 与 electron-updater 的官方接口兼容性研究；不包含实现或验收。
- **工作区**：`codex/release-notifications-updates`；开始时 `git status --short --branch` 仅显示分支名，工作区干净。

## 做了什么

- 记录实际锁定的 `electron-builder` `26.15.3`，以及调研所核对的 `electron-updater` `6.8.9` / `builder-util-runtime` `9.7.0` 版本组合。版本兼容性仍须在 P5 接入时以锁文件和实机验证为准。
- 官方源码快照 `electron-userland/electron-builder` commit [`bed3a9c421a8a05c49f36a2af5d7ae3598cb1b95`](https://github.com/electron-userland/electron-builder/tree/bed3a9c421a8a05c49f36a2af5d7ae3598cb1b95/packages/electron-updater/src) 显示：`setFeedURL` 接收 generic 配置或 URL，不接收 Provider 实例。不要通过私有 `clientPromise` 注入自定义 Provider。
- 可继续评估的公共接口路径：生成候选专属、不可变的 `beta.yml` / `latest.yml`，将其原字节纳入 CI seal 和本机签名清单；使用 `setFeedURL` 指向该候选目录，并设置 `autoDownload = false` 后调用 `checkForUpdates`。策略验签清单与 updater 元数据须对同一候选的 EXE 单条 URL、大小、SHA-512 和版本逐项一致；拒绝 `packages` 与 `stagingPercentage`，避免额外文件和 updater 自有灰度再次选择候选。
- 研究建议的 Windows 参数包括 `autoInstallOnAppQuit = false`、`disableDifferentialDownload = true`、`disableWebInstaller = true`、`allowDowngrade = false`。`channel` setter 会启用 `allowDowngrade`，因此不应依赖它选择候选；如其他代码路径触发 setter，须显式复位并在最终安装前再次执行策略门禁。
- updater 管理自身下载缓存，不能把同一进程的缓存命中当作安装前完整性证明；安装前仍需重新校验实际文件的哈希与大小。禁用差分下载后不需要 blockmap，但候选 YAML 和 EXE 仍须受 seal / 清单绑定。`app-update.yml` 属于 builder 写入应用包的 updater 配置，不是可信候选元数据的替代物。
- `quitAndInstall` 会先启动安装器，再安排 `app.quit()`。因此在 `before-quit` 中才开始异步关闭和校验过晚；应用须自行协调退出：同步阻止默认退出，正常关闭所有问学管理的 CfT，完成后再复核新鲜策略、文件完整性与文件占用，最后交接安装器。Electron 官方说明见 [`before-quit`](https://www.electronjs.org/docs/latest/api/app#event-before-quit)。
- 版本边界：不能将 electron-builder v27 / electron-updater 7.x 文档直接当作 builder 26.15.3 与 updater 6.8.9 的兼容证据。参考 [`electron-builder v26 自动更新文档`](https://www.electron.build/v26/docs/features/auto-update/) 和上述固定源码快照。

以上是官方接口研究形成的**备选实现证据**，不是已批准或已落地的架构。P2 仍须确定 schema / capability 兼容过渡、安装结果 token 与公开下载指针等最终契约；P5 才接入并完成必要的平台验收。不得据此将 P2 / P5 标为完成。

## 提交

- 与本机发布工具就绪和公告实测记录同批提交：`docs(infra): record installed client and local publisher readiness`。未修改业务代码。

## 状态变更

- 架构、需求和实现：未修改。
- 测试：未运行；本任务仅整理已有官方源码研究，不新增测试或声称运行时验证。

## 下一步

- 主 Agent 验收记录后，在 P2 确定并登记候选元数据与策略绑定、兼容过渡、安装结果和公开下载契约。
- P5 实现时锁定实际依赖版本，对照相应源码复核 API，并完成 Windows x64 安装与安全退出实机验证。
