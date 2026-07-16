# 准备 CloudBase 单实例降耗并完成本地验收

- **日期**：2026-07-17
- **关联**：ROADMAP「M4.6 后续 — CloudBase 常驻实例降耗」；`specs/cloudbase-cost-optimization/`
- **会话上下文**：用户要求在完全不影响功能运行的前提下降低 CloudBase 云托管资源点消耗。任务开始时工作树干净；生产环境已耗尽本计费周期 40000 个环境资源点，未开启超限按量。

## 基线与冷启动结论

- 当前三个服务均配置 `MinNum=1`：
  - `wenxue-llm-gateway`：0.5C / 1GB
  - `wenxue-admin-api`：0.5C / 1GB
  - `wenxue-admin-web`：0.25C / 0.5GB
- 固定计算估算约 107100 点/月。目标只保留一个 0.25C / 0.5GB、`MinNum=1` 的 Gateway，约 21420 点/月，理论下降约 80%。
- 唯一业务 Gateway 不改为 `MinNum=0`。否则 LLM 流式请求、注册/激活、用量查询和后台首次访问都会进入冷启动路径，无法满足“完全不影响功能运行”。
- 旧 AdminApi/AdminWeb 只有在新 Gateway 100% 接管并通过原域名验证后才调为 `MinNum=0`；它们是回滚单元，不再承担主流量，因此其冷启动不影响正常功能。

## 做了什么

- 将 AdminApi 的四个公开 Function targets 直接复用到 `apps/llm-gateway`，没有复制管理业务逻辑。
- 新增 AdminConsole 静态 target：
  - `/admin`、`/admin/` 返回构建后的 `index.html`；
  - `/admin/assets/*` 返回正确 MIME，使用 `nosniff` 与 immutable cache；
  - 只允许 GET/HEAD，未知文件、未知深路径和目录穿越返回 404；
  - 静态文件以 `Promise<Buffer>` 单飞缓存，避免冷启动并发重复读取约 1MB JS。
- AdminConsole 构建显式固定 `/admin/` base、目标 CloudBase env/region，并清空外部 Admin API 与 access-key 环境覆盖，避免操作者 shell 残留 `VITE_*` 写入 bundle。
- Docker 组合镜像保留 monorepo 相对拓扑，包含 Gateway、AdminApi 源码与 AdminConsole dist。
- 增加白名单 staging 脚本：
  - 不上传仓库根目录、`.git`、本地依赖、环境文件或凭据；
  - 先删除旧输出，再在同目录临时 staging 中构建、扫描并原子替换；
  - Functions Framework 精确固定为 `1.18.2`。
- 编写需求、设计与执行任务，记录安全切换顺序：旧后台路由保持不变 → Gateway 灰度回归 → 新版本 100% → 直连验证 Admin → 批量切七条后台路由 → 旧服务 Min0 → Gateway 降规格。

## 线上操作与阻塞

- 成功构建 Gateway 灰度版本 `022`，保持 0% 流量，稳定版本 `021` 继续 100%。
- `022` 是 AdminConsole 合并前的中间版本，不能作为最终切换版本。
- 尝试把灰度流量调到 5% 和回滚 `022` 时，CloudBase 均返回：`环境已停服，请恢复环境后重试`；环境查询同时显示 `EnvActivated=no`。
- 未绕过灰度发布执行 FULL 切换，未购买资源点，未开启超限按量，也未修改任何计费配置。
- 正式七条后台 HTTP 路由、稳定 Gateway 021 和三个服务规格均未改变，因此当前没有实际资源点下降，也没有引入新的线上功能影响。
- 静态托管路径实验的隔离探针路由，以及本轮上传的 `admin/`、`__admin_probe/` 文件均已删除；静态托管不是最终方案。

## 验证

- Gateway：43 tests 通过；TypeScript 检查通过。
- AdminApi：15 tests 通过；TypeScript 检查通过。
- AdminConsole：`tsc --noEmit && vite build` 通过；仅保留既有的单 chunk 大于 500KB 警告。
- 白名单 staging：12 个文件，约 1.1MB；不含敏感文件或符号链接。
- staging 内 Functions Framework 1.18.2：
  - `/healthz` 返回 200 与 `admin-runtime-consolidated-v2` revision；
  - `/admin` 返回 200 HTML，引用 `/admin/assets/*`；
  - JS 返回 200、正确 `text/javascript`、immutable cache；
  - CSS `HEAD` 返回 200、正确 MIME 与实际 `Content-Length`；
  - AdminApi 无 bearer 返回 401；
  - traversal 返回 404。
- staging 内 `npm install --omit=dev` 成功；`npm audit` 报告 Functions Framework 传递依赖 `uuid` 的 2 个 moderate 条目，当前无可用修复版本，且与现有运行时使用的同一 framework 依赖链一致。
- 根 workspace 的 `CI=true pnpm install --frozen-lockfile --ignore-scripts` 仍因既有 `pnpm-workspace.yaml` overrides 与锁文件元数据不一致而失败；非 frozen 重写会产生约 378 行与本任务无关的 lockfile 变化，因此本提交只保留 Gateway 精确版本对应的单行 specifier 更新。
- 当前环境没有可用的浏览器控制工具，且生产环境停服，因此未执行真实管理员登录点击和生产新版本页面验收；不能把它们表述为已完成。

## 文档

- ARCHITECTURE：CloudBaseLlmGateway 更新为组合运行时；AdminApi 保持单一业务实现；AdminConsole 目标由 Gateway 同实例提供。
- TECH-INFRA：记录当前三实例基线、目标单实例配置、022/停服阻塞与正式路由未变。
- ROADMAP：新增 M4.6 降耗后续任务并标记本地准备完成、线上切流待恢复环境。
- PRD / UIUX：未改变产品功能、视觉、登录方式或外部协议，不触发产品需求与 UI 回归。

## 提交

- 本日志、实现、spec 与架构文档随同一提交入库；提交哈希以本文件所在 Git 提交为准。

## 下一步

1. 用户在 CloudBase 控制台恢复环境，或明确授权购买资源点/开启超限按量；本任务不擅自执行计费操作。
2. 恢复后先回滚 0% 中间版本 022，再部署当前完整 staging。
3. 按 5% → 25% → 50% → 100% 验证既有 Gateway 路径；100% 后再验证 Admin 直连并切七条 HTTP 路由。
4. 原域名验证页面、JS/CSS、AdminApi 与管理员登录后，依次把两个旧后台服务设为 `MinNum=0`，最后把 Gateway 调为 0.25C / 0.5GB、`MinNum=1`、`MaxNum=2`。
