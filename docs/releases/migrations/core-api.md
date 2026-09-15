---
description: 迁移流式请求体、公共导入、HookEvents 与适配器构造接口。
status: 待发布变更
---

# Core API 迁移

本页对应工作区内核和输入层重构，尚未归入具体发行版。先确认安装包包含这些变更，再调整应用或扩展。

## 应用代码

| 旧用法                         | 当前用法                                            |
| ------------------------------ | --------------------------------------------------- |
| 直接将 req.body 当 Buffer      | `await req.buffer()`、`text()`、`json()` 或流式消费 |
| 从 req.body 取 bodyParser 结果 | `req.context.bodyParserData?.body`                  |
| `req.target`                   | `req.rawTarget`                                     |
| `req.bodySize`                 | `req.bodyBytesReceived`，仅代表已到达字节           |
| 任意扩展 req.context 字段      | 对 RequestContext 声明合并                          |
| `res.sendFile(...)`            | 从 nova-http/static 导入 sendFile(req, res, path)   |

body 是单次消费流，不能在 bodyParser 后再次读取。原先假定完整输入已到达的处理器需要等待读取完成；未消费 body 时连接不复用。

## 公共 API 变化

core 不再导出 MiddlewareChain、composeRoute、createRouteBuilder 和 BUILTIN_HTTP_METHODS。改用 app.use、app.route、app.method 或 app.all。Handler、Middleware、ErrorMiddleware、MiddlewareContext 和 NextFunction 的公开导入路径保留。

主入口只类型导出 NovaRequest/NovaResponse，运行时类从 core 导入。HttpParser、BufferReader 被分段输入和显式解析工具取代，见 [HTTP/1 参考](../../api/http1)。

## Hooks

Hooks 不再继承 EventEmitter。on/off/emit 改为 addHook/removeHook/emitHook；once 没有直接替代，可在监听器内移除原函数。移除 callHookAsync 和 createRequestTimer，完整耗时使用 onResponse.durationMs。

HookEvents 支持声明合并，core、server 与中间件在所属模块定义事件。旧 CoreHookEvents/ServerHookEvents 汇总类型移除；上下文类型统一采用 *HookContext。需要拦截请求的逻辑移入中间件，onNotFound 在默认 404 确定后触发。

## 取消所有权与构造接口

```ts
new NovaRequest(meta, signal);
new NovaResponse(sink, { signal, onFailure });
```

RequestCancellation、req._abort、旧 res._abort 和 ResponseSink.abort 移除。协调层持有 AbortController，Request 与 Response 观察同一 signal。onFailure 必填、同步且不应抛错，用于通知不可恢复的输出失败。

不能简单把旧 abort 调用替换为修改 response 状态：协调层还需失败 body、清理计时器、验证当前交互身份并关闭传输。详细职责见[响应与取消](../../framework/internals/response-lifecycle)。

## 内部职责

Application 管理参与应用的完成观察者，NovaResponse 管理本地状态与输出。挂载创建独立路径视图，共享输入和取消状态。测试自定义适配器时，应覆盖提交前失败、提交后失败、迟到取消和 Keep-Alive 下一请求隔离。
