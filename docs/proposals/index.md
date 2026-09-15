---
description: 设计记录的状态与当前实现文档之间的对应关系。
---

# 设计记录

这里保留需求背景和设计取舍。记录描述的是决策时的上下文，当前 API 与实现请从对应入口查阅。

| 记录                                                      | 状态                           | 当前文档                                                |
| --------------------------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| [流式响应需求](./streaming-response-prd)                  | 核心能力已实现，原验收目标保留 | [使用指南](../guide/streaming-response)                 |
| [流式响应原始设计](./streaming-response-technical-design) | 历史设计，分层与所有权已演进   | [响应与取消](../framework/internals/response-lifecycle) |
| [文档站架构](./documentation-architecture)                | 信息架构已落地，保留规划背景   | [文档维护](../framework/contributing/documentation)     |

新增记录应注明状态、适用范围、关联实现和替代关系。未验证的性能目标保留为目标，不改写为已达成结果。
