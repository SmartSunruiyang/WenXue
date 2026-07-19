# AI 浏览器重构测试与验收策略

> - 状态：G1 前待评审
> - 最后更新：2026-07-17（同步 PRD v0.4 通用视觉答题能力）
> - 原则：首版“插件完整迁移”必须由行为等价证据证明，不以代码复用比例或人工主观体验判定。

## 1. 测试目标

验证四件事：

1. 新浏览器具备通用浏览器与问学插件的完整首版能力；
2. 每个任务真正在数据、执行、权限、凭证和恢复层隔离；
3. 多任务、多标签页 Agent 可以并行，不串扰、不抢焦点；
4. 相对 Chrome for Testing 的性能、兼容性、稳定性和可恢复性达到 PRD 门槛。

## 2. 能力矩阵

每个 CAP 项必须拆成可执行用例，并记录旧运行时结果、新运行时结果、差异、责任人和证据。旧运行时的精确扩展 commit 与 CfT revision 必须随报告保存。

| ID     | 能力域           | 首版验收重点                                                      |
| ------ | ---------------- | ----------------------------------------------------------------- |
| CAP-01 | 任务生命周期     | 新建、命名、切换、关闭、删除、恢复；新任务打开问学新标签页        |
| CAP-02 | 任务持久化与隔离 | 每任务独立 Profile、站点数据、历史、权限、密码和扩展状态          |
| CAP-03 | 浏览器导航       | Omnibox、搜索、后退、前进、刷新、停止、URL 解析、错误页           |
| CAP-04 | 标签页           | 新建、关闭、复制、重排、固定、恢复、跨标签导航及当前标签识别      |
| CAP-05 | 新标签页         | 网站快捷入口、默认搜索、键盘导航和任务初始化状态                  |
| CAP-06 | 问学侧边栏       | Logo 唤起/关闭、会话状态、页面切换、任务切换与恢复                |
| CAP-07 | 页面理解         | 当前页/选区/结构化内容获取、引用定位、动态页面与跨域边界          |
| CAP-08 | 页面操作         | 点击、输入、滚动、等待、下载、上传、权限提示和失败反馈            |
| CAP-09 | 多标签页 Agent   | 创建/选择/观察多个标签页，句柄稳定，结果归属当前任务              |
| CAP-10 | 多任务并行 Agent | 两个及以上任务同时运行，生命周期与事件互不干扰                    |
| CAP-11 | 登录与凭证安全   | 问学账号控制面、任务站点登录、短时令牌、BYO 授权与吊销            |
| CAP-12 | 插件平台等价     | MV3 service worker、storage、消息、权限、命令、菜单及现有全部入口 |
| CAP-13 | 恢复、更新与迁移 | 崩溃恢复、版本升级、数据导入、失败回滚、旧运行时保留              |

“现有全部入口”必须通过代码和用户流程盘点展开为子项；任何未盘点能力不能默认为已迁移。

### 2.1 PRD v0.4 扩展能力门禁

本文件上表是目标浏览器交付域的 CAP 分类；下列 `EXT-CAP-*` 明确引用 PRD F6 的插件能力编号，
避免两个矩阵同名误配：

