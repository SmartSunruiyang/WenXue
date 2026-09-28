# 制作并接入 Windows 安装包品牌素材

- **日期**：2026-09-29
- **关联**：TECH-INFRA §8.1、UIUX §2、[实施计划](../docs/superpowers/plans/2026-09-29-windows-brand-assets.md)
- **工作树**：`/Users/outas/.codex/worktrees/windows-brand-assets/WenXue`
- **分支 / 基线**：`codex/windows-brand-assets` / `782743f723c34b2977825ac4b528d0e59a9dd39e`
- **会话上下文**：用户要求 Windows 安装包使用独立于 macOS 规范的 logo 等素材。原工作区已有邮件验证相关未提交文件，因此按项目规则隔离制作，没有改动原工作区或合并回主线。

## 做了什么

- 将 Windows 从复用 macOS superellipse 改为平面白底、小圆角、细灰边、透明外边距；保留透明源中的问字，增大主体。
- 交付 16、20、24、30、32、36、40、48、60、64、72、80、96、128、256 共 15 档 PNG，并合为 32-bit ICO。
- 交付 150×57 header、164×314 sidebar 原生 24-bit BMP，沿用问字与现有 slogan 图片；安装/卸载共用资源，不额外绘制拼音文字。
- 显式配置 NSIS 安装图标、卸载图标、header 和 sidebar。保留 assisted 安装流程；安装 sidebar 默认显示在完成页，卸载显示在欢迎 / 完成页。
- 扩展现有 Swift/AppKit 生成器，支持 `--windows`、`--mac` 和默认全部生成；新增 `pnpm -F desktop generate-icons:win`。Windows 构建直接使用入库资源，无新增运行时依赖。
- 更新既有资产说明、TECH-INFRA、UIUX，并保存 [明暗背景预览](../assets/windows-installer-assets-preview.png)。

## 提交

- **未提交**：用户本轮未要求提交；所有本轮改动集中在独立工作树中，等待查看 / 合并。原工作树的邮件相关改动保持原样。

## 验证

- `pnpm -F desktop generate-icons:win` 成功；Swift 实际编译与资源生成通过。
- 重复生成全部 18 个 Windows 输出，SHA-256 完全一致；macOS 两个产物及原始 `icon.png` 无 diff，macOS 产物哈希未变。
- 独立 Node 二进制检查：ICO 15 个目录项的尺寸、32-bit 标识、偏移、长度和 PNG 内容匹配；所有 PNG 为 RGBA8、四周外缘透明、存在清晰黑色主体与白色底板。
- BMP 检查：两文件均为 BITMAPINFOHEADER、24-bit、BI_RGB，尺寸、数据长度及 4-byte 行填充正确；sips 可正常解码，预览正向且文字无裁切。
- 使用本机实际 app-builder-lib 26.15.3 schema 验证 electron-builder 配置通过；所有应用 / NSIS 图像引用存在。核实 `signExecutable: false` 仍保留 EXE 图标编辑，未改为禁用资源编辑的 `signAndEditExecutable: false`。
- 明暗背景下查看原始像素联系表，16px 中间开口可见；256 PNG、header、sidebar 均已视觉检查。
- `--invalid` 返回退出码 1；相关 JSON/YAML、资产说明、计划与执行日志 Prettier 检查通过；`git diff --check` 通过。
- 本轮没有改运行时代码，未扩展运行时测试；未执行完整 Windows 安装包构建、签名、发布或实机安装。

## 状态变更与下一步

- 不新增或修改运行时模块 / 依赖，不触发 ARCHITECTURE 或产品功能 PRD 修订。
- 独立工作树内配置已经消费新素材；原工作树尚未合入本轮改动。
- 正式发布前在 Windows 机器验收 EXE、桌面 / 开始菜单快捷方式、任务栏及安装 / 卸载向导的实际显示；macOS 静态校验不替代此项。

## 同日设计修订

- 用户要求移除设计中的 WenXue 拼音，统一使用现有 slogan 图片。已删除生成器中的字体品牌绘制函数，header 与 sidebar 各使用一份 `nobottomslogen.png`，保持 3:1 比例；同步调整间距与预览。
- `pnpm -F desktop generate-icons:win` 成功；两张 BMP 维持 150×57 / 164×314、24-bit BI_RGB。解码后逐张视觉检查，无拼音文字、重复 slogan 或裁切。
- 同步资产说明、UIUX 和实施计划；仍为独立工作树内未提交改动，原因与上文一致。
