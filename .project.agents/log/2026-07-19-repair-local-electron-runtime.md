# 修复 macOS 26 本地 Electron 运行时

- **日期**：2026-07-19
- **关联**：当前 Electron + Chrome for Testing 运行时；`TECH-INFRA.md §8.1`
- **会话上下文**：全仓构建已通过，但实际启动 Electron 时出现缺少
  `Electron Framework.framework` 的 dyld 错误。

## 做了什么

- 用 Node 22.22.3 / pnpm 9.15.0 复现 `electron --version` 启动失败。
- 确认 `electron@33.4.11` 的本地 `dist` 只有 256 KB，缺少 Framework、Helpers 和
  `Info.plist`；安装脚本仅检查主程序存在，因此误把半截解压结果当成完整安装。
- 校验两份本地 Electron ZIP 缓存：SHA-256 均与包内 `checksums.json` 一致，ZIP 完整性通过，
  且压缩包包含缺失文件。
- 将损坏的 `dist` 暂存到 `/tmp`，从已校验缓存重新解压；完整 `dist` 恢复为 242 MB。
- macOS 26.5 会拒绝这份没有 bundle 级签名的旧版 Electron.app。对本地开发依赖执行 ad-hoc
  深度签名后，`codesign --verify --deep --strict` 与 Electron 启动均通过；未关闭 SIP 或
  Gatekeeper，未使用发布证书。
- 完成验证后结束冒烟进程，并删除 `/tmp` 中 256 KB 的损坏备份。

## 提交

- 无业务代码提交：本次修复只修改 gitignored 的本地 `node_modules`；本文件作为排障记录单独提交。

## 状态变更

- 架构文档：未修改；模块、依赖与接口没有变化。
- 基础设施文档：未修改；没有改变仓库构建流水线或 Electron 版本。
- 验证：
  - `pnpm -F desktop exec electron --version` → `v33.4.11`
  - `pnpm build` → 通过
  - `pnpm dev` → Electron 主进程成功启动并持续运行超过 20 秒，无 dyld / SIGKILL

## 下一步

- 当前工作区已恢复。若未来删除并重装 `node_modules` 后 macOS 26 再次拒绝 Electron 33，需重新
  ad-hoc 签名，或单独评审升级到仍受支持的 Electron 主版本；本次不擅自改变运行时版本。
