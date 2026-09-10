---
"nova-http": minor
---

重构应用、协议、服务端与静态文件模块的分层边界，并新增 `nova-http/protocol/http1`、`nova-http/static` 子路径导出。公开 `Application`、传输无关的请求/响应契约、HTTP/1 类型以及 `sendFile()` 等扩展接口。

挂载路径现在会在注册时校验并规范化；`app.use(path, ...)` 仅接受字面路径前缀，不再静默接受路由参数、通配符、查询字符串或其他异常前缀。