| PRD 能力     | 必测内容                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EXT-CAP-07` | `visual_observe` legacy/Observe 输入输出兼容；题目 scene 只建议；capability registry；截图仅当前可见 target tab、waiting_foreground、cross-frame 最小 crop 与 scroll restore；图片不持久化                                                                                           |
| `EXT-CAP-13` | `question_solver` 的 `inspect/answer/fill` 权限、23 个 production variant、task/run/request/cancel 隔离、全 frame interruption、synthetic embedded-answer 映射与 production allowlist 为空、text/vision、snapshot/exact fill/verify/restore、导航后 frame 重发现、no-submit 与成熟度 |

`EXT-CAP-13` 必须逐 variant 记录 `implemented | fixture_verified | live_verified`。没有真实账号 / 页面时
允许 `fixture_verified` 通过当前实现门禁，但报告和 UI 不得将其写成 `live_verified`。

最少 fixture 组：

- 超星 modern work/exam、chapter test；
- 智慧树 gxk、xnk、smart work、smart exam、fusioncourse、hike work、hike homework；
- ZJY legacy work/exam；
- ICVE standard、AI work；
- iCourse chapter、work、exam；
- U校园 reading fill/choice、normal choice、completion/translation、两类 banked cloze、free fill、line matching；
- generic standard HTML visible fallback。

每组覆盖其适用的纯文本、图片选项、图文混排、受控输入、翻页 / 保存和中断行为。synthetic
embedded-answer 公共用例必须包含正确映射、option shuffle、旧 attempt、跨题错配、多来源冲突、
通过后零 LLM 调用；production 23 variant 必须断言 answer projection 为空，zhs gxk 只允许
`questionDtos[].name`。原始响应、session、签名参数不得进入测试快照或日志。

结果 delivery 必须覆盖 96 KiB chunk/continuation、8 MiB/2,000 outcome 上限前 resume、token 的
task/action/scope/TTL 绑定；ResultStore 最后一 chunk 清理后 ResumeCursorStore 仍可用，且 resume 只允许
原 managed lease 的同一 tab、原子单 claim。不得丢弃或重复 `inspect/answer all_pages` 的成功题目，
continuation 续取结果时页面、模型和 write 调用必须为 0。

隔离测试必须覆盖 nonce→active frame registration、`match_origin_as_fallback` 特殊 frame、documentId
effect gate、parent-bound MAIN 子 RPC、request lane 乱序、`active→cancelling→cleanup→quarantined/closed`、
写后 cancel restore、迟到 setter 不穿透 quarantine、caller/content/no-snapshot 三类 session rehydrate、
同 tab mutation owner/effect lock、550ms capture limiter、logical page cycle 与 binding TOCTOU。同 frame
probe 冲突、多 frame 稳定聚合/双 navigation owner，以及 Chaoxing preview/serial profile 必须单测。
图片通道只接受 locator/anchor/binding，并覆盖 inline→asset、bound crop→restore、2 MiB/16 MiB 上限、
hash/尺寸校验、跨题/跨 run ref 拒绝和 raw base64 日志 hard-omit。

至少两条 known-adapter 强制全链路：Chaoxing image-only options 走 fetch 403→bound screenshot→fake
vision→清除旧选项→exact fill→verify；Chaoxing mixed reader 保留 material/stem/option/subquestion 的交错
顺序、共享图只发送一次、错误 path/缺图时零页面修改。两条都断言最终提交 0、base64/history 0。

## 3. 测试层级

| 层级                  | 范围                                                       | 典型证据                      |
| --------------------- | ---------------------------------------------------------- | ----------------------------- |
| 单元                  | taskId 校验、协议、状态机、迁移转换、更新清单验证          | 确定性测试报告                |
| 组件                  | TaskRegistry、TaskBrowserHost、Agent Orchestrator、扩展桥  | 组件测试与故障注入            |
| Chromium browser test | Profile、Browser/TabStrip、权限、窗口、导航、扩展生命周期  | 浏览器测试日志                |
| 扩展集成              | MV3 service worker、content script、side panel、消息与权限 | 固定站点夹具报告              |
| 端到端                | 用户创建任务至 Agent 完成工作                              | 视频/截图、事件轨迹、构建坐标 |
| 兼容性                | 常用网站、登录、复杂 SPA、文件操作、媒体与弹窗             | 站点矩阵                      |
| 性能/长稳             | 单/双任务、后台任务、Agent 长运行、崩溃与资源回收          | 统计报告、trace、dump         |
| 发布                  | 安装、签名、更新、灰度、回滚                               | 已签名产物和发布清单          |

## 4. 任务隔离测试矩阵

至少对两个同时存在的任务 A、B 验证：

| 维度                  | 操作                        | 必须结果                                                   |
| --------------------- | --------------------------- | ---------------------------------------------------------- |
| Cookie                | A 登录站点，B 打开同站点    | B 保持未登录                                               |
| HTTP Cache            | A 产生缓存，B 首次访问      | B 不读取 A 的私有缓存状态                                  |
| local/session storage | A 写入，B 查询              | B 不可见                                                   |
| IndexedDB             | A 创建数据库，B 查询        | B 不可见                                                   |
| Service Worker        | A 注册并激活，B 访问        | 生命周期与存储分别归属各 Profile                           |
| Permissions           | A 允许/拒绝摄像头等权限     | B 独立询问，不继承 A 选择                                  |
| History               | A 访问 URL                  | B 历史中不存在                                             |
| Passwords/autofill    | A 保存凭证                  | B 不可查询、不自动填充                                     |
| Downloads             | A 下载文件                  | 记录、路径策略和事件不归入 B                               |
| Extension storage     | A 修改问学扩展状态          | B 的状态不变化                                             |
| MV3 worker            | 终止或重载 A 的 worker      | B 的 worker 与任务不受影响                                 |
| Session restore       | 分别关闭并重启              | A、B 只恢复自己的标签页和状态                              |
| Agent handles         | A/B 同时创建标签页          | 句柄只能在所属 taskId 内使用                               |
| Visual/solver state   | A/B 同时截图并运行答题      | 截图、frame、adapter、embedded answer 与结果只属于各自任务 |
| Gateway credentials   | 撤销 A 短时凭证             | B 凭证继续有效且内容不同                                   |
| Crash                 | 使 A 的页面/扩展/承载层失败 | B 继续运行，可独立完成任务                                 |
| Delete                | 删除 A                      | A 数据按策略清除，B 数据哈希不变化                         |

隔离测试应同时包含正向证明与越权攻击用例，例如伪造 taskId、复用旧标签页句柄、跨任务回放事件和在任务切换瞬间发起操作。

## 5. 并发 Agent 测试

### 5.1 核心场景

1. 任务 A 执行多标签 Research，任务 B 同时执行答题；
2. A 等待页面登录，B 继续创建和读取标签页；
3. 停止 A 的 run，B 不被取消；
4. A 的某一标签页崩溃，B 的 run 正常完成；
5. 重载 A 的扩展或终止其 service worker，B 不受影响；
6. A/B 同时触发下载、权限请求、弹窗和新窗口；
7. 用户在 A、B 间快速切换，后台 Agent 继续运行；
8. 后台 Agent 需要前台确认时进入 waiting_foreground，不自动抢焦点；
9. 应用重启后分别恢复 A、B，再验证事件与结果仍归属正确任务；
10. 删除已完成任务 A 后，B 的页面、登录和 Agent 历史不变化。

### 5.2 必须断言

- 每个命令、事件、日志、标签页与结果带 taskId 和 runId；
- taskId 与真实 BrowserContext/Profile 不一致时拒绝执行；
- 一个 run 的 stop/fail/wait/retry/reload/unload 不传播到另一任务；
- 后台任务不得切换前台任务、激活标签页或弹出未授权窗口；
- 用户授权只对明确的任务、run、站点和时限生效；
- 并发结果不依赖测试执行顺序。

## 6. 浏览器基础能力与兼容性

必须覆盖：

- URL、搜索词、国际化域名、复制粘贴和协议处理；
- HTTP/HTTPS、证书错误、代理、离线、DNS 和网络切换；
- 普通页面、SPA、跨域 iframe、Shadow DOM、Canvas、PDF 和媒体；
- OAuth/SSO、验证码、人机验证以及需用户接管的流程；
- 弹窗、新窗口、下载、上传、文件选择和外部协议；
- 密码管理、权限提示、通知和站点设置；
- 键盘、鼠标、触控板、屏幕缩放、多显示器和无障碍；
- macOS arm64 与 Windows x64 的一致行为。

具体站点清单由真实使用数据与脱敏故障样本建立，不在文档中硬编码用户隐私数据。

## 7. 性能与资源

### 7.1 对称场景

- P1：一个问学任务、10 个标签页，对比一个 CfT Profile、同样 10 个标签页；
- P2：两个问学任务、每个 5 个标签页，对比两个 CfT Profile、每个 5 个标签页；
- P3：前台任务交互，后台任务运行 Agent；
- P4：任务冷启动、暖启动和应用重启恢复；
- P5：持续运行 8 小时及重复创建/删除任务；
- P6：MV3 worker 多次休眠/唤醒、页面崩溃和网络抖动。

### 7.2 控制变量

使用相同 Chromium revision 或记录不可避免的版本差异；页面集合、扩展能力、缓存状态、账号状态、网络、硬件、电源模式、采样时长和重复次数保持一致。

### 7.3 指标

- 冷/暖启动时间；
- 新任务和新标签页可交互时间；
- 页面加载与输入响应延迟；
- Agent 命令调度和页面观察延迟；
- 浏览器、渲染器、GPU、扩展和原生服务的 CPU/内存；
- 磁盘 I/O、Profile 增量、缓存增长；
- 崩溃率、任务失败率、长任务、内存泄漏；
- 后台任务对前台交互的影响。

接受阈值以 [PRD](../01-product/PRD.md) 为准。报告需给出中位数、P95、方差、样本数和原始 trace，不只给平均值。

## 8. 迁移测试

测试 fixtures 至少包含：

- 全新 Profile；
- 已登录多个站点的 Profile；
- 大量历史、书签、密码、权限和下载记录；
- 多个扩展版本与旧 schema；
- 不完整/损坏数据；
- 加密数据与不同操作系统账户；
- 迁移中断、磁盘不足、文件锁定和权限拒绝；
- 已迁移后再次运行；
- 新版本失败后回滚至旧运行时。

每个 fixture 验证未选择任务不受影响、原始数据不被破坏、导入任务可独立登录和回滚。详细流程见 [迁移与回滚](MIGRATION.md)。

## 9. 测试证据格式

每次门禁报告必须记录：

| 字段                 | 要求                                          |
| -------------------- | --------------------------------------------- |
| test_run_id          | 全局唯一                                      |
| gate/capability      | G1-G6 与 CAP 编号                             |
| build_manifest       | 完整发布清单引用                              |
| source_coordinates   | 两仓库 commit、Chromium revision、扩展 commit |
| platform/environment | OS、硬件、SDK、runner 镜像                    |
| fixture              | 脱敏数据集版本                                |
| steps/assertions     | 可重复步骤和机器断言                          |
| result               | pass / fail / blocked                         |
| artifacts            | 日志、trace、截图、dump、报告哈希             |
| owner/reviewer       | 执行人与评审人                                |
| timestamp            | 带时区时间                                    |
| deviations           | 与旧运行时的差异及批准记录                    |

敏感信息必须在证据上传前清理；Cookie、密码、页面正文和主令牌不得进入普通 CI 日志。

## 10. 门禁映射

| 门禁 | 测试出口                                                   |
| ---- | ---------------------------------------------------------- |
| G1   | 双平台可重复构建、启动/安装冒烟、发布清单与安全构建检查    |
| G2   | CAP-01/02/03/04/10/11 的隔离、并发、恢复和威胁测试         |
| G3   | CAP-05 至 CAP-12 全量行为等价，多标签页与多任务 Agent 通过 |
| G4   | CAP-13、迁移/回滚、对称性能、8 小时长稳与故障注入通过      |
| G5   | 签名、更新、灰度、遥测隐私、线上回滚演练通过               |
| G6   | 稳定窗口数据满足退场标准，旧运行时无必要回滚依赖           |
