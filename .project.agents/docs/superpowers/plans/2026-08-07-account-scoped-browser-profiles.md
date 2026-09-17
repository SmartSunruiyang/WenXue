# 账号隔离浏览器档案实施计划

对应设计：[`../specs/2026-08-07-account-scoped-browser-profiles-design.md`](../specs/2026-08-07-account-scoped-browser-profiles-design.md)

- [x] 1. 同步当前运行时权威文档
  - 更新 BrowserProfile、BrowserProfileStore、DesktopBridge、UserSessionStore 与 ConsoleUI 契约。
  - 更新账号退出交互、持久化表和当前路线图。
  - _Requirements: R1–R6_

- [x] 2. 为档案元数据加入账号归属
  - 分离磁盘模型与 renderer 公开模型。
  - 所有 Store 操作要求 `accountNamespace`；旧无归属记录失败关闭但原样保留，孤儿目录 ID 不复用。
  - Store 内串行全部元数据操作，增加同账号恢复、跨账号隔离、并发写与 mutation 回归测试。
  - _Requirements: R1, R2, R4, R5_

- [x] 3. 在主进程强制执行账号边界
  - 所有 profile IPC 从当前 session 推导账号并校验归属。
  - 过滤状态查询/事件；修正兼容 launch，禁止共享 `default`。
  - 主进程经受信网关验证 token→uid，阻止伪造归属和有效 session 被直接覆盖成另一账号。
  - profile 生命周期串行，remove 先 stop；首次 session 先协调其他账号/无归属运行画像；启动器单实例并
    通过跨进程启动标记覆盖 Chromium 建锁前窗口。
  - _Requirements: R2, R5_

- [x] 4. 实现退出事务
  - 增加 `auth:prepareSignOut` / `auth:cancelSignOut` typed IPC。
  - 退出前停止当前账号全部 pending/running Profile，失败时保持登录。
  - ConsoleUI 按 prepare → CloudBase signOut → clear 顺序执行；只在确认 CloudBase 仍登录时解除保护，
    signOut 结果未知或 clear 失败时保持保护并要求重启。
  - _Requirements: R1, R3, R4_

- [x] 5. 验证并交付
  - 运行 desktop test、typecheck、build，并检查 diff。
  - 写执行日志，提交独立 `codex/account-scoped-profiles` 分支。
  - _Requirements: R1–R6_
