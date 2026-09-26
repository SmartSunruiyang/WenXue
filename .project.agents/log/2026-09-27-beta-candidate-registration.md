# 2026-09-27 — beta 候选构建、CloudBase 托管与登记

## 范围与版本控制

- 按已批准计划推进 P4；主 Agent 验收发布来源、签名门禁、上传结果和后台候选，Luna 整理文档初稿，主 Agent 校正并收尾。
- 实现工作树：`codex/release-notifications-updates`。本轮冻结来源为 `6fb2731a9e303e2ead81567b78d06c69b42e9a0c`，构建、prepare、签名和登记时 checkout 均保持该 HEAD 且干净。
- 相关代码提交：`6915974`（协议/seal）、`0c92096`（平台更新与托管）、`bb4dc29`（启动确认/手动恢复）、`6fb2731`（部署记录）。本日志、TECH-INFRA 与实现计划随同一文档提交保存；未修改业务代码，不为文档重复运行业务测试。
- 主仓库中用户未提交的邮箱验证/邮件模板改动保持原状。

## 旧产物删除与免费额度

- 用户明确批准删除旧 run `36188670852` 的三个 GitHub artifacts。删除前重新校验本地安装包与 seal/公钥绑定，备份保留在 `/Users/outas/Downloads/WenXue-CI-36188670852`。
- 已删除 `10887790385`（Windows，220737455 B）、`10887645967`（seal，832 B）、`10887284314`（macOS，276729163 B），合计 497467450 B；删除后旧 run 和仓库 artifact 列表均为 0。仅删除旧产物，构建日志与代码不受影响。
- 删除证据：`/tmp/wenxue-release-20260927/old-artifact-cleanup.json`。新 run 的三个 artifacts 保留，不能将这次授权延伸为删除新产物。
- 2026-09-27 **本轮新 CI 触发前**，登录的 GitHub 账单页显示 Free、Actions 35.7/2000 分钟、存储 0 GB/0.5 GB（页面取整，不是精确即时余额）、当前应付 $0；Actions 预算 $0 且 Stop usage=Yes。未变更预算、购买额度或公开仓库。此快照不是新 run 运行后的计费结果，也不证明删除会立即刷新配额。

## CI 与本机来源复核

