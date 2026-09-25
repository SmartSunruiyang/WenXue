# 本机发布工具 COSCLI v1.0.8 就绪

- **日期**：2026-09-26
- **关联**：正式发布计划 P4.1 本机发布工具条件核验
- **会话上下文**：补充本机已固定 COSCLI 版本的来源与校验记录。

## 做了什么

- 从 [腾讯云 COSCLI v1.0.8 官方 GitHub release](https://github.com/tencentyun/coscli/releases/tag/v1.0.8) 获取 macOS arm64 二进制：`https://github.com/tencentyun/coscli/releases/download/v1.0.8/coscli-v1.0.8-darwin-arm64`。
- 腾讯云[官方下载与安装配置文档](https://intl.cloud.tencent.com/zh/document/product/436/43265) 的 macOS-arm64 SHA-256，与 GitHub release asset 摘要一致。
- 将工具保存在主仓忽略目录：`/Users/outas/WebstormProjects/WenXue/.cloudbase-deploy/tools/coscli-v1.0.8`。文件大小为 `13,631,554` bytes，SHA-256 为 `df0018fbf78b552cbe875ebe26e8bdf7938c7f4394959f913dfc2ea4d1252568`。官方值核对通过后设置执行权限，并在同一专用目录建立 `coscli` 入口。
- 主 Agent 独立复核了 `shasum -a 256`，并通过该目录临时前置 PATH 运行 `coscli --version`，输出 `coscli version v1.0.8`。调用示例：`PATH="/Users/outas/WebstormProjects/WenXue/.cloudbase-deploy/tools:$PATH" coscli --version`；没有修改全局 PATH 或系统安装目录。
- 未读取 COS 配置或凭据，未执行 COS 上传或其他 COS 网络操作。

## 提交

- 与更新器研究及安装包核验记录同批提交：`docs(infra): record installed client and local publisher readiness`。

## 状态变更

- 架构文档：未修改。
- 需求文档：未修改。
- 测试：仅做工具完整性（大小、SHA-256）和 `--version` 检查；未执行发布或 COS 操作。
- 本机发布私钥位置已向用户询问，尚待回复；专用最小权限 COS 配置与候选登记凭据仍待核验。因此仅工具二进制就绪，不代表本机发布或候选发布就绪。

## 下一步

- 等待用户回复私钥位置，并继续核验专用最小权限 COS 配置与候选登记凭据；不得据此记录 publish 已就绪。
