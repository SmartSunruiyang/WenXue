# 本地打包 beta 版 macOS 安装包（arm64）

- **日期**：2026-09-23
- **关联**：ROADMAP M5 打包分发；TECH-INFRA §8.1 本地构建流水线
- **会话上下文**：项目进入打包发布流程，首个产物为本地 manual-unsigned beta DMG

## 做了什么

- 发布前门禁：extension vitest 83 文件/771 项、desktop vitest 30 文件/401 项 + node --test 脚本 14 项、desktop typecheck 全部通过。
- `pnpm -F extension build` 产出 `chrome-mv3`（5.49 MB），供 electron-builder `extraResources` 注入。
- 打包前把 `.browsers/chrome` 中非 arm64 平台（mac x64、win64）临时移出（CI 同款按平台只留一份的做法），避免 DMG 塞入三平台 CfT 共 ~1.1G；打包后已原样移回。
- `WENXUE_UPDATE_CHANNEL=beta CSC_IDENTITY_AUTO_DISCOVERY=false pnpm -F desktop dist:mac` 产出
  `apps/desktop/release/WenXue-0.1.0-mac-arm64.dmg`（264M）。
- 验证：main/renderer bundle 内嵌 `"beta"` channel；`verify-packaged-version.mjs` 通过（0.1.0 / darwin）；
  `.app` 内 `Resources/browser` 与 `Resources/extension` 就位；`hdiutil verify` 校验和 VALID。
- 未执行 §8.3 CDP 冒烟：`scripts/smoke-launch.ts` 尚未实现（ROADMAP M5 未勾选项），不虚构通过。

## 提交

- 本段打包未改任何跟踪文件，无代码提交；本日志随 `docs: record beta macOS packaging` 入库。

## 状态变更

- 架构文档：无变更（打包走既有 electron-builder.yml 配置）。
- 需求/UI 文档：无变更。
- 测试：见上，全绿。

## 下一步

- 测试者安装说明：未签名产物需右键打开或 `xattr -cr /Applications/问学.app` 放行（TECH-INFRA §5.2）。
- 本 DMG 未内嵌 Ed25519 release key（本地构建默认为空），仅作直发安装包，不进更新系统；
  正式 beta 分发需走 `desktop-release-candidate.yml`（受保护分支 + 公钥 variable）出 CI 候选。
- 如需 Intel Mac 测试者，可另打 x64 DMG（CfT x64 已缓存，`electron-builder --mac dmg --x64`）。
- 真实账号首次登录视觉复测（vibrancy 修复的遗留验证，见同日 vibrancy 日志）。
