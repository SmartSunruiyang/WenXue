# 首次免费双平台 CI 与本机产物复核通过

- 日期：2026-09-26
- 关联：正式发布计划 P1.5、P4.1/P4.3/P4.5 的构建与 prepare 部分。
- 源码：`79b42ada2cd855ab645bab63aa01b27c7f463d70`，main 上手动首次运行。
- 构建：[GitHub Actions run 36188670852](https://github.com/SmartSunruiyang/WenXue/actions/runs/36188670852)。

## 完成与验证

- 用户完成 GitHub 浏览器登录；真实预算页显示账号 Actions 预算为 $0、Stop usage=Yes。
  构建前 GitHub Free 当月用量为 0/2,000 分钟、0/0.5 GB。保持私有仓库，不购买服务。
- 公开网关和 Ed25519 公钥变量已配置；发布私钥、COS 写入凭据和候选注册 token 未进入 GitHub。
- `workflow_dispatch` 输入同一完整源码 SHA、`version=0.0.1-beta`、`channel=beta`；
  `run_attempt=1`，最终 conclusion=success。
- quality 通过：冻结锁文件安装、版本/提交校验、发布 lint、全仓测试、Admin API/Gateway/Desktop
  类型检查、admin build、desktop build 与内嵌公钥校验。
- macos 与 windows 通过：CfT 拉取、扩展/桌面构建、未签名 DMG/NSIS 打包、包版本与最终 app.asar
  公钥绑定检查、artifact 上传；seal-artifacts 完成双目标原字节封存。
- Node 22 本机从同一 SHA 的干净发布工作树运行 `publish-local-candidate.mjs prepare`，
  复核 run 来源、attempt、workflow、commit、完整 artifact 列表、seal、原字节 SHA-512/大小和公钥，全部通过。
  下载目录为 `/Users/outas/Downloads/WenXue-CI-36188670852`，生成 `release-review.json`。

## 产物

| 产物 | GitHub artifact ID | 下载后安装包大小（bytes） |
| --- | --- | --- |
| `darwin/arm64/WenXue-0.0.1-beta-mac-arm64.dmg` | `10887284314` | 277101524 |
| `win32/x64/WenXue-0.0.1-beta-win-x64.exe` | `10887790385` | 220708684 |
| `release-build.json` | `10887645967` | — |

- 三个 GitHub artifacts 在下载时均未过期，远端保留 1 天；本地下载已完成。
- 公钥 SPKI SHA-256：`bbacf14f6a6de5f743cf499bd85ccad61434d83f8f110ae4119b2b02eb01c336`。
- artifactSetSha512：`ht7iaoh3JXGL8sbiCMBdK5vn7igkgSg9Xhd8Rsp/HaKhzM6V2FaQFBkCiwZwGZVFiMVCv+P3SmvfitZEi/GsLg==`。
- DMG SHA-512：`BMFkQAmT/2QmqzhPQewfyVbocV5GGm53T8U4zjYVSRTYWzJ/GzGA/TMDVu9m/trZC0/+8NJfla6rui+syvcPTQ==`。
- NSIS SHA-512：`Jlb8lql7CM8NFt1cJ0lshrc3kVPFAaBGubsJowmHELDBG14bP6EGO7TfXoQvUNDeDffYqohJbjQpIphSIwNCIw==`。

## 验收边界与下一步

- 通过的是构建、打包、下载和完整性复核；没有启动安装包，没有实机安装/升级证据。
- 未签名上传 COS、注册 candidate、创建 rollout、发布公告、部署服务或网站。P1/P2/P4 保持未完成。
- `0.0.1-beta` 低于已核验旧包 `0.1.0`；本次是构建试跑，不能把它作为旧包的升级版本。
- 下一步补齐 P1/P2 的剩余条件与契约，推进测试账号公告闭环；正式候选注册前，核验本机发布私钥、
  专用最小权限 COS 身份、对象版本控制及注册凭据，并部署接受双目标清单的服务端。
- 后续客户端更新实现需要在新的冻结提交重新构建；不得把本次产物当成后来源码的构建证据。

## 提交与文档

- `79b42ad`：公开构建配置与免费预算预检记录，也是本次 CI 的源码提交。
- 本次结果与 TECH-INFRA、ROADMAP、实施计划同步，随当前文档提交保存；没有业务代码改动。
- 文档采用 `git diff --check` 验证，不重复执行已通过的 CI 测试。
