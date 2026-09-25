# 官网页脚改用 slogan 图片

- **日期**：2026-09-25
- **关联**：WebsiteSite / 官网页脚品牌展示

## 做了什么

- 页脚品牌链接复用顶部导航的 `wenxue-slogan.png`，替换「问学 / ask for everything」两段文字；保留文档、隐私、用户须知及备案链接。
- 同步 `UIUX.md` 的页脚规则，并将新构建发布到 CloudBase 环境 `wenxue-d8gz76tacc3659f05` 的静态托管：先上传两个新哈希资源，再更新 `index.html`。
- 原工作区已有的扩展未提交改动未触碰。

## 提交

- `18ca59a` fix(infra): use slogan image in website footer
- 本日志与 `TECH-INFRA.md` 的上线记录同属本次文档提交。

## 状态变更

- 架构文档：未变更，仍属于 WebsiteSite。
- UI 文档：`UIUX.md` 记录页脚改用现有图片。
- 测试：Node 22 下官网构建通过，6 项测试通过，修改过的代码文件通过 Prettier 检查。
- 浏览器验收：桌面和 390px 手机视口页脚图片显示正常，手机无横向溢出；公网图片加载正常，浏览器控制台无 error/warn。
- 公网验证：`https://askwenxue.com/` 的 `index.html`、新 JS/CSS 与本地构建逐字节一致；`/admin/` 保持 200。

## 下一步

- 本次页脚修改已上线；后续官网迭代继续使用现有品牌图片资源。
