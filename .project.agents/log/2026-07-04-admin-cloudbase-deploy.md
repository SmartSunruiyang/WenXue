# 后台管理系统 CloudBase 公网同步

- **日期**：2026-07-04
- **关联**：Admin Console / Admin API / LLM Gateway / CloudBase Run
- **会话上下文**：用户询问后台重构是否已同步到公网；检查发现公网已有服务但更新时间早于本轮 `user_accounts.active` 与后台 UI 改动，因此执行部署。

## 做了什么

- 使用 CloudBase CLI 3.5.9 连接环境 `wenxue-d8gz76tacc3659f05`。
- 用公网 Admin API 地址重新构建 `apps/admin`：
  - `VITE_WENXUE_ADMIN_API_BASE_URL=https://wenxue-admin-api-4037646-1427406869.ap-shanghai.run.tcloudbase.com`
- 提交 CloudRun 容器部署并选择成功后自动切流：
  - `wenxue-admin-api`
  - `wenxue-llm-gateway`
  - `wenxue-admin-web`

## 公网服务

- AdminConsole：`https://wenxue-admin-web-4037646-1427406869.ap-shanghai.run.tcloudbase.com/`
- AdminApi：`https://wenxue-admin-api-4037646-1427406869.ap-shanghai.run.tcloudbase.com`
- LlmGateway：`https://wenxue-llm-gateway-4037646-1427406869.ap-shanghai.run.tcloudbase.com`

## 验证

- CloudRun list 显示三个服务均为 `Status=normal`：
  - `wenxue-admin-api` 更新时间 `2026-07-04 02:51:57`
  - `wenxue-llm-gateway` 更新时间 `2026-07-04 02:52:20`
  - `wenxue-admin-web` 更新时间 `2026-07-04 02:52:46`
- AdminConsole：公网根路径返回 200，标题为“问学后台管理”。
- AdminConsole 线上 JS 已包含公网 Admin API 地址和新的 tokens 字段文案。
- AdminApi：`/admin/v1/me` 未授权请求返回 401，CORS `access-control-allow-origin` 指向后台域名。
- LlmGateway：`OPTIONS /v1/auth/register` 返回 204，CORS 头正常。
- 浏览器 smoke：点过 CloudBase 测试域名提示后，后台登录页、内部账号输入框、密码输入框、登录按钮正常渲染；登录按钮在未填表单时禁用。

## 注意

- 当前使用 CloudBase 默认测试域名，首次访问会出现“页面访问提示”，需要点击“确定访问”。去掉提示需要配置自定义域名。
- 本轮未提交 git commit。工作树在部署前已有 unrelated extension / website 改动，本次只执行后台相关服务部署与日志记录。
