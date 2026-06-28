# 启动器 UI 精修与可用性验证

- **日期**：2026-06-28
- **关联**：桌面启动器 UI 重新设计；官网 / 插件 UI 风格对齐；无标题栏与品牌图标验收
- **会话上下文**：用户要求先给计划和 spec，再实现，并以“页面无遮挡、控件功能正常”为验收标准。

## 做了什么

- 重做桌面启动器 shell：macOS 使用 `hiddenInset` 保留红绿灯但隐藏标题文字；Windows/Linux 走 frameless + 自绘窗口控制；窗口标题、dock/taskbar icon 使用问学 logo。
- 渲染层回到官网 / 插件 options 一致的白底克制产品 UI：左侧 logo rail、四个主路由、细边框、8px 圆角、低色彩占比。
- 浏览器页保留并验证添加、重命名、复制、搜索、排序、打开、停止；排序控件从装饰按钮改为“最近 / 状态 / 名称”真实行为。
- 日志页增加来源筛选 chip，保留级别筛选、搜索、跟随、清空确认、导出禁用态；修复损坏 `launcher-logs.json` 导致 `logs:query` 持续异常的问题。
- Tokens 页导出按钮改为真实 JSON 导出，并在无数据时禁用。
- 设置页保留即时保存，验证启动地址修改可落盘并恢复；设置分区 UI 与窗口安全区无遮挡。
- BrowserSupervisor 停止链路从单次 SIGTERM 改为：SIGTERM 后 2s 未退出则 SIGKILL，5s 仍无退出事件标记 error，避免后端状态卡在 running。
- 修复生产构建下 logo 资源使用 `/logo.png` 导致 `file://` 破图的问题，改为相对资源路径。

## 提交

- `5afefef` feat(desktop): polish launcher shell and controls

## 验证

- `./node_modules/.bin/vitest run` 通过：11 个文件、54 个用例。
- `./node_modules/.bin/electron-vite build` 通过，桌面 `out/` 产物已更新。
- 修复本地 Electron 依赖运行时：原 `node_modules/electron/dist` 缺少 Frameworks，使用缓存 zip 重新解压后恢复到可启动状态；这是本机依赖修复，不进入 git。
- Computer Use 多次 `get_app_state` 尝试均超时，无法稳定接管当前 Electron bundle；改用 Electron CDP 对真实生产构建进行截图与鼠标/DOM 事件验证。
- CDP 验收覆盖：
  - 浏览器页、日志页、Tokens 页、设置页各状态截图；
  - 所有截图 `imageFailures = []`、`overflowCount = 0`、`visibleElectronText = false`；
  - 临时画像新增、重命名、复制、搜索、排序、打开、停止成功；
  - 临时画像已清理，设置 `startUrl` 已恢复为 `chrome://newtab`；
  - 损坏日志文件被隔离为 `.corrupt-<timestamp>`，新 `launcher-logs.json` 自动重建。

## 关键截图

- `/tmp/wenxue-launcher-browser-initial.png`
- `/tmp/wenxue-launcher-browser-profile-renamed.png`
- `/tmp/wenxue-launcher-logs-filtered.png`
- `/tmp/wenxue-launcher-tokens.png`
- `/tmp/wenxue-launcher-settings-launch.png`

## 文档同步

- `ARCHITECTURE.md`：补充 app shell IPC、BrowserSupervisor startUrl/停止收敛、LauncherLogStore 损坏日志隔离。
- `TECH-INFRA.md`：补充窗口控制 IPC 与 BrowserSupervisor SIGTERM/SIGKILL 行为。
- `UIUX.md`：补充 2026-06-28 桌面启动器视觉方向、无标题栏、logo、安全区与真实控件要求。
