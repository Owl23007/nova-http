---
description: 使用异步迭代器或手动写入发送流式响应，处理背压、结束和取消。
---

# 流式响应

用 `stream()` 转发 Node.js Readable 或异步迭代器；需要精确控制响应头和每次写入时，使用 `flushHeaders()`、`write()` 与 `end()`。HTTP 定界和底层背压由框架处理。

## 发送数据源

```ts
app.get("/generate", async (_req, res) => {
  res.setHeader("content-type", "text/plain; charset=utf-8");
  await res.stream(generate());
});

async function* generate() {
  yield "Hello";
  yield " ";
  yield "Nova";
}
```

`stream()` 正常消费完数据源后自动结束响应。异步迭代器在首块产生前失败且尚未提交响应头时，错误中间件仍可恢复；响应头提交后的失败会终止交互。

## 手动写入

```ts
app.get("/progress", async (_req, res) => {
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  await res.flushHeaders();
  await res.write('{"progress":0}\n');
  await res.end('{"progress":100}\n');
});
```

逐次 `await write()` 让生产速度跟随输出速度。内部队列保证调用顺序，但大量不等待的调用仍会积压内存。手动流必须在处理器返回前请求结束，否则产生 `ERR_RESPONSE_NOT_ENDED`。

## 超时与取消

当前工作区在请求头就绪、开始分发时启动 `requestTimeout`。响应进入输出生命周期后停止该计时器，包括 `flushHeaders()`、`write()`、`stream()`，以及一次性响应提交。请求体空闲超时仍独立生效。

长期 SSE 不受 `requestTimeout` 作为总时限限制。应用如需截止时间，应自行管理数据源。客户端断开、请求超时或服务器关闭时，`req.signal` 可取消关联操作；框架销毁 Readable 或请求异步迭代器退出，但生产者仍需主动响应取消。

调用 `app.close()` 会终止已经提交、仍在运行的响应，避免长期流阻塞关闭。完整可运行的定时事件示例见 [SSE 事件流](./recipes/sse)。

## 响应定界

| 条件                     | 输出方式             | 连接复用                       |
| ------------------------ | -------------------- | ------------------------------ |
| HTTP/1.1，未知长度       | chunked              | 完整结束且满足输入条件后可复用 |
| 已设置 Content-Length    | 定长；校验实际字节数 | 长度匹配且协议允许时可复用     |
| HTTP/1.0，未知长度       | 关闭连接定界         | 不复用                         |
| HEAD、1xx、204、205、304 | 不发送响应体         | 根据请求与状态处理             |

不要手动编码 chunk 或设置 `Transfer-Encoding`。定长模式的长度单位是字节，字符串长度不一定等于 UTF-8 字节数。方法契约见 [NovaResponse](../api/response)，实现机制见[响应与取消](../framework/internals/response-lifecycle)。
