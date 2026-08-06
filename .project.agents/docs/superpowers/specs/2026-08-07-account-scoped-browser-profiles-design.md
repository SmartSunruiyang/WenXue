# 当前启动器账号隔离浏览器档案设计

- **状态**：已批准（用户于 2026-08-07 明确要求实现）
- **运行时**：当前 Electron + Chrome for Testing 启动器
- **上游行为**：目标 PRD F10–F11、目标架构 AR-06

## 1. 目标与范围

当前启动器把所有浏览器档案登记在同一个 `browsers.json`，退出时只清空 renderer 状态；下一账号
登录后仍可能读取、启动或操作前一账号档案。本次把浏览器档案及其 Profile 内的 Cookie、网站状态、
扩展 IndexedDB、AI 会话与记忆绑定到创建它的问学账号。

本次不把档案上传云端，也不实现跨设备同步。体验目标仅是：同一台设备再次登录同一账号时恢复原档案，
登录其他账号时这些档案保持在磁盘但完全不可见、不可操作。

## 2. 需求与验收标准

### R1 — 本地保留

当账号退出时，系统应保留该账号的档案元数据和 Profile 目录，不得因退出或切号删除 Cookie、网站数据、
扩展 IndexedDB、AI 历史或记忆。

### R2 — 账号隔离

当账号登录时，系统应只列出其 `AccountNamespace` 下的档案。任何档案 IPC 都必须由主进程当前 session
推导账号归属；即使 renderer 提交其他账号的已知 `profileId`，系统也应以“未知档案”拒绝，且不得打开
目录、启动、停止、重命名、复制、删除或更新时间。

### R3 — 安全退出

当用户退出账号时，系统应先停止该账号所有正在启动或运行的浏览器，再退出 CloudBase session 并清理
主进程 session。若浏览器未能安全停止，系统应保留登录状态并给出可重试错误，不得进入下一账号工作台。

### R4 — 原账号恢复

当同一设备再次登录原账号时，系统应重新列出原账号档案；启动档案后，Profile 内原有网站状态与 AI
历史应由 Chromium/扩展原生存储恢复。

### R5 — 旧数据失败关闭

当 `browsers.json` 中存在没有 `accountNamespace` 的旧记录时，系统应忽略该记录，不自动归给任何账号，
也不得通过兼容入口启动它；后续新账号写入不得裁掉原始旧记录。新画像 ID 必须同时避开全部元数据 ID
和磁盘上的孤儿目录，不得复用旧 Cookie/IndexedDB。本机现有旧档案已按用户授权在实施前清理，本次不
实现导入或认领 UI。

### R6 — 真实边界

系统和界面不得宣称已进行云同步。换设备、卸载或清除本机应用数据后，档案不会从问学云端恢复。

## 3. 技术设计

### 3.1 数据模型

`BrowserProfile` 保持 renderer 可见的公开模型；磁盘记录增加仅主进程可见的归属字段：

```ts
interface StoredBrowserProfile extends BrowserProfile {
	accountNamespace: string
}
```

当前运行时使用经过验证的 CloudBase `userId` 作为 `AccountNamespace`。`auth:setSession` 不信任
renderer 声明的归属：主进程必须先用内置 HTTPS 网关地址和 bearer access token 调用
`POST /v1/auth/activate`，以网关经 `/auth/v1/user/me` 返回的真实 uid 校验 renderer `userId`，验证成功后
才提交内存 session。该字段写入 `<userData>/browsers.json`，不经 DesktopBridge 返回 renderer。Profile
目录继续使用现有 `<userData>/profiles/<profileId>` 布局；AI 历史和记忆仍由扩展 IndexedDB 保存在对应
Profile 内。

### 3.2 BrowserProfileStore 契约

`list/create/get/duplicate/rename/remove/touch` 全部以 `accountNamespace` 为第一个参数。读取时先解析完整
磁盘集合，再按账号过滤；生成 ID 时仍对所有账号全局去重。所有按 ID 的操作同时匹配账号与 ID，跨账号
与不存在使用相同错误。

未带 `accountNamespace` 的旧记录不进入有效集合。创建新记录时按当前账号自己的档案数量计算默认名称
和颜色，不受其他账号影响；未知记录和顶层兼容字段原样保留。ID 分配对所有记录和 Profile 目录全局
去重，并以独占创建目录消除检查/创建竞态。

### 3.3 DesktopBridge 边界

- `accountNamespace` 只取自主进程验证过的 `UserSessionStore` session；普通画像操作使用
  `requireSession().userId`，退出流程可使用主进程保留的最近活动账号 ID 处理刚过期的 session。任何 IPC
  参数都不接受账号 ID。
