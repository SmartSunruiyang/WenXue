# CloudBase LLM Gateway M6 全链路收口完成

- **日期**：2026-06-28
- **关联**：CloudBase LLM Gateway 计划 M6 / PRD F4、F8、F9 / ROADMAP M4.5 后续
- **会话上下文**：M0–M5 已完成网关部署、产品用户登录、插件会话交接、内置模型切网关、tokens 云端读取与删除本地内置 Key。

## 做了什么
- 完成真实链路联调：CloudBase Auth 外部产品用户登录 → CloudBase LLM Gateway `qwen-plus` 非流式调用 → `token_usage` 计量落库 → `/v1/usage/summary` 读取 tokens 页数据。
- 确认产品用户身份为 `external`，未使用企业成员/管理侧账号作为产品用户。
- 完成文档收口：PRD、ARCHITECTURE、TECH-INFRA、ROADMAP 与 CloudBase 网关计划均已同步到 M6 当前实现。
- 写入 M4、M5、M6 执行日志；M0–M3 日志已在此前会话完成。

## 提交
- 未提交，工作树仍包含连续推进的 M0–M6 变更及此前已有 UI/计划改动；本会话未执行 git commit。

## 状态变更
- 线上网关：`wenxue-llm-gateway-006` 正常，100% 流量。
- 内置模型路径：插件内置文本 `qwen-plus`、视觉 `qwen3.7-plus` 只走 CloudBase Gateway；自定义 BYO-Key 模型仍本机直连。
- 用量路径：启动器 `tokens:getSummary` 云端优先，云端失败时回退离线缓存/本地 `TokenUsageStore`。
- 本地 Key：扩展源码、扩展构建产物、桌面构建产物均未命中真实内置百炼 Key。

## 验证
- M6 smoke：外部产品用户登录成功，`/auth/v1/user/me` 返回 `type=external`；`POST /v1/chat/completions` 返回 200，单次 usage total `12`；`GET /v1/usage/summary` 返回 200，summary total `6036`，`qwen-plus` 聚合可见，返回体敏感字段/uid 检查为 false。
- M4/M5 累积验证：
  - `llm-gateway`：16 tests passed；typecheck passed。
  - `desktop`：targeted UsageCloudClient/DesktopBridge 14 tests passed；node/web typecheck passed；full test 64 tests passed；build passed。
  - `extension`：targeted runtime/model 65 tests passed；full test 360 tests passed；build passed（仅既有 es2025 / react-babel 警告）。
  - 真实内置百炼 Key 指纹全仓扫描：无命中。

## 下一步
- 后续单独推进 `usage-rollup` 与按价目表精确成本估算。
- 若准备提交，先梳理当前脏工作区，把 CloudBase 网关链路与既有 UI/遥测改动分成可审查提交。
