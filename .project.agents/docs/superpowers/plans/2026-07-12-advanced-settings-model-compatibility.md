# 高级设置与模型兼容实施计划

设计依据：[高级设置与模型工具选择兼容设计](../specs/2026-07-12-advanced-settings-model-compatibility-design.md)

- [x] 1. 建立 named `tool_choice` 自动兼容基础能力
  - 严格识别可降级的 400/422 错误
  - OpenAIClient 自动重建 `required` 请求并标记能力
  - _Requirement: 1, 3_

- [x] 2. 持久化 endpoint/model 能力记录
  - 增加版本化、带过期时间且不含敏感信息的存储
  - 注入文本、视觉与学习通模型配置
  - _Requirement: 2, 4, 8_

- [x] 3. 简化高级设置
  - 移除 named-tool 用户开关及旧字段回流
  - 为 `llms.txt` 增加可信站点说明并保持默认关闭
  - _Requirement: 5, 6_

- [x] 4. 默认包含所有标签页
  - 对齐存储、表单、MultiPageAgent 与 TabsController 默认值
  - 保留显式关闭行为
  - _Requirement: 7_

- [x] 5. 文档、测试与验收
  - 更新当前实现对应的架构、UIUX 与 UPSTREAM 记录；PRD v0.2 按用户确认不修改
  - 运行聚焦测试、类型检查、构建与设置页浏览器验证
  - 写执行日志并复核最终 diff
  - _Requirement: 1-8_
