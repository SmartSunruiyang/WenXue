# 2026-09-28 — beta.4 rollout 与实机验收

## 发布范围与候选

- 用户明确确认覆盖全部符合资格的 beta 用户；root 于 2026-09-28 21:20 CST 在后台提交 `electron:beta:0.1.1-beta.4`，通道 beta、optional、100%，当前状态为发布中。
- 候选来源 commit `eb5fbc3a6e8e5fe37c300515cbd1de3660e03d61`，CI run `36424859967`。该发布不限定为仅测试账号。
- 公开只读策略探测：Windows x64 beta.1、Windows x64 beta.2 和 macOS arm64 beta.3 均返回 schema 2、optional、100%、beta.4；same-version、stable 和 Intel Mac 返回 `null`。显式 `protocolVersion=1` 返回 HTTP 400 `Unsupported update protocol version`；旧客户端省略协议时返回 `null`。

## macOS arm64

- 未手动点击“检查更新”，客户端自动弹出 beta.4 更新并后台下载；过程中曾显示约 16 MB/s、34%，之后下载完成。
- 本机缓存 DMG 的 SHA-512 与 size 与已登记 candidate 一致。客户端打开 DMG，`attempt.handoff` 为 `accepted`，旧版主进程正常退出。Finder 自动控制工具不可用，交由用户手动覆盖；用户回复完成后，本机 Info.plist 与应用 About 均确认应用和插件版本为 beta.4，已安装 App 的 `codesign --verify --deep --strict` exit 0。root 从 CfT 菜单正常退出本轮打开的浏览器，`ps` 确认内置 CfT 主进程为 0，新版问学仍打开。
- 原 Profile 数量前后均为 2；原 Profile 可启动、原有已打开标签仍在，新标签与侧边栏可见。账号交接时间为 21:28:36.400 至 21:28:38.452，约 2.052 秒。未发出 LLM 请求。历史、书签、站点登录未逐项核对，因此本记录只证明本次打开、覆盖和目标版本启动，不能作为完整资料保留证明。
- beta.4 升级前、仍在 beta.3 时，CfT 账号交接有一次约 15 秒的 cold 启动失败；随后 warm 316 ms 和两次真实 cold 1.709 秒、1.795 秒成功。原因未复现，未改业务代码或扩大 timeout。

## Windows x64

- 用户从现有 beta.1 或 beta.2 下载 beta.4 更新时反馈速度约 50 KB/s，随后恢复。用户对“完成下载并正常退出→再次打开升级到 beta.4”的询问明确回复“已到 beta.4，浏览器和资料正常”，U4 正常退出安装路径通过。精确起始版本和 Windows build 未提供，不宣称 beta.1 与 beta.2 两种起点均实测通过。
- 对同一 EXE 的本机 4 MiB HTTP probe 耗时 0.654 秒，约 6260 KiB/s，返回 HTTP 200，Range 请求未返回 206。该探测不能定位用户实际网络原因。Sol 只读检查未发现代码限速；显示速度是 updater 从首块起计算的平均值，未修改代码或设置。

## 后台与证据边界

- 后台最终刷新：检查成功/失败 2/0，下载 2/0、交接 1/0、目标启动聚合计数 2。这些是聚合事件，不提供设备归因；双端结论分别有本机和用户实测依据。
- 证据目录：`/Users/outas/Downloads/WenXue-CI-36424859967/`，包含 `rollout-policy-verification.json`、`rollout-runtime-evidence.json`、`windows-download-probe.json`。本轮未触发新 CI、后端部署或购买额度。
- P5.1 与 P5.6 已验收，双端主更新路径通过；P5 整体仍未完成。Windows 立即重启、浏览器占用/取消、断网/撤回等场景及 Mac 完整资料核验仍待验收。
- 交接成功计数只有 1，不补写为 2。Sol 只读核实 `handoffNsis` 的交接事件经 `recordEvent` 异步尽力发送，Windows 退出可能截断请求；目标版本确认走独立的持久 attempt、成功后清理及失败重试路径。两种计数不同符合当前语义，不证明安装失败，也无法仅由聚合数据确定缺失事件的平台；本轮没有为此修改代码。

## 工作记录

- 候选来源为 `eb5fbc3` / CI run `36424859967`；上一提交 `a7fb3d0` 为发布工具回归和候选记录。本记录与 `docs(desktop): record beta.4 rollout and upgrade verification` 同批提交，仅整理操作和实测结果；无业务代码变化。
