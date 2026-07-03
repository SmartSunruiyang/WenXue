# 修复桌面端 dev 启动依赖漂移

- **日期**：2026-07-01
- **关联**：桌面端启动链路 / TECH-INFRA pnpm workspace 配置
- **会话上下文**：`pnpm -F desktop dev` 因 `electron-vite@2.3.0` 解析到 `vite@8.0.16` 报 `splitVendorChunk` 导出缺失。

## 做了什么
- 给 `apps/desktop` 显式声明 `vite@^5.4.21`，让 `electron-vite@2.3.0` 的 peer 依赖落在其支持的 Vite 4/5 范围内。
- 将 pnpm override 从已被 pnpm 11 忽略的 `package.json#pnpm.overrides` 移到 `pnpm-workspace.yaml#overrides`。
- 在 `pnpm-workspace.yaml#allowBuilds` 批准 `electron`、`esbuild` 等安装期构建脚本，避免 pnpm 11 安装后 Electron/Vite 二进制不完整。
- 补充根目录 `.nvmrc`，与 TECH-INFRA 中的 Node 22 LTS 要求对齐。
- 本地恢复了一次 `node_modules` 下半安装的 Electron 包，补齐 `dist` 与 `path.txt`。

## 提交
- 未提交；工作树在开工前已有大量未提交改动，本次保持未提交以避免混入用户已有工作。

## 状态变更
- 架构文档：未改动。
- 需求/UI 文档：未触发回归。
- 测试：执行 `pnpm install --lockfile-only`、`CI=true pnpm install`、`pnpm --filter desktop why vite electron-vite --depth 2`、`pnpm -F desktop dev`。dev 已通过 main/preload/renderer 构建并启动 Electron；最后由人工 `Ctrl-C` 停止。

## 下一步
- 切换到 Node 22 LTS 后继续运行；本机当前 shell 为 Node 26.1.0，已观察到 Electron 安装脚本依赖的 `extract-zip` 在 Node 26 下行为异常。
