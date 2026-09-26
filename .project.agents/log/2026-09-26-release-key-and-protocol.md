# 发布签名密钥自检与 P2 更新协议校准

- **日期**：2026-09-26
- **关联**：桌面发布通知与更新计划 P2；`docs/context/ARCHITECTURE.md`、`TECH-INFRA.md`

## 做了什么

- AdminApi schema 2 与 schema 1 兼容、CI seal v3 及本机发布脚本已在本地实现并通过对应验证；尚未运行新的 GitHub 构建或部署服务端。schema 1 候选保持原字节与签名。
- 明确 schema 2 的 `platform-unsigned` 目标产物只有 macOS arm64 DMG、Windows x64 NSIS EXE 与对应 YAML 元数据；客户端需明确请求协议版本 2，缺省仅协商 schema 1，未知版本返回 400。旧版通过手动覆盖安装过渡包，v2 不设为 mandatory。
- 可信本机 Keychain 中的 Ed25519 签名材料已通过进程内挑战签名自检。派生 SPKI SHA-256 指纹 `bbacf14f6a6de5f743cf499bd85ccad61434d83f8f110ae4119b2b02eb01c336` 与 Keychain 公钥、GitHub 公钥变量及已安装客户端公钥一致；私钥值未导出或写入仓库。
- 正式网关仅进行鉴权探测：使用 Keychain 注册 token 发送空注册请求，返回 `HTTP 400 Release manifest is required`；没有候选写入。核对时 NoSQL candidate 与 rollout 集合均为 0 条。
- 腾讯云控制台已登录，显示当前只有主账号，没有上传子账号。用户选择由主账号在控制台手动上传，并取消新建 CAM 上传身份；上传尚未执行，不作为当前阻塞项。
- 根 Agent 复跑 Admin API：141/141 通过；发布脚本 31/31 通过（Sol 已验证，根 Agent 亦独立复跑通过）。这些结果不包含本次新 GitHub 构建、部署或实机安装验收。
- 用户同意未来按步骤进行 Windows 手动验收；目前尚未构建/提供新测试包，也未开始验收。P5 安装协调仍在实现与验收过程中，不能宣称 Windows 更新已上线或发布门禁已通过。

## 提交

- 未提交；等待根 Agent 复核后纳入独立 P2 scoped commit。P5 实现仍有未提交改动，不纳入该提交。

## 状态变更

- 架构与基础设施文档：同步了候选 schema、策略协商接口、P5 安装协调目标和打包封存状态。
- 需求文档：未修改。
- 验证：本次文档同步未运行代码测试；根 Agent 报告 Admin API 141/141、发布脚本 31/31 通过。新配置尚未构建或部署；网关空请求只验证注册 token 的鉴权路径，未写入候选。

## 下一步

- 完成 P5 安装协调实现与验收后运行新构建，再向用户提供 Windows 手动验收步骤；用户按选择使用主账号控制台手动上传。
- 不改动尚未验收的计划状态。
