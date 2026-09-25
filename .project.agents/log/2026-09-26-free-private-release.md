# 免费私有仓库构建与本机候选发布工具完成本地验收

- 日期：2026-09-26
- 关联：正式发布/公告/更新实施计划 P1.5、P4；不代表 P1 或 P4 整段验收。
- 用户决定：保持 GitHub 私有仓库与免费套餐，不购买 Pro、不公开仓库。
- 执行分支：`codex/release-notifications-updates`，隔离 worktree；原工作区保持干净。

## 完成内容

- GitHub 只做无发布凭据的构建与测试：main、workflow_dispatch、首轮 run，显式完整
  `expected_commit` 必须匹配实际 SHA。两个安装包与 seal artifacts 保留 1 天，仅手动触发。
- 退役依赖受保护 Environment 的 `desktop-release-publish.yml`。本机对具体提交的审阅是发布
  信任边界，不能表述成等价于 GitHub 分支保护。
- 新增 `publish-local-candidate.mjs prepare|publish`。prepare 要求干净、正确 origin/HEAD/version
  的 checkout，验证 GitHub 源 run，下载三个唯一且未过期的 artifacts，核对真实 seal、安装包
  字节、公钥指纹，生成无凭据 review。目录必须事先不存在。
- publish 每次重核上述来源与字节，并要求操作者显式传入已确认的 artifactSetSha512；随后复用
  evidence、Ed25519 candidate、COS 不可变上传、公开回读与注册工具，不执行下载目录的代码。
- COSCLI 固定 1.0.8，版本控制必须 Closed；HTTPS 注册禁止跳转，30 秒超时覆盖响应正文，最多
  尝试三次；按实际响应校验 releaseId、manifestUrl、verified 状态。不会创建 rollout。
- GitHub API/下载显式固定 github.com；子进程默认移除签名私钥和注册 token，只有签名步骤拿到
  私钥，注册 token 留在父进程。外部命令与注册错误不回显原始 stderr、响应正文或凭据。
- PRD、ARCHITECTURE（新增 DesktopReleaseTooling）、TECH-INFRA 操作步骤、ROADMAP 与实施计划
  同步；现有注册 target/token 配置名保留，实际调用者改为本机工具。

## 提交

- `073865d` `ci(infra): support local publishing with free private builds`
- 基线为 `f0e3051`；先前双目标契约与主线同步见 `2026-09-26-release-two-targets.md`。
- 本日志单独补交，记录以上已完成提交；没有 push、真实 CI 运行、上传、注册、rollout 或部署。

## 验证

- Node 22.22.3：`node --test apps/desktop/scripts/*.test.mjs`，28/28 通过。
- 新入口覆盖真实临时安装包/seal/签名，模拟 gh、COS 与注册边界：脏 checkout、提交/来源错误、
  artifact 缺失/重复/过期/结构错误、公钥或确认 hash 不匹配、安装包篡改均拒绝。
- 发布后半段：COSCLI 版本不符、非 Closed、上传失败、公开校验失败都不能注册；持续注册错误
  只尝试 3 次且错误不泄露响应正文/token。成功路径顺序通过，不冒称已实测远端上传。
- `pnpm lint:desktop-release` 通过，包含新增脚本及测试；改动代码和 workflow 的 Prettier 检查
  通过；`git diff --check` 通过。
- workflow 经 YAML 解析，提取真实 bash guard 执行：合法输入通过，错误分支、事件、run attempt、
  不同/短/非 hex/大小写不匹配的 SHA 全部拒绝；三个上传步骤 retention-days 均为 1。
- 本轮仅改变构建发布工具，运行相关脚本回归；上一轮全仓 1602 项测试基线保留，不声称本轮重跑。

## 已核实的外部阻碍

- GitHub CLI 已登录并可读取私有仓库；`git ls-remote origin` 无 refs，仓库 API size 为 0，
  `default_branch` 元数据为 main。没有可运行的远端目标 workflow。
- HEAD 中 `apps/website/public/assets/wenxue-work-demo.mov` 为 163,686,355 字节（约156.1 MiB），
  首次加入 `a6b8f85`；同一 blob 仍在历史中，超过普通 GitHub 100 MiB 限制。只删除当前文件或
  当前版本改用 LFS，不能清除已有历史中的超大 blob。未删除/压缩视频，未改写历史。
- 本机 `git lfs version` 返回命令不存在。建议下一步先备份，在独立副本迁移此视频历史至 LFS，
  对比源码与视频原字节后再处理首次推送；迁移会改变后续提交 SHA，尚待用户选择与确认。
- GitHub 浏览器会话未登录，账单页不可读，无法核实 Actions 硬停止预算；CLI 登录不代表浏览器
  登录。未修改账单、付款方式、套餐、预算或仓库可见性。真实构建前须确认免费额度与超额停止。
- 本机发布私钥、专用最小权限 COS 身份、COS Closed 及注册凭据仍待安全核验；不得以 Gateway
  高权限凭据代替。双目标 AdminApi 契约尚未部署，登记真实双目标候选前必须先部署。

## 下一步

1. 处理超大视频的历史存储方式，再合并已验收提交并首次推送；保留原仓库与可恢复备份。
2. 核验 Actions（若采用 LFS 则同时核验 LFS）免费额度与硬停止预算，配置两个公开构建变量。
3. 完成 P2 契约与 P3/P5/P6 实现，按依赖推进；只在冻结提交上做真实 P4 构建/本机发布及 P7 双平台验收。
4. 两个 ACTIVE 测试账号仍需客户端实际登录和通知定向/非目标/离线补发/确认去重测试；不在日志写完整邮箱、UID 或凭据。

## 本轮核验来源

- [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)：
  标准 macOS arm64 和 Windows x64 runner 的适用性。
- [Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、
  [预算设置](https://docs.github.com/en/billing/how-tos/set-up-budgets)：免费额度与超额限制必须结合实际账号核验。
- [GitHub 大文件限制](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)：
  普通 Git 文件上限 100 MiB。
- [Git LFS 计费](https://docs.github.com/en/billing/concepts/product-billing/git-lfs)：当前 Free 包含
  10 GiB 存储与下载带宽，LFS 零预算阻止超额，删除预算会允许计费；账号实际设置尚未核实。
