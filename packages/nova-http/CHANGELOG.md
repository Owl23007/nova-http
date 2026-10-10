# nova-http

## 0.3.0

### Minor Changes

- 2ba02e0: 收敛公开入口：主入口提供日常应用 API，消息构造器 HeaderBlock、IncomingBody 及 ResponseOptions 从 `nova-http/core` 导入，HTTP/1 协议类型从 `nova-http/protocol/http1` 导入。主入口不再导出内部 Http1ConnectionConfig，应用配置使用 NovaConfig；保留已发布的 ParsedRequest 与 RouteMatch 类型导入兼容现有代码。

  NovaConfig 独立定义应用选项，ListenAddress 保持现有监听地址结构，应用生命周期钩子契约归应用门面所有；不再通过这些类型暴露连接协调器与 server 实现。现有配置、默认值、钩子声明合并及同步 checkContinue 行为不变。

- c5b7ea0: 将 core Hook 机制与核心生命周期事件保留在 `core/hooks`，server 和 middleware/plugin 事件由各自所属模块通过声明合并扩展。Context 类型统一使用 `*HookContext` 命名，并移除 `CoreHookEvents` 与 `ServerHookEvents` 汇总类型。
- 0ce768b: 明确 middleware 参与控制流、hook 仅观察生命周期的边界。
  移除 `callHookAsync` 和冗余的 `createRequestTimer()`，请直接使用 `onResponse.durationMs` 记录或上报请求耗时；同时使 `onNotFound` 在默认 404 响应确定后触发。
- f866f76: 收口 HTTP/1 correctness：HTTP/1.0 忽略 Upgrade 和 Expect，未接受的 Upgrade 不再阻止普通连接复用，server 在应用分发前明确拒绝 CONNECT tunnel，响应工具避免 CONNECT 2xx 的错误定界。

  校验 chunk-extension 与 Transfer-Encoding grammar，区分格式错误 400 和不支持的编码 501；新增 parserLimits.maxChunkMetadataBytes（默认每请求 64 KiB，累计 size 行、CRLF 与 trailers，不含 payload）。补齐 URI 边界校验，并通过 req.authority 和 ParsedHead.authority 明确 effective authority。已验证的 HTTP 语义作为 0.3 冻结基线。

- 53a3725: 重构应用、协议、服务端与静态文件模块的分层边界，并新增 `nova-http/protocol/http1`、`nova-http/static` 子路径导出。公开 `Application`、传输无关的请求/响应契约、HTTP/1 类型以及 `sendFile()` 等扩展接口。

  挂载路径现在会在注册时校验并规范化；`app.use(path, ...)` 仅接受字面路径前缀，不再静默接受路由参数、通配符、查询字符串或其他异常前缀。

- d0b3809: 将最低运行版本提升至 Node.js 20，并同步更新生成项目的运行声明及 TypeScript 模板使用的 Node.js 20 类型定义。
- db25c85: 重构 HTTP/1.1 输入内核，引入分段输入、有界请求头解析、独立消息 framing、Readable 请求体背压、严格 EOF 处理和连接生命周期协调

  移除 `BufferReader`、`HttpParser` 和完整 Buffer 请求体 API，改用 `SegmentedInput`、`HeaderBlock`、`IncomingBody` 以及 `req.buffer()`、`req.text()`、`req.json()`

- 53a3725: 严格校验并解析 HTTP/1 request-target，区分原始目标与应用路由路径；完善 `NovaRequest` 请求语义，以 `rawTarget`、`path` 和 `bodyBytesReceived` 提供明确的只读信息，并通过 `RequestContext` 扩展 `req.context`。同时正确识别结构化 JSON 媒体类型及保留 Cookie 原始值。

  扩展 `trustProxy`，支持布尔值、可信代理跳数或逐跳判断函数，并根据可信代理链安全地解析 `req.ip`。

### Patch Changes

- a195346: 通过可选的 ResponseSink.sendFixed 增加内部定长响应一次提交能力，send、json、html 由 HTTP/1 适配器一次批量输出，无背压时同步完成，有背压时等待 drain。

  保留旧 sink 的 commit/write/end 兼容及完整 streaming 异步 pipeline，维持统一输出架构、HTTP 定界、字节计数、取消、连接复用和首次失败语义。

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
