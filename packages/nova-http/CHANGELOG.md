# nova-http

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
