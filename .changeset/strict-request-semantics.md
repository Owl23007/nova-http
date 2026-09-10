---
"nova-http": minor
---

严格校验并解析 HTTP/1 request-target，区分原始目标与应用路由路径；完善 `NovaRequest` 请求语义，以 `rawTarget`、`path` 和 `bodyBytesReceived` 提供明确的只读信息，并正确识别结构化 JSON 媒体类型及保留 Cookie 原始值。

扩展 `trustProxy`，支持布尔值、可信代理跳数或逐跳判断函数，并根据可信代理链安全地解析 `req.ip`。
