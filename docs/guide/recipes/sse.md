---
description: 用通用流式 API 发送可取消的 Server-Sent Events。
---

# SSE 事件流

SSE 使用普通 HTTP 响应持续发送文本事件。下面的服务发送三条 tick 事件后结束，便于验证分块、事件编码和取消处理。

## 服务代码

安装 `nova-http`，保存为 `app.mjs` 并运行 `node app.mjs`：

<<< @/examples/sse.mjs{js}

## 验证输出

```sh
curl -N http://127.0.0.1:3000/events
```

每条事件以空行结束，`data` 使用 JSON 序列化，避免内容中的换行破坏事件边界。浏览器可以用 `EventSource` 读取：

```js
const events = new EventSource("http://127.0.0.1:3000/events");
events.addEventListener("tick", (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
  if (data.id === 3) events.close();
});
```

浏览器示例假设页面与接口同源，或应用已实现适当的跨域响应。演示主动关闭 EventSource，避免有限流结束后浏览器自动重连。

## 改为长期事件源

将有限循环替换为业务异步迭代器，并将 `req.signal` 传入生产者。等待每次写入，结束时清理订阅、计时器和外部资源。心跳、Last-Event-ID 恢复策略和重试规则由应用实现，Nova 没有内置 SSE helper。

响应超时与代理限制见[流式响应](../streaming-response)和[部署与运行](../deployment)。
