---
"nova-http": minor
---

重构 HTTP/1.1 输入内核，引入分段输入、有界请求头解析、独立消息 framing、Readable 请求体背压、严格 EOF 处理和连接生命周期协调

该版本移除 `BufferReader`、`HttpParser` 和完整 Buffer 请求体 API，请改用 `SegmentedInput`、`HeaderBlock`、`IncomingBody` 以及 `req.buffer()`、`req.text()`、`req.json()`