- 列表、创建、目录打开、启动、停止、复制、重命名、删除、touch 和状态查询都先执行归属检查。
- Profile 状态事件只发送给当前 session 所属账号。
- 旧 `browser:launch` 兼容入口只选择当前账号首个档案；没有档案时为当前账号创建一个，绝不回退到共享
  `default` Profile。
- 同一 profileId 的 launch/stop/remove 在主进程串行；remove 必须先确认浏览器已停止，失败时不得删除
  目录或元数据。
- 主进程首次接受账号 session 前扫描全部有归属/无归属 Profile；其他账号或无归属的仍运行画像必须
  安全关闭，否则拒绝进入新账号工作台。该扫描只返回主进程；renderer 只收到通用错误，不暴露其他
  账号的档案 ID 或底层关闭详情。
- `UserSessionStore` 在显式 clear 前保留账号归属；即使 token 刚过期，也拒绝直接覆盖成另一账号，只允许
  同账号 token 刷新。token→uid 验证和首次协调期间使用带所有权的 transition 锁，第二个请求不得提前
  解除首个请求的锁。
- Electron 启动器只允许单实例。BrowserSupervisor 在 spawn 前写跨进程启动标记，ProfileStore 将近期标记
  与 Chromium 锁一并视为“正在使用”，并在负锁结果后再次确认，覆盖 detached CfT 尚未建立锁的启动窗口。

### 3.4 退出事务

1. ConsoleUI 调用 `auth:prepareSignOut`。
2. DesktopBridge 读取当前 session，列出该账号全部档案，并通过 `BrowserSupervisor.stop` 等待全部停止；
   pending launch 同样被撤销。
3. 全部停止成功后，ConsoleUI 调用 CloudBase SDK `signOut`。
4. ConsoleUI 调用 `auth:clearSession`；主进程再次执行幂等停止保护后清空内存 session。
5. ConsoleUI 清空当前视图。磁盘档案和 Profile 不变。

步骤 2 失败时不执行步骤 3–5。步骤 2 成功而 CloudBase 返回已确定失败时，ConsoleUI 重新读取 SDK session；
只有确认云端登录态仍存在时，才调用 `auth:cancelSignOut` 解除保护并允许用户重试。若 CloudBase signOut
超时，底层请求结果属于未知，不得 cancel；若 CloudBase 已退出但 `auth:clearSession` 失败，也不得回滚到
可操作状态。这两类不可逆或不确定失败都保持主进程保护并要求重新打开问学。prepare 与 clear 之间，所有
画像 IPC 和 session 覆盖都被主进程拒绝。

## 4. 测试策略

- `BrowserProfileStore`：同账号重启恢复、不同账号列表隔离、默认命名独立、跨账号所有 mutation 拒绝、
  磁盘记录带归属且公开结果不泄露、旧无归属记录失败关闭并在后续写入中原样保留、孤儿目录 ID 不复用。
- `DesktopBridge`：每个 profile IPC 使用主进程 userId；已知跨账号 ID 不触发 supervisor/文件操作；状态
  过滤；兼容 launch 不使用 `default`；remove 先 stop；退出准备先停止所有当前账号档案；preparing 不可
  cancel；首次 session 关闭其他账号/无归属遗留进程；停止失败不清 session。
- `UserSessionStore`：主进程受信网关 token→uid 校验、超时/401/畸形响应失败关闭、uid 不匹配不提交；允许
  同账号刷新，拒绝未显式 clear（包括已过期）session 直接换成不同 userId。
- ConsoleUI：验证退出调用顺序为 prepare → CloudBase signOut → clear；prepare 失败时后续步骤不执行；
  仅在 CloudBase 已确定失败且 SDK session 仍存在时 cancel；超时结果未知或 clear 失败时保持保护。
- `BrowserSupervisor/ProfileStore`：单实例、跨进程启动标记、负锁二次确认、CDP 关闭竞态、kill/error 后保留
  live handle，以及退出后清理启动标记。
- 回归：desktop test、typecheck、build；扩展存储格式不变，无需扩展迁移。

## 5. 非目标

- 不实现跨设备同步、云端备份或恢复。
- 不迁移、认领或自动删除其他安装上的旧无归属 Profile。
- 不在本次把 LauncherSettingsStore、LauncherLogStore 或 TokenUsageStore 改成账号分库。
- 不把本地同 OS 用户之间的隔离描述为操作系统级安全边界。
