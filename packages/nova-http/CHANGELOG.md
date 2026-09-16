# nova-http

## 0.3.0

### Minor Changes

- c5b7ea0: 将 core Hook 机制与核心生命周期事件保留在 `core/hooks`，server 和 middleware/plugin 事件由各自所属模块通过声明合并扩展。Context 类型统一使用 `*HookContext` 命名，并移除 `CoreHookEvents` 与 `ServerHookEvents` 汇总类型。
- 0ce768b: 明确 middleware 参与控制流、hook 仅观察生命周期的边界。
  移除 `callHookAsync` 和冗余的 `createRequestTimer()`，请直接使用 `onResponse.durationMs` 记录或上报请求耗时；同时使 `onNotFound` 在默认 404 响应确定后触发。
- 53a3725: 重构应用、协议、服务端与静态文件模块的分层边界，并新增 `nova-http/protocol/http1`、`nova-http/static` 子路径导出。公开 `Application`、传输无关的请求/响应契约、HTTP/1 类型以及 `sendFile()` 等扩展接口。

  挂载路径现在会在注册时校验并规范化；`app.use(path, ...)` 仅接受字面路径前缀，不再静默接受路由参数、通配符、查询字符串或其他异常前缀。

- db25c85: 重构 HTTP/1.1 输入内核，引入分段输入、有界请求头解析、独立消息 framing、Readable 请求体背压、严格 EOF 处理和连接生命周期协调

  移除 `BufferReader`、`HttpParser` 和完整 Buffer 请求体 API，改用 `SegmentedInput`、`HeaderBlock`、`IncomingBody` 以及 `req.buffer()`、`req.text()`、`req.json()`

- 53a3725: 严格校验并解析 HTTP/1 request-target，区分原始目标与应用路由路径；完善 `NovaRequest` 请求语义，以 `rawTarget`、`path` 和 `bodyBytesReceived` 提供明确的只读信息，并通过 `RequestContext` 扩展 `req.context`。同时正确识别结构化 JSON 媒体类型及保留 Cookie 原始值。

  扩展 `trustProxy`，支持布尔值、可信代理跳数或逐跳判断函数，并根据可信代理链安全地解析 `req.ip`。

### Patch Changes

- 53a3725: 修正普通中间件、路由中间件、子应用与错误处理中间件之间的同步和异步错误传播，并防止同一次中间件调用重复执行 `next()` 导致处理链越级。

## 0.2.1

### Patch Changes

- 03af338: 修正流式响应的超时与关闭生命周期：`requestTimeout` 继续保护普通异步请求，但响应进入 streaming 状态后不再作为长流总时限；服务器优雅关闭时会主动终止长期 streaming 响应，避免 SSE 等连接无限阻塞 `app.close()`。

## 0.2.0

### Minor Changes

- 495e8b6: 新增通用流式响应 API
  - 新增 `res.flushHeaders()`、`res.write()`、`res.end()` 和 `res.stream()`，支持 `AsyncIterable`、Node.js `Readable`、HTTP/1.1 chunked framing 与 socket 背压。
  - 新增 `req.signal`，在客户端断开、请求超时或服务关闭时取消流及关联异步任务。
  - 修正流式响应期间的 Keep-Alive、HTTP pipelining、半关闭连接、响应错误与 `onResponse` 生命周期。
  - 修正 `205 Reset Content` 错误发送响应体的问题。
  - `requestTimeout` 现在覆盖 handler 和完整响应流生命周期；手动流式写入应逐次 `await res.write()`，并在 handler 返回前调用 `res.end()`。
