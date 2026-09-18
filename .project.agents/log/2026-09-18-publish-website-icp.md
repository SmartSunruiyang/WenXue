# 官网上线备案号页脚

- **日期**：2026-09-18
- **关联**：WebsiteSite 官网首页备案信息

## 做了什么

- 在 `apps/website/index.html` 增加首页底部备案链接，并通过 `public/assets/site-footer.css` 居中显示；文档页隐藏该页脚。
- 发布到 CloudBase 环境 `wenxue-d8gz76tacc3659f05` 的静态托管，先上传 `assets/site-footer.css`，再更新 `index.html`。
- 构建产物的原有 JS/CSS 哈希与线上文件一致；本次只更新上述两个托管文件，其他托管路径保持原样。

## 提交

- 随 `fix(infra): publish website ICP footer` 单独提交；提交索引见 [本日部署与提交记录](2026-09-18-deploy-and-commit-workspace.md)。

## 状态变更

- 架构文档：未变更，仍归属既有 `WebsiteSite` 模块。
- 需求/UI 文档：未变更，本次为首页备案信息的小范围呈现调整。
- 验证：官网 TypeScript 检查通过；Vite 构建通过；官网 4 项测试通过；本地和公网浏览器均确认首页底部备案号居中、链接指向 `http://beian.miit.gov.cn/`，文档页隐藏页脚；公网浏览器控制台无警告或错误。托管对象下载后与本地构建文件逐字节一致。
- 公网地址：`https://wenxue-d8gz76tacc3659f05-1427406869.tcloudbaseapp.com/`。该 CloudBase 默认测试域名首次访问会显示平台风险提示页。

## 下一步

- 19:10 按用户“部署并提交所有未提交改动”的授权，补齐 HTML 格式并重新发布 index.html；下载托管对象复核，index.html 与 site-footer.css 均和最终本地产物逐字节一致。
- 官网源码和发布记录作为独立提交归档。
