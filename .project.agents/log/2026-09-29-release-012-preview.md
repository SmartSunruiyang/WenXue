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

## 发布完成

- `9c18c49` 完成官网 preview 入口（保留 stable 优先，只有当前 active / optional / 100% / verified preview 可公开，暂停/撤回停止下载）；admin-api 219、website 18 项测试及类型检查、官网构建通过。
- 源码冻结 `9c18c497cd51daf3d14bf7713119476c495962d9`；GitHub run `36478867358` 首轮 `quality`、`macos`、`windows`、`seal-artifacts` 均 success。main 已推送，标签 `v0.1.2-preview` 指向同一源码并已推送。
- 本机 prepare 复核源 run、commit、seal v3、公钥与三项产物；确认的 artifactSetSha512 为 `3h5O6YFx6fxFHbweu8shiqkT67eYkGJ7zb8ec5EP+v6+IhrjH61HXcj8Vhw3ecXA+Ll3UF7MW1fFpQXuoNXOdw==`。
- macOS 最终 DMG 在本机重新执行版本、bundle 标识与严格 codesign 校验，exit 0。DMG 277,787,659 bytes；Windows EXE 221,067,289 bytes；beta.yml 340 bytes。
- prepare-upload 在本机签署清单，五对象初始均 upload；CloudBase managed upload 成功。register-upload 对公网五对象执行完整尺寸/哈希/Ed25519 回验后，返回 `electron:beta:0.1.2-preview` / `verified`。
- 2026-09-29 04:38 CST 在后台提交 beta / optional / 100% rollout，页面回读“发布中”；beta.4 被取代。双平台从 beta.4 请求 protocolVersion=2 均得到 0.1.2-preview、optional、100%；同版本、stable、Intel Mac、缺省旧协议返回 null。仅只读合成策略探测，未制造健康事件。
- 官网公开接口 HTTP 200 / no-store，返回正确 preview 和两份安装器。首页及四份构建资源均与本地逐字节吻合；CUA 验证 Mac 264.9 MB DMG 与 Windows 210.8 MB EXE、下载按钮可用、预览版标签明确。
- 后端 041 normal、100% 流量，BuildId `2607759543`、RunId `1xBHtA9IJOxaYR`；CPU、内存、实例数、策略、EnvParams、端口、访问类型、VPC、启动命令均与040逐值比较一致。默认客户端网关 `/healthz` 200；管理 API 无凭据 401。官网 `/healthz` 是静态404，不是健康入口。
- 04:39 CST 发送普通公告「问学 0.1.2 preview 已发布」，平台/版本/UID 不限制，后台回读“全部登录用户 / 已发布”，有效期至10月6日。本机正在运行的问学客户端已实际显示该公告，未代用户确认或安装。

## 证据与边界

- 完整产物、seal、签名与登记结果：`/Users/outas/Downloads/WenXue-CI-36478867358/`。
- 脱敏测试/部署/策略与截图：`/Users/outas/Downloads/WenXue-preview-20260929-evidence/`。
- 新版未执行双平台干净机器安装、真实账号头像上传或资料保留验收，不据自动化测试/候选 verified 声称这些已完成。安装包未经过 Apple Developer ID / Authenticode 签名，Mac 仍采用手动覆盖。
- 查询 CloudRun 进度的子任务一次未完整脱敏 EnvParams，使 `CLOUDBASE_USAGE_API_KEY` 的值进入该子任务工具输出。未写入源码、发布包或公开证据；已停止相关输出，无法撤回会话日志，已向用户说明。生产凭据未轮换，后续需单独轮换；本日志不记录其值。
- 本记录收尾提交仅补发布结果与 TECH-INFRA 当前版本，不改变已冻结的安装包源码。主工作区与所有有效工作树均无未提交改动；既有恢复用 stash 和历史 worktree 保留，不重新引入已删除大视频历史。
