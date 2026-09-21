# 无感用户会话交接设计

## 范围

本变更只调整当前 Electron + Chrome for Testing 运行时的用户 session 交接体验。保留一次性
localhost + `externally_connectable` 的既有安全边界，不改登录、网关、Agent 控制或目标 Chromium
架构。

## 验收要求

1. 当用户打开一个浏览器画像时，启动器应把问学新标签页作为前台标签，并把一次性交接页作为后台
   临时标签，用户不应看到交接状态页面。
2. 当插件完成或拒绝 session 保存时，交接页应先把结果回传桌面端，再请求插件关闭自己的标签页；
   不得关闭其他标签页。
3. 当交接开始、成功、拒绝或超时时，桌面端应写入脱敏生命周期日志；日志不得包含 access token、
   refresh token、完整 session 或 localhost nonce URL。
4. 当目标画像已经运行时，再次打开该画像应采用相同的“前台新标签页 + 后台交接标签”行为。
5. 当插件不可用时，桌面端应维持既有失败关闭行为并记录错误；不得把凭据写入日志或远端服务。

## 技术设计

- `LaunchConfig` 与 `BrowserSupervisor` 接受有序 `startUrls`。Chromium 将首个命令行 URL 作为前台
  标签，其余 URL 作为后台标签，因此 DesktopBridge 传入
  `[WENXUE_NEW_TAB_URL, handoffUrl]`。其中 `WENXUE_NEW_TAB_URL` 是固定扩展 ID 对应的
  `chrome-extension://.../newtab.html`；不能使用 `chrome://newtab`，因为 Chromium 在同批参数还包含
  普通 URL 时会忽略该内部页。
- `UserSessionHandoff` 页面移除可见状态 UI，只负责向固定扩展 ID 发送 session、POST 完成结果，
  然后发送不含凭据的 `WENXUE_USER_SESSION_HANDOFF_CLOSE` 消息。
- 扩展 background 只接受 localhost 外部来源，并且只删除 `sender.tab.id`，不接受调用方指定 tab ID。
- `UserSessionHandoff` 依赖 `AppLogger` 记录 profile 级生命周期；消息只包含 browserId 和阶段，不包含
  session 字段、错误载荷或交接 URL。

## 验证

- 单元测试覆盖有序多 URL argv、首次启动与运行中画像的双标签参数、空白交接页、关闭消息、桌面日志
  脱敏，以及扩展只关闭发送方标签。
- 运行 desktop / extension 的定向测试、类型检查和构建。
- 真机浏览器验收要求前台直接进入问学新标签页、交接标签自动消失、桌面日志出现无凭据结果；若当前
  主机缺少对应 CfT 二进制，则明确记录为未完成的真环境验证。
