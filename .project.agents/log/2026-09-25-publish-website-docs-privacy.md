# 发布官网文档与隐私页面

- **日期**：2026-09-25
- **关联**：WebsiteSite；官网文档与隐私页上线

## 做了什么

- 确认官网源码已随 `2a5e691` 合入 `main`，官网目录没有未提交改动；原工作区的扩展改动未纳入本次发布。
- 在 CloudBase 环境 `wenxue-d8gz76tacc3659f05` 的静态托管中，先上传 `assets/index-InPJ7LvR.js` 和 `assets/index-DyCNQIP3.css`，确认公网返回 200 后更新 `index.html`。未删除旧资源，也未修改后台网关路由。
- 官网公开入口为 `https://askwenxue.com/`。

## 提交

- `fc117f9` feat(infra): 完善官网文档与隐私页面（原官网工作树提交）
- `2a5e691` feat(infra): merge website documentation and privacy pages（主线整合）
- 本日志与 `TECH-INFRA.md` 的上线记录同属本次文档提交。

## 状态变更

- 架构文档：未变更；仍归属 WebsiteSite。
- 部署文档：`TECH-INFRA.md` 记录本次静态站发布与验收。
- 测试：`pnpm -F website test` 6 项通过；`pnpm -F website build` 通过。
- 公网验证：首页 `index.html`、新 JS 和 CSS 与本地构建逐字节一致；真实浏览器可打开首页、文档和隐私页，备案链接可见，控制台无 error/warn；`/admin/` 返回 200。

## 下一步

- 隐私协议和用户须知当前公开标记为“发布前草案”，其中数据保存、模型服务商处理及官网托管配置仍待核对；核对后更新文案。
- 下载入口目前显示“准备中”，待安装包发布后接入真实下载链接。
