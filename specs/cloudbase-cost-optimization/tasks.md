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

- [ ] 4. 灰度发布组合 Gateway
  - 环境恢复后先回滚不完整的 0% 灰度版本 022
  - 使用保留现有 EnvParams 的 GRAY 发布当前组合 staging
  - 按 5% → 25% → 50% → 100% 验证与切流
  - 当前阻塞：CloudBase 返回“环境已停服，请恢复环境后重试”
  - _Requirement: R1, R2, R4_

- [ ] 5. 切换后台 HTTP 路由
  - 新 Gateway 达到 100% 后，先用直连域名验证 AdminConsole 与 AdminApi
  - 将 `/admin*` 上游切到 `wenxue-llm-gateway`
  - 将 `/api/admin/v1/*` 上游切到 `wenxue-llm-gateway`
  - 验证原域名页面、资源与未登录 API 边界
  - _Requirement: R1, R2_

- [ ] 6. 缩容旧后台服务
  - 把 `wenxue-admin-web` 调整为 `MinNum=0`
  - 把 `wenxue-admin-api` 调整为 `MinNum=0`
  - 每步验证主路径并保留回滚版本
  - _Requirement: R2, R3_

- [ ] 7. 下调唯一常驻 Gateway 规格
  - 调整为 0.25C / 0.5GB、`MinNum=1`、`MaxNum=2`
  - 验证所有主要入口与实例状态
  - _Requirement: R2, R3_

- [x] 8. 同步文档、实施日志与提交本地准备
  - 更新 ARCHITECTURE、TECH-INFRA 与 ROADMAP
  - 写入 execution log、目标资源点估算、当前阻塞和回滚方法
  - 提交已完成的代码与文档；线上切流仍由 4–7 收口
  - _Requirement: R1, R2, R3, R4_
