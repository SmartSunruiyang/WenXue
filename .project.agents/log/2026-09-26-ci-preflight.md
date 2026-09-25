# 首轮 CI 公开配置与免费预算核验通过

- 日期：2026-09-26
- 关联：正式发布计划 P1.5 / P4.1；用户授权继续核实免费条件并试跑。
- 验证源码：`ebc903b30a2320378b4ed3178fced9485a96adf3`，当时 main 与发布 worktree 一致且干净。

## 本轮完成

- GitHub 仓库为 private、当前账号 ADMIN，`Desktop release build` workflow active，仅
  workflow_dispatch；run 与 artifact 均为 0。
- 初始 repository variables 为空，构建必需的 Ed25519 公钥缺失。
- 只读核验 CloudBase 环境 `wenxue-d8gz76tacc3659f05` 的 `wenxue-llm-gateway` 在线 036、normal；
  当前验签公钥与此前核验一致，解析为 Ed25519，SPKI SHA-256 指纹为
  `bbacf14f6a6de5f743cf499bd85ccad61434d83f8f110ae4119b2b02eb01c336`。
- 将同一公钥与现有 gateway origin 配置为 GitHub repository variables
  `WENXUE_RELEASE_ED25519_PUBLIC_KEY`、`WENXUE_GATEWAY_BASE_URL`，逐值回读一致。
  未向 GitHub 配置发布私钥、COS 凭据或候选注册 token，未更改 CloudBase 配置。
- 使用 Node 22、GitHub 上这两项公开配置、channel beta，在发布 worktree 运行
  `pnpm -F desktop build` 与 `verify-embedded-release-key.mjs --bundle apps/desktop/out/main/index.js`，
  两者通过，内嵌公钥指纹与服务端一致，构建后 tracked 工作区仍干净。
- 用户在内置浏览器完成 GitHub 登录。账单概览显示 GitHub Free、当月 Actions
  0/2,000 分钟与 0/0.5 GB；预算页账号级 Product Actions 为 $0，Stop usage=Yes。
  当前配置满足用户免费约束，不需要修改预算或购买服务。

## 尚未完成

- 预检阶段尚未触发 hosted runner；下一步启动真实 CI，结果另行记录。
  没有购买额度、升级套餐或改变仓库可见性。
- 尚未打包、上传、注册 candidate、创建 rollout、部署网站或修改生产业务。
- 当前 package 为 `0.0.1-beta`，可用于 CI 构建验证；后续真实升级候选的版本仍需按 P4.6 结合
  已分发旧包及最高发布记录确定，不能把这次构建试跑当成旧版用户的升级验证。

## 提交与下一步

- 本轮运行配置写入 GitHub；仓库只有本日志与 TECH-INFRA/实施计划的事实同步，随当前文档提交保存。
- 免费预算条件已核实；获取当时远端 main 完整 SHA，按
  package version / beta / expected_commit 手动启动首次 run；不要重跑旧 attempt。
- 若 CI 失败，读取具体失败 job/step 的日志，交由 Sol 修复并由 root 验收，再从新的首轮 run 验证。
