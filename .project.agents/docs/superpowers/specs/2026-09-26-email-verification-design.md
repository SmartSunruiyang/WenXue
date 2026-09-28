# 问学邮箱验证码邮件

- 日期：2026-09-26
- 上游：`../../context/PRD.md` F9、`../../context/ARCHITECTURE.md` ConsoleUI、`../../context/UIUX.md` §2–4 / §7。
- 范围：设计并交付 CloudBase 邮箱验证码 HTML；模板属于现有 ConsoleUI 认证流程的发布资产，不新增运行时模块或依赖。

## 交付与内容

- 单一源文件：`apps/desktop/email-templates/verification-code.html`。
- 通用文案覆盖邮箱登录、新邮箱验证和密码重置：品牌、验证邮箱标题、返回问学输入验证码的说明、验证码、有效期、保密与非本人操作提示、自动发送说明。
- 使用 CloudBase 官方变量 `{{.VerificationCode}}` 与 `{{.ExpireMinutes}}`；不写死验证码或有效期，不依赖业务用途的可选文案。
- 建议邮件主题「问学 · 邮箱验证码」；验证码不出现在标题或隐藏摘要中。
- 中文模板可分别配置到 `EmailConfig.TemplateConfig.DefaultTpl.ZhCN` 与 `RegisterSignIn.ZhCN`。本次仅交付文件与预览；线上配置状态独立记录。

## 视觉与兼容

- 沿用中性品牌：浅暖灰外底、白色信笺、黑色文字、细边框、16px 外圆角；内容最大宽度 560px。
- 使用现有问字 PNG（官网永久 HTTPS 地址），旁边以 `wenxue-slogan.png`（120×40px）替代「问学」与英文 slogan 的独立文字，保留图片 alt；禁用图片仍能读取全部验证信息。
- 正文使用项目系统字体，验证码使用等宽字体和 CSS 字距；验证码保持连续的单个文本节点，便于完整复制。
- 邮件主体使用 presentation table、内联样式和明确的背景色；窄屏媒体查询仅作增强。兼顾 Outlook 固定宽度与 96dpi。
- 无脚本、表单、外部字体、SVG、追踪像素、复制按钮或未实现的操作。

## 实施与验收

- [x] 登记现有认证资产归属，同步 PRD、UIUX 与 TECH-INFRA。
- [x] 实现单源 HTML 模板。
- [x] 格式检查与 HTML/变量检查。
- [x] 浏览器预览桌面、320/375px 窄屏、长变量、禁用图片和剥离 head 样式的降级表现。
- [x] 保留预览与执行日志，明确真实邮箱投递和客户端验收状态。

## 依据

- [CloudBase 验证码接口与模板变量](https://docs.cloudbase.net/http-api/auth/auth-send-verification)。
- 2026-09-26 只读查询 `queryAppAuth(getProvider, email)`：当前环境邮箱身份源开启，中文 DefaultTpl / RegisterSignIn 均为平台默认模板；SMTP 凭据未写入文件。
