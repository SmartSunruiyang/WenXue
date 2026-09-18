# 修复账单按浏览器统计的画像名称与归属

- **日期**：2026-09-18
- **关联**：[实施计划](../docs/superpowers/plans/2026-09-18-billing-browser-names.md)
- **授权**：用户明确回复“继续修复”，保留开工前已有未提交改动。

## 根因与变更

启动交接没有携带画像 ID，网关计量未保存它，云端 summary 将每条记录的 browserId 固定为
cloud；Tokens 页面直接渲染 label，没有关联当前画像名称。

- DesktopBridge 校验账号与画像归属后，交接 `{ ...session, browserId: profileId }`，不修改
  账号级 UserSessionStore。扩展保存可选画像 ID，刷新凭据时保留原归属。
- 内置文本、视觉与解题模型通过现有 customFetch 携带 X-WenXue-Browser-Id；自定义 BYO-Key
  模型不添加它。普通 Agent 的配置转交已补齐 customFetch，避免此路径丢失归属。
- 网关校验 ID、保存流式/非流式调用的画像维度，数据库读取和汇总保留该字段。画像名称不
  上传，画像 ID 不用于授权、不转发至 DashScope；历史无归属记录保留 cloud 及原始数值。
- Tokens 页面及导出的分组 label 使用当前画像名称；重命名即时生效；cloud 显示“未关联
  浏览器”，本机不存在的画像继续用 ID 区分。
- 同步当前运行时 ARCHITECTURE 的实体、交接/请求/汇总契约、持久化和测试边界，以及 UIUX
  的 Tokens 规则。未新增模块、未修改 vendor、未改变目标 AI 浏览器文档。

## 验证

- 桌面 DesktopBridge、UserSessionHandoff、UsageCloudClient：41 项通过。
  handoff 测试需要临时 localhost 端口，沙箱内 EPERM 后使用允许本地监听的执行环境通过。
- 扩展 useAgent、userSession、runtimeModelConfig：91 项通过，覆盖 ID 校验、存储与刷新、多画像、
  Request/init/取消信号/鉴权头、自定义模型隔离。普通 Agent 转交回归先复现请求头丢失，再通过
  修复：从存储 session 加载模型、构造 Agent 配置，并经过真实 LLM/OpenAIClient 检查最终请求头。
- 网关完整单测：83 项通过；网关类型检查通过。
- 桌面主进程/renderer 类型检查、生产构建通过；扩展生产构建通过（保留既有 es2025 构建警告）。
- 扩展全量类型检查有 7 项既存错误，位于 TabsController.test.ts、cards.tsx、LogViewer.tsx、
  db.ts。用 TypeScript CompilerHost 将本轮四个 lib 文件替换为 HEAD 内容做只读基线对照，
  修改前后诊断完全相同；本轮未扩大到这些无关文件。
- 已完成代码的 ESLint、Prettier 与 git diff --check 通过。
- 合计 215 项相关测试通过；补齐普通 Agent 配置后再次构建扩展通过，类型检查仍为相同 7 项
  既存诊断。pnpm 过滤命令遇到包管理器联网解析失败后，使用已安装的包内 Node CLI 执行检查。
- 隔离 Electron renderer 使用临时画像与账单数据，阻止全部外部 HTTP 请求，验证两个画像名称、
  cloud 友好标签、未知画像 ID、总量不变。通过实际重命名控件把“研究主号”改为“论文资料库”，
  再进入 Tokens 确认更新；检查导出 Blob，名称更新且 key/数值保持不变。
  临时证据：`/private/tmp/wenxue-billing-qa/verification.json` 和 `billing-names.png`；预览已关闭。

## 提交

用户随后明确要求“部署并提交所有未提交改动”。本轮修复独立纳入
`fix(desktop): attribute cloud usage to browser profiles`，提交索引见
[部署与提交记录](2026-09-18-deploy-and-commit-workspace.md)。与开工快照核对的 UI/文档改动
已单独提交；通过索引快照分离重叠文件，没有回退或覆盖工作区源码。

## 后续与生效条件

- 本轮代码修复与本地验证完成，实施计划已勾选；已有扩展全量类型诊断不在本轮修复范围。
- 生产网关已更新为 033，normal / 100% 流量；两个客户端入口已验证新画像 ID 校验生效，
  未执行真实账号/LLM 调用或修改历史数据。需使用更新后的启动器/扩展，并重新打开浏览器
  画像，让新调用带有归属；历史无归属记录无法可靠回填。完整上线证据见部署记录。
