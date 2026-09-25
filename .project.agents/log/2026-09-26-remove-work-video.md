# 移除超大演示视频并完成 GitHub 首次推送

- 日期：2026-09-26
- 用户决定：“视频不要了”，对应上一轮指出的 156 MiB `wenxue-work-demo.mov`。
- 关联：正式发布计划 P4.1 首次推送条件；不代表 CI 或正式发布已完成。

## 变更与提交

- `ca2dc2c` `chore(infra): remove obsolete work demo video and references`
  （重写前为 `0c5013b`）：删除视频、首页 WorkDemo 及专属 CSS、文档中任务录屏区块；保留
  `wenxue-teaching-demo.mov`，原 `#browser-demo` 入口改为定位教学区块。
- PRD F12、ARCHITECTURE WebsiteSite、UIUX §12 与代码同步。ROADMAP、实施计划及
  TECH-INFRA 在本日志提交中更新当前状态；不再计划迁移视频至 LFS。
- 前序发布方案经干净工作区 fast-forward 合入 main。随后仅 main 与本轮发布分支切换到已验证
  的清理历史，未更改其他工作树、旧分支、stash 或 Codex 内部引用。
- GitHub 私有仓库首次普通 push 成功，没有 force push。远端 main 回读为
  `ca2dc2c0bcc10f9190ea1ade197b7cac9b244be1`；本日志提交随后 fast-forward 同步。
- Actions 中可见 `Desktop release build`，workflow id `367295350`、active；运行列表为空。

## 备份与历史核验

- 删除资产前已创建并通过 `git bundle verify` 的完整备份：
  `/Users/outas/WebstormProjects/WenXue/.git/release-backups/20260926-before-video-removal.bundle`。
  包含当时全部 refs 的完整历史；未上传此备份。
- 使用临时环境的 git-filter-repo 2.47.0，在独立 bare clone 中仅过滤
  `apps/website/public/assets/wenxue-work-demo.mov` 路径。保留空提交、合并拓扑、提交消息与编码；
  没有丢弃其他文件或压缩教学视频。
- 过滤前后均为 240 条提交，其中 90 条 SHA 改变；映射见
  [完整 commit map](2026-09-26-video-history-commit-map.txt)。旧日志中的 SHA 仍表示当时提交，
  可经映射找到清理后的版本，原 SHA 也仍可从备份恢复。
- 删除提交的原树与清理后的 HEAD 树均为
  `85db9aab8d42c0748afadebe30fe934cdd664560`，`git diff --exit-code` 为零。
  切换 main/发布分支时使用 soft reset，仅调整历史引用，两个工作区复核均干净。
- 对清理后 HEAD 的全部可达 blobs 扫描，无大于 100 MiB 的对象；该视频路径的历史为空。
  本地备份与旧工作树仍保留旧历史，因此不能把它们直接 merge 或 `push --all` 到已清理主线；
  后续工作应从新 main 开始，必要的独立补丁经审阅迁移。未删除失效的历史 worktree。

## 网站验收

- Node 22.22.3：website 现有测试 6/6 通过，生产构建成功。
- 改动 TypeScript 的 ESLint 无错误；未改动的 TiltButton 存在既有 button type 警告，本次没有
  扩大范围处理。Prettier 与 `git diff --check` 通过。
- dist 仅保留约 3.9 MiB 的教学视频，没有已删除的视频文件。
- 本地生产预览中点击首页“看演示”，定位到教学视频与三个步骤；文档“操作演示”只展示保留
  的教学区块，导航可见，控制台无 error。
- 未发布官网到 CloudBase，线上旧官网暂不改变。此次删除目标是源码、构建产物和待推送历史。

## 下一步

- 先核实 GitHub Actions 免费额度与超额停止预算，再触发第一轮双平台候选构建。此前账单页
  浏览器未登录，尚未取得预算证据，本轮没有自动启动 Actions 或购买额度。
- GitHub 公开变量及本机专用发布凭据仍待核验；继续按 P2–P7 实现及验收通知与更新链路。
- 历史清理不等于正式发布/通知/自动更新已经恢复。
