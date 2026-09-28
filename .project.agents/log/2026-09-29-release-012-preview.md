# 合并现有工作并发布 0.1.2 preview

- 日期：2026-09-29
- 用户授权：合并并提交全部未合并改动，清理工作区，构建 0.1.2 preview，官网提供安装包并向全部用户发布更新。
- 范围：Windows x64 NSIS、macOS Apple Silicon DMG；preview 使用 beta 通道、optional、100%。旧协议客户端通过官网下载手动安装，不宣称旧协议可以自动接收 schema 2。

## 合并与保全

- `4b00079` 保存原主工作区邮件模板与当前需求/架构/视觉说明；随后合入 `origin/main` 的 15 个更新发布系统提交。
- `04564de` 账户昵称头像、`42102c0` 登录协议链接、`a6d05cc` Windows 品牌素材、`58b5c53` Windows 界面分别在原工作树提交，再合入主线。
- PRD 同一位置新增段落的冲突保留双方内容；App / EmailAuthScreen / MainBootstrap 自动合并后已审查，账户、协议、Windows 窗口控件、更新安装协调均保留。
- 旧分支中的有效补丁已等价合入；唯一旧 website demo 差异为此前用户要求删除大视频并重写历史造成，禁止重新带回旧 ancestry。两个旧 stash 已由历史整合审计涵盖，作为恢复备份保留，不覆盖当前实现。
- `e991a39` 将桌面、扩展、官网 package 统一为 `0.1.2-preview`，preview 默认 beta，界面显示 `0.1.2 preview`。

## 构建前核验

- Node 22.22.3、pnpm 9.15.0；frozen install、desktop 481 项 Vitest + 38 项 Node 测试、desktop typecheck、release lint 全通过。合并验证日志位于 `/tmp/wenxue-preview-integration-*.log`。
- GitHub 账单只读核验：Actions 185 / 2,000 分钟，存储显示 0 / 0.5 GB（页面取整）；gross $1.12、discount $1.12、billable $0；Actions budget $0、Stop usage Yes。未修改预算或购买额度。
- Keychain 发布私钥挑战签名通过，派生指纹与 GitHub 公钥一致：`bbacf14f6a6de5f743cf499bd85ccad61434d83f8f110ae4119b2b02eb01c336`；注册凭据存在。私钥与 token 仅在需要的进程内存中使用，不入文件、CI 或日志。
- 当前后端 `wenxue-llm-gateway-040` 正常、100% 流量。后续部署复用现有环境、端口、VPC、访问类型和运行规格。

## 发布状态

- 进行中：官网 preview 下载支持、冻结源码、双平台 CI、签名候选、托管上传、注册与 beta optional 100% 发布。
- 本记录所属提交用于构建前证据；CI run、最终源码 SHA、产物校验和线上结果将在后续独立提交补齐。
- 当前新版本尚未完成实机安装验证；不得以单元测试或候选 verified 代替双平台实机验收。
