# 恢复 askwenxue.com 官网与后台入口

- **日期**：2026-09-18（Asia/Shanghai）
- **关联**：WebsiteSite / AdminConsole / CloudBase HTTP 网关；TECH-INFRA §7.2
- **工作区**：主工作区已有桌面端与文档的未提交改动，本次只修改云端路由；文档与日志在
  `codex/restore-askwenxue-domain` 的独立 worktree 中记录，未更改主工作区文件。

## 原因

- 公共 DNS 最初没有 `askwenxue.com` 的 A/CNAME 答案，CloudBase 显示 `DNSStatus=EMPTY`。
- 自定义域名只有 `/admin`，指向回滚用的 `wenxue-admin-web` 且关闭路径透传；该页面引用
  `/assets/`，无法与官网根目录资源共用，且官网和管理接口没有对应路由。
- 默认官网与默认后台入口均正常返回 200，既有运行服务和构建产物无需重新部署。

## 云端修改

- 用户选择自行配置阿里云 DNS，提供的记录为 `@ CNAME
askwenxue.com.tcbaccess.tencentcloudbase.com`；随后 Google Public DNS 实际返回该记录。
- 复用现有 SSL 证书，启用 `HTTP_TO_HTTPS`，接入方式仍为 `DIRECT`。
- 将 `/admin` 切换到现有 `wenxue-llm-gateway` 并开启路径透传。
- 新增 `/` → `STATIC_STORE/staticstore`；新增 `/admin/`、`/admin/assets` 和以下 10 条
  管理接口路由 → `CBR/wenxue-llm-gateway`，完整路径透传：
  `announcement-withdraw`、`announcements`、`me`、`release-candidates`、`release-publish`、
  `release-state`、`releases`、`usage/summary`、`user-status`、`users`，前缀统一为
  `/api/admin/v1/`。
- 新增前 `VerifyHTTPServiceRoute` 的证书、归属权、配额及路由冲突检查全部通过。
- 未改变安全域名白名单、应用鉴权、NoSQL 权限、容器版本、默认域名路由或计费设置。

## 验证

- 02:13 CloudBase 返回 `Status=SUCCESS`、`DNSStatus=OK`、`PlatformCnameDNSStatus=OK`，
  自定义域名下 14 条路由全部开启。
- 02:14 正常公网请求（不覆盖 DNS、不跳过 TLS 验证）：官网 `/`、后台 `/admin` 与
  `/admin/` 均返回 200，正确返回 HTML 且不带 `Content-Disposition: attachment`。
- 官网 `index-B_IA328U.js` / `index-RwKfc8sE.css` 和后台 `index-S04VL29e.js` /
  `index-Cs89cLaW.css` 均返回 200，MIME 正确。
- `http://askwenxue.com/` 返回 307，Location 为 `https://askwenxue.com/`。
- 未携带 bearer 的 `GET /api/admin/v1/me` 和 `/api/admin/v1/users` 均返回 401，
  `Missing admin token`；管理员鉴权边界保留。
- Codex 内置浏览器实际渲染官网标题、下载与演示内容，以及后台账号/密码登录表单。
- 02:17 AliDNS 也返回正确 CNAME；HTTP `/admin/?check=domain` 返回 307 并保留路径及
  查询串；来自 `https://askwenxue.com` 的后台 OPTIONS 预检返回 204。
- 未运行源码构建/单元测试：本次未修改或部署业务代码。未使用真实管理员凭据，故未验证
  登录后的数据读取和写入。首次验收时 AliDNS 仍有约 291 秒的否定缓存，Google DNS
  已返回正确 CNAME；不把部分节点生效表述为所有递归 DNS 同时刷新。

## 提交

- 云端变更不对应应用代码提交；文档与本日志记录在 `codex/restore-askwenxue-domain`。
- `1bd7f8a` `docs(infra): document askwenxue production domain`。
- 本日志单独提交；主工作区旧改动保持原状。ARCHITECTURE、PRD 与 UIUX 未变，模块职责、
  依赖和产品行为未变；仅同步 TECH-INFRA 中的部署入口。

## 回滚范围与下一步

- 本次修改前的域名为 `HTTP_AND_HTTPS`；仅有 `/admin` → `wenxue-admin-web`，
  `EnablePathTransmission=false`。需要回滚时只移除本次新增的 13 条路由并恢复上述一条，
  不删除域名、证书或默认域名下的路由。原始配置另保存于
  `/private/tmp/wenxue-domain-before-20260918.json`。
- 官网与后台入口已恢复；用户使用现有内部账号登录。Google DNS 与 AliDNS 均已生效。
- 文档记录位于隔离分支，后续合入主分支时保留主工作区已有 TECH-INFRA 桌面运行时改动。
