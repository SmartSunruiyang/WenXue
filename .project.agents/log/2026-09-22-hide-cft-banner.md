# 隐藏 Chrome for Testing 顶部说明栏

- **日期**：2026-09-22
- **关联**：当前 Electron + Chrome for Testing 运行时；LaunchConfig

## 做了什么

- 为所有 CfT 启动加入 `--disable-infobars`，隐藏不可手动关闭的测试版说明栏。
- 同步 CfT 启动参数权威表。
- 实测排除桌面 CfT 不支持的 `--policy` 强制固定方案，未保留无效参数。

## 提交

- 未提交；本次按用户要求直接叠加在已有未提交工作区，未触碰既有账号与桌面弹层实现。

## 状态变更

- 架构文档：未改变模块边界或依赖。
- 基础设施文档：登记 `--disable-infobars` 参数。
- 测试：按用户要求不新增测试；仅同步既有精确 argv 断言。
- 验证：`pnpm -F desktop build` 通过；临时 CfT 画像确认桌面版不会加载命令行 `--policy`。

## 下一步

- 重启由启动器管理的 Chrome for Testing 实例，使隐藏提示栏参数生效。
- 若要固定问学图标，选择画像级“每次启动重新置顶”或操作系统企业策略。
