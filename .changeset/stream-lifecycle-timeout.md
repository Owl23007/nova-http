---
"nova-http": patch
---

修正流式响应的超时与关闭生命周期：`requestTimeout` 继续保护普通异步请求，但响应进入 streaming 状态后不再作为长流总时限；服务器优雅关闭时会主动终止长期 streaming 响应，避免 SSE 等连接无限阻塞 `app.close()`。
