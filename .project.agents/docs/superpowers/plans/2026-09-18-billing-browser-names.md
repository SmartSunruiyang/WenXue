# 修复账单浏览器画像归属与名称

依据：`../../context/ARCHITECTURE.md` 的 UserSessionHandoff、DesktopBridge、ConsoleUI、
CloudBaseLlmGateway 模块与 §3.2 契约；`../../context/UIUX.md` 的 Tokens 页面规范。

## 已确认的问题

启动交接未携带画像 ID，云端计量未保存画像归属；`toTokenUsageRecord` 将记录统一写为
`browserId: 'cloud'`。账单页直接展示汇总 label，未用当前画像 displayName 映射。
已用单条带 `browserId: 'browser-1'` 的记录复现汇总仍返回 cloud。

## 修复设计

- DesktopBridge 在校验账号与画像归属后，将 `{ ...session, browserId: profileId }` 交给
  UserSessionHandoff。账号会话本身不绑定某个画像，不改变 UserSessionStore。
- 扩展 session 保存可选 browserId，刷新登录凭据时保留画像归属。画像 ID 只允许 1–128 位
  ASCII 字母、数字、下划线、短横线；无画像信息的旧 session 继续可用。
- 仅内置模型使用现有 LLMConfig.customFetch 向网关携带 `X-WenXue-Browser-Id`，普通 Agent、
  视觉与解题调用共用配置；自定义 BYO-Key 请求不带该字段，无需修改 vendor。
- 网关验证画像 ID（同一字符约束），仅作为鉴权 uid 下的统计维度写入 browserId。用户身份仍
  只来自 bearer 鉴权；画像 ID 不参与授权，不向 DashScope 转发该头，也不上传画像名称。
- 云端 summary 保留画像 ID；没有归属的历史记录保留 cloud 分组及原数值，不推测或迁移归属。
- Tokens 页面按稳定 ID 查询当前画像 displayName，重命名后同步反映在展示和导出 label 中；
  cloud 显示“未关联浏览器”，无法在本机找到的画像保留 ID 作为区分。布局、字体、颜色与现有
  Tokens 页面一致，仅修复标签数据。

## 实施与验证

- [x] 补齐启动交接与扩展请求的 browserId，验证 session 刷新、不同画像、自定义模型隔离。
- [x] 修复网关记录/读取/汇总，验证流式与非流式、分组总数、旧记录及无效 ID。
- [x] 修复账单名称映射和导出，验证多画像、重命名、cloud 与未知画像。
- [x] 执行相关单测、类型检查、构建与隔离页面运行验证。
- [x] 更新工程契约与执行日志，核对原有未提交改动保留。

验证结果见 [执行日志](../../../log/2026-09-18-fix-billing-browser-names.md)：215 项相关测试
通过，桌面/网关类型检查及桌面/扩展构建通过；扩展全量类型检查仍有 7 项基线已有诊断。

## 生效条件

仓库代码修复及生产网关部署均已完成：2026-09-18 网关 033 为 normal 并承接 100% 流量，
上线验证见 [部署记录](../../../log/2026-09-18-deploy-and-commit-workspace.md)。新的云端画像
分组还需运行更新后的启动器/扩展，已启动画像重新经过启动交接后获得 ID。历史无归属记录
无法可靠回填；本轮未发布新安装包或执行真实账号的计量写入验收。
