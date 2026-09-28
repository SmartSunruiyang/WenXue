# 登录页正式协议链接

- 日期：2026-09-26
- 用户需求：登录页隐私协议链接使用正式网址，并增加用户须知。
- 所属模块：`../../context/ARCHITECTURE.md` §2.1 ConsoleUI，现有 `EmailAuthScreen`。
- 上游：`../../context/PRD.md` F9、`../../context/UIUX.md` §7、`../../context/TECH-INFRA.md` 正式域名记录。

## 实施范围

1. 隐私协议链接改为 `https://askwenxue.com/#privacy/privacy-policy`。
2. 在同一说明中增加「用户须知」，链接为 `https://askwenxue.com/#privacy/terms-of-use`。
3. 两个链接复用现有外链意图和链接样式；文案集中在 `strings.ts`，打开失败提示适用于两种协议。
4. 同步 F9 和登录页 UI 规范，更新既有链接测试，完成检查并写实施日志。

## 验证

- 检查正式网站两个 hash 路由实际显示对应内容。
- 运行 `EmailAuthScreen` 既有测试、桌面类型检查与构建；检查改动文件的格式和 lint。
- 查看登录页说明的排版与外链行为。

## 工作区

原工作区已有其他任务的未提交架构文档和邮箱验证设计，使用独立工作树
`/Users/outas/.codex/worktrees/login-legal-links/WenXue` 实施本次修改。
