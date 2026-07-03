# 修复 dev 启动与 tokens 初始化卡住

- **日期**：2026-07-01
- **关联**：F8 Tokens 消耗统计 / F9 本机机器 token 与网关会话
- **会话上下文**：用户反馈重启后 `machine-token:get` 无 handler，随后 `pnpm dev` 因 Electron spawn ENOENT 失败。

## 做了什么
- 修复本机 `electron` 依赖的残缺安装：`path.txt` 末尾换行导致 spawn 路径包含 `\n`，且 `dist` 缺少 `Electron Framework.framework`；已备份残缺 `dist` 并重新运行 Electron install 解压完整缓存。
- 为 `UsageCloudClient` 增加云端 usage summary 请求超时，避免 CloudBase `/v1/usage/summary` 长时间 pending 时启动器 tokens / machine id 一直停留在“正在准备”。
- 增加 pending cloud request 的回归测试；超时后继续走 `DesktopBridge` 既有本地 tokens 兜底路径。

## 提交
- 未提交，工作树已有一组未提交的机器 token 迁移改动；本次只在其上追加修复并保留用户现有改动。

## 状态变更
- 架构文档：未改。
- 需求/UI 文档：未改。
- 测试：`PATH=/Users/outas/.nvm/versions/node/v22.22.3/bin:$PATH node_modules/.bin/vitest run src/main/UsageCloudClient.test.ts src/main/DesktopBridge.test.ts src/main/MachineTokenStore.test.ts` 通过，17 tests passed。
- 构建：`PATH=/Users/outas/.nvm/versions/node/v22.22.3/bin:$PATH node_modules/.bin/electron-vite build` 通过。

## 下一步
- 建议后续把启动器首屏 machine token 加载与 tokens summary 加载进一步拆分，让 Machine ID 不必等待云端 usage 超时。
- 建议日常 dev 使用 Node 22 + pnpm 9.15.0，避免 pnpm 11 触发依赖目录重装确认。
