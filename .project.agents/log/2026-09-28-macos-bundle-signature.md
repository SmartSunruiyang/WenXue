# 2026-09-28 — macOS DMG 内 App 签名故障

## 触发与影响

- 用户将 `WenXue-0.1.1-beta.1-mac-arm64.dmg` 中的 App 拖入 Applications 后打开，macOS 报“已损坏”。
- beta.1 与 beta.2 均已登记为 verified 候选，但这只表明候选清单和发布字节校验通过；两版 macOS 包暂不用于安装/升级验收，也没有 rollout。

## 只读核验

- 下载目录中的 beta.1 DMG 为 277608681 bytes，SHA-512 `1d+GPG9IODabLHJ946QIwgZKhPxJPut5AlmR8GqSglgsmk082IXG07CPrGBg15NOVrD7oy2t2bFCOxNxyKs7IQ==`；与 hosting-upload/release-review 一致，`hdiutil verify` 返回 VALID。
- beta.2 DMG 为 277608783 bytes，SHA-512 `IBKEyfZpyNGl/PFv3zEcWtTqYYOvgq3pEALhrqYA620a9WJJZpV7q6KGooxAv9Ui3uC+On4cPqORq7Gi9wHNrg==`；与 hosting-upload/release-review 一致，`hdiutil verify` 返回 VALID。
- 根 Agent 只读挂载两版 DMG 后，对包内 App 运行 `codesign --verify --deep --strict` 均失败，报错 `code has no resources but signature indicates they must be present`。beta.1 的 `spctl` 也 exit 1；签名显示 `Identifier=Electron`、adhoc/linker-signed，Info.plist 未绑定且没有 sealed resources。用户下载的 beta.1 DMG 带 `com.apple.quarantine`。
- 因此故障位于 DMG 内 App bundle 的代码签名结构，不是 DMG 容器或传输字节损坏。Luna 只核对 SHA-512、size 与 `hdiutil verify`；未挂载或启动 App，也未改文件、属性或系统设置。

## 修复边界与后续门禁

- Sol 已将 `mac.identity: null` 改为 `'-'`，并用锁定的打包器验证了完整 ad-hoc code signature；保留 `hardenedRuntime: false`、`notarize: false`，不办理 Apple Developer ID 证书或公证。ad-hoc code signature 用于绑定/验证包内代码与资源，不提供 Apple 开发者身份或公证信任，也不保证免除 Gatekeeper 提示。
- Sol 用锁定的 electron-builder 26.15.3 `MacPackager.sign` identity `'-'` 流程重签，根 Agent 独立核验旧 App 副本 `/tmp/wenxue-adhoc-proof.i2NOrQ/问学.app`。`codesign --verify --deep --strict --verbose=2` exit 0，显示 valid on disk、satisfies Designated Requirement；`codesign -dv` 显示 `Identifier=com.wenxue.launcher`、`Signature=adhoc`、Info.plist entries 31、Sealed Resources v2 files 391。`spctl assess` exit 3/rejected，符合没有 Developer ID/公证信任的预期。未启动 GUI、未改系统安全设置或 quarantine。此独立副本实证只证明修复签名结构可行，不证明最终 beta.3 DMG、下载或首次启动通过。
- CI 已接入最终 DMG 的版本、应用标识和 `codesign --verify --deep --strict` 门禁，并在 macOS job 执行真实 DMG 的正反例回归。根 Agent 独立通过新增 5 项和候选 2 项测试（7/7，无 skip），全 release lint 通过；Sol 另通过 extension options 11/11、格式与 frozen-lock 检查。新门禁实际拒绝旧 beta.1 包并正常卸载。三包版本统一为 `0.1.1-beta.3`；最终修复版结果见下方本轮记录，beta.1/beta.2 不覆盖且继续保持未发布。
- 2026-09-28 新构建前额度快照：GitHub Free，Actions 104.3/2000 分钟；storage 0 GB/0.5 GB（页面取整）；gross `$0.63`、discount `$0.63`、billable `$0`；Actions budget `$0`、spent `$0`、Stop usage=Yes。设置未修改。
- 2026-09-28 13:32 CST GitHub artifacts API 返回 `total_count=0`，与 workflow 配置的 1 天留存期相符；截至该次查询尚未执行本轮清理。下载目录备份及 CloudBase 对象仍保留。
- 新候选已完成严格签名门禁和登记，但没有 rollout。若系统仍显示 Gatekeeper 提示，是否允许继续由用户按系统提示单独判断；该交互不能替代签名修复与验证。首次打开结果尚未收到。

## 工作记录

- 本轮由 Sol 修改打包配置、既有校验脚本和回归测试、CI 及三包版本元数据，Luna 整理证据与文档，根 Agent 审查并独立验证。基线提交 `354bcd5`；修复代码提交 `4708213cf5afac26e22f3ba48731e86f4f893e2d`。未修改系统安全设置、quarantine、用户资料或已封存安装包。
- 2026-09-28 beta.3 验证：CI run `36383077750`（source `4708213cf5afac26e22f3ba48731e86f4f893e2d`）的 `quality`、`windows`、`macos`、`seal-artifacts` 四个 job 全部成功。macOS 最终 DMG 回归、ad-hoc sealed DMG 打包及最终 DMG 版本/应用签名门禁均通过；根 Agent 本机 `verifyMacDmg` exit 0。`prepare`、`prepare-upload`、MCP 五对象上传和 `register-upload` 完整公网回读/签名校验均通过，候选 `electron:beta:0.1.1-beta.3` 状态 `verified`，manifest 为 `https://askwenxue.com/desktop-releases/electron/beta/0.1.1-beta.3/candidate-manifest.json`。三个 GitHub artifacts 共 498346326 bytes。2026-09-28 20:43 CST，按用户持续授权，在本机备份哈希复核且确认候选 verified 后，根 Agent 删除本 run 三项 artifacts；操作均 exit 0，API 回查 `remainingCount=0`，释放 498346326 bytes。下载备份与 CloudBase 五对象保留，操作证据为 `/Users/outas/Downloads/WenXue-CI-36383077750/github-artifact-cleanup.json`。该候选尚无 rollout，用户首次打开反馈尚未收到，因此不代表实机首启或升级验收通过。
