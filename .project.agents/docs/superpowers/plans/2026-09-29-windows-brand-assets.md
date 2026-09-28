# Windows 安装包品牌素材适配

上游：PRD §2（Windows x64 NSIS）、TECH-INFRA §8（构建与分发）、UIUX §2（品牌）。
本任务属于现有 desktop 打包资源及 `generate-app-icons.swift` 生成流程，不新增运行时模块。

## 设计

- 沿用原问字标志；Windows 采用平面白色底板、克制小圆角与细灰边，透明外边距，放大问字。去除 macOS superellipse 与阴影；macOS 输出保持原样。
- Windows ICO 覆盖 16、20、24、30、32、36、40、48、60、64、72、80、96、128、256 px，每帧独立绘制；小尺寸对齐像素，保持中间开口。
- assisted NSIS 保持现有流程，交付 150×57 header 和 164×314 sidebar 的 24-bit BMP，安装/卸载复用品牌。品牌内容只使用既有问字 `nobottomlogo.png` 与 slogan `nobottomslogen.png` 源图片，slogan 保持原始比例；每张素材只放一份 slogan，不额外排版 WenXue 等拼音文字，不重复叠放两份 slogan，不加入具有误导性的动作或状态文字。
- 现有 Swift/AppKit 生成器为资源维护工具；打包直接使用入库素材，Windows CI 不需要 Swift。

## 执行

1. 修改生成器，生成 ICO、多尺寸 PNG 与安装器 BMP；添加 Windows-only 生成入口。
2. 配置 electron-builder 的应用/安装/卸载图标和向导配图。
3. 校验 ICO 帧、BMP 格式尺寸、配置资源引用及确定性；查看实际素材明暗背景预览。
4. 同步资产说明、TECH-INFRA、UIUX 与执行日志。真实 Windows 安装界面验收单独标记，不能由 macOS 静态验证代替。

## 官方依据

- https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction
- https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design
- https://www.electron.build/v26/docs/nsis/
- https://nsis.sourceforge.io/Docs/Modern%20UI/Readme.html
