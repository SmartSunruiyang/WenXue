# Implementation Plan

- [x] 1. 建立生产基线与回滚清单
  - 记录三个服务规格、在线版本、HTTP 路由与静态托管状态
  - 验证当前 gateway 与 admin 公网入口状态
  - _Requirement: R1, R2, R3_

- [x] 2. 组合 Gateway、AdminApi 与 AdminConsole
  - 为 gateway 增加 AdminApi 别名 exports 和四条精确路由
  - 增加 `/admin` 静态 target、组合镜像 Dockerfile 与白名单 staging 流程
  - _Requirement: R1, R4_

- [x] 3. 完成本地验证
  - 运行 Gateway、AdminApi 测试与 typecheck
  - 构建 AdminConsole 并验证 Functions Framework 的 Admin 页面、assets 与新增 API 路由
  - _Requirement: R1, R4_

- [x] 4. 灰度发布组合 Gateway
  - 已回滚不完整且未承接流量的灰度版本 `022`
  - 已在保留现有 EnvParams 的前提下发布组合运行时 `023`
  - 已按 5% → 25% → 50% → 100% 完成验证与切流
  - _Requirement: R1, R2, R4_

- [x] 5. 切换后台 HTTP 路由
  - Gateway `023` 达到 100% 后，已用直连域名验证 AdminConsole 与 AdminApi
  - 已将 `/admin`、`/admin/`、`/admin/assets/*` 上游切到 `wenxue-llm-gateway`
  - 已将四条 `/api/admin/v1/*` 上游切到 `wenxue-llm-gateway`
  - 原域名页面、资源与未登录 API 边界已通过线上回归
  - 因无可用管理员凭据，浏览器验证止于登录页正常渲染，未执行真实登录和登录后操作
  - _Requirement: R1, R2_

- [x] 6. 缩容旧后台服务
  - 已把 `wenxue-admin-web` 版本 `006` 调整为 `MinNum=0`
  - 已把 `wenxue-admin-api` 版本 `009` 调整为 `MinNum=0`
  - 每步均验证主路径，服务和版本继续保留用于回滚
  - _Requirement: R2, R3_

- [x] 7. 下调唯一常驻 Gateway 规格
  - 配置发布 `024` 复用 `023` 镜像，已调整为 0.25C / 0.5GB、`MinNum=1`、`MaxNum=2`
  - 所有主要入口与实例状态均已通过验证
  - 约 21,420 点/月是固定计算配置估算；本次未购买资源包、未开启超限按量计费
  - _Requirement: R2, R3_

- [x] 8. 同步文档、实施日志与提交记录
  - 更新 ARCHITECTURE、TECH-INFRA 与 ROADMAP
  - 写入 execution log、配置资源点估算、实际落地状态和回滚方法
  - 提交组合运行时代码；线上实施记录随本次上线收口
  - _Requirement: R1, R2, R3, R4_
