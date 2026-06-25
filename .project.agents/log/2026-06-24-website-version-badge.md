# 官网首页版本标记

- **日期**：2026-06-24
- **关联**：官网首页首屏品牌标识
- **会话上下文**：在已有官网未提交工作树上，按用户要求调整首屏大标题上方 logo 右侧文字。

## 做了什么
- 将首屏 hero logo 右侧的「问学 WenXue / WenXue」替换为 `v0.0.1 beta`。
- 为该版本标记应用 `ui-monospace` 等宽字体栈，保持顶部导航与其他品牌文案不变。

## 提交
- 未提交，工作树在本次任务前已包含多处官网与文档相关未提交改动；本次仅追加首页版本标记改动与本日志。

## 状态变更
- 架构文档：未变更。
- 需求/UI 文档：未变更；`UIUX.md` 已规定版本号使用等宽字体。
- 测试：
  - `pnpm -F website test` 通过。
  - `pnpm -F website build` 通过。
  - 浏览器验证 `http://localhost:5176/`：桌面与 390px 移动视口首屏均显示 `v0.0.1 beta`，computed font family 为 `ui-monospace` 栈，无 framework overlay，无 console warn/error；首屏下载按钮可滚动到下载区。

## 下一步
- 若后续要让版本号跟随发版自动更新，可新增单一版本源并同步官网、插件 options 与桌面版本区。
