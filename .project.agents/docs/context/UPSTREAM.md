# UPSTREAM — page-agent vendor 记录

> 对应 ARCHITECTURE 不变量 I5。任何对 `packages/@page-agent 四包` 与 `apps/extension` 上游部分的改动，先登记本文再动代码。

## 当前快照

| 项 | 值 |
|---|---|
| 上游 | https://github.com/alibaba/page-agent.git |
| 基准 | tag `v1.9.0`（2026-06-08 发布） |
| 上游 commit | `3a2f0a41ec697896730dc1b81b437e3842ac5e18` |
| 本仓 pristine 导入 commit | `f5131c2` |
| 本仓适配补丁 commit | `2476e12` |
| 导入范围 | packages/{core,llms,page-controller,ui} → packages/*；packages/extension → apps/extension；LICENSE+NOTICE → third_party/page-agent/ |
| 未导入 | packages/{page-agent,mcp,website}、scripts/、根配置（root 由本仓自管） |

## 本地补丁清单（相对 pristine）

| # | 文件 | 改动 | 原因 |
|---|---|---|---|
| P1 | apps/extension/package.json | name → `extension` | 对齐 `pnpm -F extension`；应用层 fork 不受 I5 约束 |
| P2 | apps/extension/package.json | `@page-agent/*` 依赖 → `workspace:*` | 指向本仓 vendor 包 |
| P3 | apps/extension/package.json | +devDep `zod@^4.4.3` | peer 依赖在 pnpm 隔离下无提升来源 |
| P4 | packages/llms/package.json | +devDep `vitest@^4.1.8` | 同上，test 脚本所需 |

## 已知差异与遗留

- 上游 `wxt.config.js` 保留其官方 manifest `key`：未打包加载与商店版 PageAgent 共享扩展 ID，**两者不可同时安装**；M4 更换为问学自有 key。
- 上游根 `overrides`（uuid、web-ext-run>tmp）未引入；install/audit 出问题时按需补 `pnpm.overrides` 并在此登记。
- lib 四包的 `build`/`prepublishOnly`/`postpublish` 脚本在本仓为惰性脚本（源码直出，不发布）。

## 手动同步流程（升级上游时）

1. `git clone --depth 1 --branch <新tag> https://github.com/alibaba/page-agent.git /tmp/pa-new`
2. 逐包 `diff -ruN <本仓包目录> /tmp/pa-new/packages/<包>`，剔除 P1–P4 与 M4 品牌化改动后评审 diff；
3. 挑拣合入（不整目录覆盖），重跑本计划 Task 5 验证；
4. 更新本文快照表与补丁清单，commit message 注明新旧 tag。