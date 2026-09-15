---
description: Nova 的公开导入路径、运行时值、类型导出和查询入口。
---

# API 参考

本栏目描述当前工作区公开入口的行为。应用指南提供用法与完整示例；这里集中维护参数、默认值、返回值和边界。

## 导入路径

| 入口                       | 用途                                                    | 参考                                                 |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `nova-http`                | 创建应用、请求/响应类型、内置中间件与文件方法           | [应用](./app)、[请求](./request)、[响应](./response) |
| `nova-http/middlewares`    | bodyParser、staticFiles 与选项类型                      | [中间件](./middleware)                               |
| `nova-http/static`         | sendFile、getMimeType、parseRange 与类型                | [文件适配器](./static)                               |
| `nova-http/core`           | Application、Router、Hooks、请求/响应运行时类与消息契约 | [内核](./core)、[消息](./message)                    |
| `nova-http/protocol/http1` | 分段输入、解析、定界与输出编码工具                      | [HTTP/1](./http1)                                    |
| `nova-http/package.json`   | 包元数据                                                | 以安装包为准                                         |

主入口的 `NovaRequest`、`NovaResponse` 是**类型导出**。需要构造实例时从 `nova-http/core` 导入。`message` 和 `server` 是源码分层，当前没有对应的公开包子路径。

## 按任务查询

<DocLinks :items="[
  { title: '配置', description: '监听地址、超时、请求体、解析限制与代理信任。', href: '/api/configuration' },
  { title: '请求与响应', description: '路径、字段、body 消费、状态与输出。', href: '/api/request' },
  { title: '错误参考', description: '定位响应错误码与 HTTP/1 输入错误。', href: '/api/errors' },
]" />

## 类型与版本

`Handler`、`Middleware`、`ErrorMiddleware`、`NextFunction` 和 `MiddlewareContext` 定义处理函数契约；`RequestContext` 与 `HookEvents` 支持声明合并。`NovaConfig`、`TrustProxy`、`Http1ConnectionConfig`、`ContinueDecision` 对应[配置](./configuration)。

消息类型在[消息契约](./message)中说明，协议判别联合在 [HTTP/1](./http1) 中说明。带下划线的内部方法不作为应用扩展契约，即使它们因实现需要出现在类声明中。

本页入口表以 `packages/nova-http/package.json` 的 exports 为依据。工作区行为不自动等同于 npm 已发布版本，迁移前核对[版本说明](../releases/)。