- [Run 36260499160](https://github.com/SmartSunruiyang/WenXue/actions/runs/36260499160)：main、workflow_dispatch、attempt 1，预期完整 SHA 与冻结来源一致。
- 版本 `0.1.1-beta.1`，channel `beta`；quality、macOS arm64、Windows x64、seal-artifacts 全成功。
- CI 质量门禁包含完整 `pnpm -r test`、发布 lint、相关 typecheck、AdminConsole build 与桌面内嵌公钥验证。两端安装器打包、版本和公钥绑定、Windows update YAML 与 seal v3 均通过。
- 本机 Node 22 执行 `publish-local-candidate.mjs prepare`，下载该 run 唯一的三个未过期 artifacts，复核真实 source/run/commit、seal v3、两端公钥及三份原字节产物；退出码 0。
- 候选目录：`/Users/outas/Downloads/WenXue-CI-36260499160`。`release-review.json`、`hosting-upload.json` 和无凭据的 `publication-result.json` 保存本轮证据。
- 操作者明确审阅后，以字面值传入的 artifactSetSha512：`y7pZcUrge2DZM2C5mF8ktS/gBxUElt0GvqE90vcB+8lIUisprTo+J/plfNJio78jTeI7rAMITAI2sEcB0f3V4A==`。
- Ed25519 SPKI SHA-256：`bbacf14f6a6de5f743cf499bd85ccad61434d83f8f110ae4119b2b02eb01c336`。

| 原字节产物 | 大小（B） | SHA-512（base64） |
| --- | ---: | --- |
| `darwin/arm64/WenXue-0.1.1-beta.1-mac-arm64.dmg` | 277608681 | `1d+GPG9IODabLHJ946QIwgZKhPxJPut5AlmR8GqSglgsmk082IXG07CPrGBg15NOVrD7oy2t2bFCOxNxyKs7IQ==` |
| `win32/x64/beta.yml` | 337 | `TalIjntbEh2m/X5Hx/gze1VQ0zjTjjcyYZgJvjk9WBhFSFFm0raGM956E54e4MjrRCfBRTrN69YUNHHcaua8vQ==` |
| `win32/x64/WenXue-0.1.1-beta.1-win-x64.exe` | 221023255 | `rTOycFok9MLEPEBGpN0yxcXpuAgl5S1vKehvy5h71y8RyG83TmXQ7i1w0D+nzaW4AIf/Um+I0srVEhE44jy/ug==` |

上述数值为解包后的文件，不是 Actions artifact ZIP 大小。CI 证据名 `manual-installer-integrity` 仅表示自动化安装包完整性检查，不证明执行过真实安装或升级。

## 签名、CloudBase 托管与公开登记

1. `prepare-upload` 在同一干净 HEAD 重新复核来源/run/seal/hash，使用既有 Keychain 私钥生成确定性 schema 2 清单及签名，返回五项上传计划；五项初始 disposition 均为 upload。既有私钥可用，未重新生成。
2. 目标环境 `wenxue-d8gz76tacc3659f05`、ap-shanghai；静态托管 bucket `4877-static-wenxue-d8gz76tacc3659f05-1427406869` 在线。业务 CloudBase bucket 仍为 PRIVATE。
3. 通过现有 CloudBase managed upload，先上传 DMG，再批量上传 beta.yml、EXE、signature，最后上传 manifest；五个对象各返回 200。仅上传指定文件，不上传候选目录中的本机证据或凭据。
4. 正式文件前缀为 `desktop-releases/electron/beta/0.1.1-beta.1/`，公网 origin 为 `https://askwenxue.com/`。托管查询底层 `Contents` 包含恰好五个对象及相符尺寸；工具顶层 files/count 的空数组不作为缺失依据。
5. `register-upload` 进程不带私钥；重新校验 checkout、run、seal、批准清单与注册 payload，公开回读清单/签名并验签，完整下载三项产物校验大小与 SHA-512。退出码 0，返回 `candidateId=electron:beta:0.1.1-beta.1`、`status=verified` 及预期清单 URL。
6. 管理后台重新加载后，显示该版本、公钥验签成功、来源提交、2 个平台/3 份文件；schema 2 强制更新禁用，发布记录为“尚未发起版本发布”。未点击发布或创建 rollout。

私钥仅在 prepare-upload 进程内存中使用；注册 token 仅在 register-upload 进程内存中提供，不输出或写入文件。未提取 MCP 会话凭据、复制主账号 API Key、新建 CAM 身份或启用 COSCLI 上传。Ed25519 证明清单来源和文件完整性，安装包仍未做 Apple/Windows 平台签名。

- [候选清单](https://askwenxue.com/desktop-releases/electron/beta/0.1.1-beta.1/candidate-manifest.json)
- [Windows x64 安装包](https://askwenxue.com/desktop-releases/electron/beta/0.1.1-beta.1/win32/x64/WenXue-0.1.1-beta.1-win-x64.exe)
- [macOS arm64 安装包](https://askwenxue.com/desktop-releases/electron/beta/0.1.1-beta.1/darwin/arm64/WenXue-0.1.1-beta.1-mac-arm64.dmg)
- [问学版本后台](https://askwenxue.com/admin/#releases)

## 验收边界与下一步

- P4.1–P4.3 完成；P4.5 保留部分完成，同字节复用、异哈希冲突拒绝及半成品恢复尚未在本轮真实演练。P4.6 的 N+1 尚未准备。
- `0.1.1-beta.1` 高于已验旧包 `0.1.0`，作为过渡版 N；历史首轮 `0.0.1-beta` 只是构建试跑，不作为升级目标。
- Windows 下载与覆盖安装、保留资料、核对版本和启动 CfT/插件的步骤已发给用户，等待实机结果；macOS 人工覆盖与启动仍待验收。自动化通过不能替代两端安装、N→N+1 升级及 Profile/登录状态/历史保留证据。
- Mac 测试账号 A 的公告此前已由用户目视看到并点击确认；服务端回执独立核验、在线时延、离线补发和跨设备去重仍待补齐，P3 不标完成。
- 后续推进 P5/P7 实机与两跳测试、P6 官网同源下载入口和发布流程。准备具体版本/范围/说明及证据后再执行受控发布；当前没有正式 rollout。
