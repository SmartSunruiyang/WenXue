# CloudBase 云托管降耗需求

## 问题与范围

当前生产环境同时常驻三个 CloudBase Run 实例：

- `wenxue-llm-gateway`：0.5C / 1GB，`MinNum=1`
- `wenxue-admin-api`：0.5C / 1GB，`MinNum=1`
- `wenxue-admin-web`：0.25C / 0.5GB，`MinNum=1`

按当前资源点折算，固定计算消耗约为 107,100 点/月。目标是在不改变用户侧功能和既有公网入口的前提下，只保留一个 0.25C / 0.5GB 的常驻实例，将固定计算消耗降至约 21,420 点/月。

## 用户故事

1. 作为桌面端和插件用户，我希望模型调用、注册、激活与用量查询继续使用原有网关地址，不出现冷启动超时或功能退化。
2. 作为后台管理员，我希望继续从原有 `/admin` 地址登录并使用后台，不因部署形态变化而丢失同源登录状态。
3. 作为运维人员，我希望旧后台服务保留可快速回滚能力，但切换完成后不再持续消耗固定实例资源点。
4. 作为项目维护者，我希望 AdminApi 只有一份业务实现，合并运行时不能复制出第二套易漂移源码。

## 验收条件

### R1 — 现有业务入口保持可用

- 当客户端访问 LLM Gateway 现有 `/healthz`、`/v1/auth/register`、`/v1/auth/activate`、`/v1/chat/completions`、`/v1/usage/summary` 路径时，系统应保持现有协议、鉴权与响应行为。
- 当管理员访问现有 HTTP 网关 `/admin`、`/admin/` 与 `/admin/assets/*` 路径时，系统应在原域名下返回后台页面和静态资源。
- 当管理员调用现有 `/api/admin/v1/me`、`/api/admin/v1/usage/summary`、`/api/admin/v1/users`、`/api/admin/v1/user-status` 路径时，系统应保持原有 AdminApi 鉴权、CORS 和响应行为。

### R2 — 不引入冷启动功能退化

- 当任一客户端发起受保护业务请求时，系统应由至少一个常驻实例处理，不应把唯一业务网关设置为 `MinNum=0`。
- 当新版本上线时，系统应先通过灰度流量验证，再逐步接管全部生产流量；失败时应能立即把流量切回旧版本。

### R3 — 固定计算资源降至单实例

- 当合并服务完成生产验证后，系统应把 `wenxue-admin-api` 和 `wenxue-admin-web` 的 `MinNum` 调整为 0，同时保留服务与线上版本用于回滚。
- 当合并服务完成规格验证后，`wenxue-llm-gateway` 应运行在 0.25C / 0.5GB、`MinNum=1`、`MaxNum=2`。
- 当最终配置生效后，三个服务的固定最小实例总量应为 1。

### R4 — 单一实现与安全边界

- 当 LLM Gateway 承载 AdminApi 时，系统应复用 `apps/admin-api/src/index.mjs` 的公开适配器，不应复制 AdminApi 业务逻辑。
- 当 LLM Gateway 承载 AdminConsole 时，系统应从白名单 staging 中复制 `VITE_BASE_PATH=/admin/` 的构建产物，并只允许 GET/HEAD 访问 `/admin` 与 `/admin/assets/*`。
- 当构建组合镜像时，构建上下文应采用白名单 staging 目录，不应上传整个仓库、`.git`、本地依赖、环境文件或其他无关资料。
- 当部署已有服务时，系统不应读取、打印或重写现有敏感环境变量；未变更的 `EnvParams` 应由 CloudBase 保留。

## 非目标

- 本次不迁移 AdminApi 的 legacy `user_accounts` 状态模型。
- 本次不购买资源包、不开启超限按量计费。
- 本次不删除旧 CloudRun 服务或历史版本。
- 本次不依赖 CloudBase 静态托管完成后台切换。
- 本次不改变后台视觉、登录方式或 LLM 业务协议。
