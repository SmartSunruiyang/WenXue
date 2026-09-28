# 问学邮箱验证码 HTML 模板

- **日期**：2026-09-26
- **关联**：PRD F9 / ARCHITECTURE ConsoleUI / [设计规格](../docs/superpowers/specs/2026-09-26-email-verification-design.md)
- **会话上下文**：用户要求设计并开发邮箱验证码邮件 HTML；开工工作区干净。

## 做了什么

- 新增 `apps/desktop/email-templates/verification-code.html`，使用既有问字 Logo、暖灰外底、白色信笺与大号等宽验证码，内容覆盖当前邮箱验证用途。
- 使用 CloudBase 官方 `{{.VerificationCode}}` / `{{.ExpireMinutes}}` 变量，主题和隐藏摘要不包含验证码；内联样式、presentation tables、移动优先布局、Outlook 条件宽度及 96dpi 设置。
- 只读查询当前 email provider，确认 `DefaultTpl.ZhCN` / `RegisterSignIn.ZhCN` 仍为平台默认模板。未保存 SMTP 凭据，未改线上配置，未触发真实邮件。
- 同步 PRD F9、ARCHITECTURE 资产归属与目录、UIUX 邮件视觉、TECH-INFRA 模板变量和接入位置；不新增运行时模块或依赖。

## 提交

- 未提交：工作树保留本次 HTML、规格、同步文档和日志，便于用户审阅；用户未要求提交。

## 验证

- 模板 Prettier 检查通过；HTML 结构、两项变量、presentation tables 与无脚本/表单/外部样式检查通过。
- 既有公网 Logo 地址返回 HTTP 200 / image/png，浏览器成功加载。
- Codex 内置浏览器：1280px 桌面、320px / 375px 窄屏；验证码保持单行、完整文本，无横向溢出。
- 320px 验证八位长码与 120 分钟变量，以及移除 `<style>` 的降级页面；375px 验证图片加载失败，文字品牌、验证码和说明仍完整可读。
- 静态预览与桌面/手机截图在 gitignored `.cache/email-verification-preview/`；本地预览服务仅绑定 `127.0.0.1`，不公开发布。
- 仅增加邮件 HTML，不涉及 TypeScript/SDK/网关业务变更；未运行无关应用构建或全量测试。
- 浏览器检查不等于真实客户端兼容验证：尚未在 QQ 邮箱、Outlook、Apple Mail 收取本模板的真实邮件，未宣称上线或投递成功。

## 下一步

- 用户确认设计并要求应用后，将源 HTML 更新到 CloudBase 的两项中文模板字段，保留其他语言与发件配置，回读核对。
- 通过用户指定邮箱验证登录/注册与密码重置邮件，核对变量渲染、有效期和实际客户端显示。
