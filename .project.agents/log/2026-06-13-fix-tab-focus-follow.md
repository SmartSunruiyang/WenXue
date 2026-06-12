# 修复 Agent 标签页操作不聚焦：open_new_tab 排查 + switch_to_tab 视觉跟随

- **日期**：2026-06-13
- **关联**：PRD F3（多标签页任务）/ 插件域 MultiPageAgent 模块
- **会话上下文**：用户报"插件开新标签页浏览器不自动聚焦"，要求 debug；确诊后用户要求顺带实现切换跟随

## 做了什么

### 排查（open_new_tab 不聚焦）
- 根因两层：① 上游 page-agent 有意后台开 tab（`chrome.tabs.create({ active: false })`，已提交版本）；② 工作区里已有人改成 `active: true`（6-12 15:10）但扩展直到 6-13 04:39 才重建，期间所有浏览器会话跑的都是旧产物 → "修了没生效"
- 用 CfT 149 + CDP 走真实 SW 消息路径实证：当前产物下新 tab 创建即激活、入组后保持激活、窗口保持聚焦——**该 bug 代码层面已修复，重启浏览器加载新产物即可**
- 结论同步进记忆 `extension-dev-rebuild.md`：rebuild 后还必须重启 CfT（MV3 SW 只在启动时从磁盘加载）

### 实现（switch_to_tab 视觉跟随）
- `TabsController.background.ts`：新增 `activate_tab` TAB_CONTROL action（`chrome.tabs.update(tabId, { active: true })`）
- `TabsController.ts`：`TabAction` 联合加 `'activate_tab'`；`switchToTab()` 在逻辑切换前发送该消息（best-effort，激活失败不阻断逻辑切换）
- 波及路径（均为期望行为）：tabTools 的 switch_to_tab 工具、closeTab 关闭当前页后的回退切换、tab 事件 created/removed 触发的切换，现在都会让浏览器视图跟随
- 决策：不做 `chrome.windows.update({ focused })` 窗口级抢焦——与 open_new_tab 的 active:true 行为保持同层级（tab 级），避免每步操作把整个浏览器窗口拽到其他应用前面
- 新增测试：`TabsController.background.test.ts`（activate_tab 成功/失败路径）、`TabsController.test.ts`（switchToTab 接线 + 未知 tab 拒绝），TDD 先红后绿
- PRD F3 需求点同步："浏览器视图跟随 Agent 当前操作的标签页"

## 提交
- `f675b60` fix(ext): Agent 标签页操作时浏览器前台跟随（TabsController 两文件 + 两个新测试 + hub tab 置前 + PRD F3 一行，经 hunk 级拆分与品牌改动分离）
- 同批整理的历史在途改动：`01b8dcd` chore(.gitignore) / `c3569b7` feat(vendor) 流体玻璃遮罩 / `ec467e4` feat(ext) 模型配置与设置页 / `fcf8842` feat(ext) 品牌化与对话界面 / `0afa69f` feat(desktop) 品牌视觉
- ⚠️ `ec467e4` 的 `constants.ts` 含内置默认模型的真实 DashScope API Key（内置模型产品决策，PRD F4），已进入 git 历史；仓库公开前必须先换 Key 或重写历史

## 状态变更
- ARCHITECTURE：未动（改动全部落在已登记的 MultiPageAgent 模块内，无新模块/依赖边）
- PRD：F3 需求点补"浏览器视图跟随"一句（与代码同批改动）
- 测试：`pnpm -F extension test` 17/17 通过（含 3 个新增）；`pnpm -F extension build` 成功；CfT 149 + CDP 端到端验证 activate_tab：后台 tab 变前台 ✅、坏 tabId 返回 error ✅

## 下一步
- 用户重启浏览器（`pnpm dev` → 启动浏览器）后在真实任务里走查多标签场景（PRD F3 验收的 research 场景即可覆盖）
- 待澄清：hub 驱动（桌面 WS 下发任务）场景是否需要窗口级 focus（当前 demo 流程不需要）
