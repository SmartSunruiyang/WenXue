# P5.5 手动兜底与 P5.7 启动确认本地实现

- **日期**：2026-09-26
- **范围**：同步桌面更新的 Windows 手动兜底、重启后目标版本启动确认，以及 P5.5/P5.7 的提交、生产部署和待验收状态。

## 实现与状态

- `DesktopUpdateService` 保存 `<userData>/update-install-attempt.json`：schema 1、本地唯一 `attemptId`（不上传）、签名 manifest/signature、来源/目标版本、releaseId、channel/platform/arch、artifactSha512、原 eventInstallIdHash、受限 eventToken、时间及 `prepared | accepted | failed`。原子 mode `0600`，最多 7 天，不存账号、硬件 ID 或安装路径；同一文件写入/删除由 service 串行化，以 attemptId 防止旧异步失败或回报清理覆盖新尝试。
- 最终在线策略、签名候选与浏览器空闲复核通过后、真正交接前写 `prepared`。写入失败取消本次安装交接，但正常退出可继续；交接成功记 `accepted`，明确失败记 `failed`。Mac `accepted` 只表示 DMG 已打开；prepared/accepted 的 UI 状态均为“更新尝试已记录，等待新版启动确认”，accepted 不代表安装完成。
- 下次打包版启动先验签本地记录。仅 `app.getVersion() === targetVersion` 时，不经当前 active policy 再门禁，使用原有效 token 让 API 按历史 verified candidate 核对版本及 manifest 对应平台 `artifactSha512`，再幂等上报 `target-started/success`。这是版本与签名候选的关联回报，不是可信遥测，也不验证运行中安装目录的每个字节。
- 仍启动 `fromVersion` 只显示本地未确认线索，不上报失败；跳到其他版本、记录过期或损坏不得报告 success。网络错误/5xx 可退避重试且不阻断启动；401/400/过期终止；stop 清 timer 且不得重复。token 格式错误的原始错误不得写日志。
- 管理端 `stages.targetStarted.success` 独立于 installer-handoff。旧服务端缺字段时显示未知；字段值 0 表示未收到确认；缺失/未知都不能计作失败。About 空闲时也可显示目标版本与 `unconfirmed | confirmed | failed` 事实状态，不展示凭据、不弹强制对话框。
- Windows schema 2 仅在 `error` 且仍有对应已验签候选时提供“手动下载安装包”。入口可按最近状态展示；每次点击独占并在线复核策略、签名和对应平台 artifactSha512 匹配后才打开已签 manifest 的 HTTPS URL，撤回、离线或不匹配时拒绝打开。它不操作缓存、不退出应用、不创建安装尝试，也不表示已经安装；不承诺绕过 UAC、SmartScreen 或组织策略。

## 后台部署核验

P2/AdminApi schema 2 已部署至生产 039（BuildId `2607439703`、RunId `1xARiPgBq89D7p`，100% normal），对应代码提交 `bb4dc29` 已 push 至 `origin/main`；此前 038 已被 039 替代。AdminConsole bundle `Cr1Z5t0W` 已 build、通过 16 文件白名单 staging 并在线返回 200。根 Agent 在线核验 CloudRun health 200、legacy/v2 policy 200/null、非法 protocol `999` 为 400、缺少 `targetVersion` 的 target-started 请求为 400 `Invalid targetVersion`（未写事件）、未认证 AdminApi 为 401。部署配置对比未变（含环境变量、VPC、规格）。后台页面只读验收确认登录会话恢复正常；发布页展示“目标版本启动反馈单独显示，未收到反馈不代表安装失败”，暂无 verified 候选/发布记录且立即发布禁用，未创建候选、事件或 rollout。

P5.5/P5.7 代码已提交至 `bb4dc29` 并 push 到 `origin/main`，但新 CI 尚未触发，候选五对象上传/注册及 Windows/macOS 新安装包设备验收仍待；GitHub 旧产物永久删除确认等待用户回复。后台 039 上线不代表客户端已升级，也不代表 P5/P6/P7 或整条升级链路验收完成。

## 文档与验证

同步了 ARCHITECTURE、PRD、UIUX、当前发布计划。根 Agent 已独立验收 admin-api 146/146、Bridge/App 58/58、DesktopUpdateService 42/42、shared client-operations 17/17、desktop typecheck、lint:desktop-release、desktop build 与 verify-embedded-release-key；AdminConsole bundle `Cr1Z5t0W` build、白名单 staging 与线上 200 验收通过。P5.5/P5.7 本地实现与定向验收通过。admin-api 用例覆盖 target-started 正确/错误版本、artifactSha512/token、NSIS/YAML 区分、幂等与 health 统计。全仓 `pnpm -r test` 未在修正旧 extension 断言后重跑，不能记为全仓通过。新安装包和 Windows/macOS 设备端真实升级仍待验收。生产当前为 039（BuildId `2607439703`，代码 `bb4dc29`）；服务端线上核验已通过。新 CI/桌面候选上传注册、Windows/macOS 实机升级仍待，GitHub 旧产物永久删除确认等待用户回复。代码已提交并 push；本日志未单独提交，待主 Agent 封存。
