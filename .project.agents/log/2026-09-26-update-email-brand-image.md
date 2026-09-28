# 验证码邮件品牌文字改用 slogan 图片

- **日期**：2026-09-26
- **关联**：用户对邮箱验证码邮件的视觉调整 / UIUX「邮箱验证码邮件」

## 做了什么

- 删除邮件头部独立排版的「问学」和英文 slogan，替换为现有 `wenxue-slogan.png`，120×40px，保持原始 3:1 比例并提供 alt。
- 同步 UIUX、TECH-INFRA 和邮件设计规格中的品牌资产说明。
- 刷新本地预览及 `.cache/email-verification-preview/` 中的桌面、手机截图。

## 提交

- 未提交：继续上轮同一邮件模板的审阅改动，用户未要求提交。

## 验证

- 公开 slogan 图片地址返回 HTTP 200 / image/png，浏览器确认图片已加载。
- 桌面与 320px 窄屏显示正常，`scrollWidth` 与视口宽度相等，无横向溢出。
- HTML Prettier 格式化与 `git diff --check` 通过。

## 下一步

- 模板继续供用户审阅；线上发信配置尚未替换。
