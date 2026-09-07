# 流式响应

Nova 可以直接发送 Node.js `Readable` 或 `AsyncIterable`，并在 TCP 写缓冲区饱和时将背压
传回数据源。HTTP/1.1 未知长度响应会自动使用 chunked framing，业务代码不需要手动编码 chunk。

## 发送数据源

```typescript
app.get("/generate", async (_req, res) => {
  res.setHeader("content-type", "text/plain; charset=utf-8");
  await res.stream(generateTokens());
});

async function* generateTokens() {
  yield "Hello";
  yield " ";
  yield "Nova";
}
```

`stream()` 接受 `Readable | AsyncIterable<string | Buffer | Uint8Array>`，正常消费完数据源后会
自动调用 `end()`。

## 手动写入

```typescript
app.get("/events", async (req, res) => {
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  await res.flushHeaders();

  for await (const event of events({ signal: req.signal })) {
    await res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  await res.end();
});
```

每次 `write()` 都应等待完成，以免生产速度持续高于网络发送速度。手动写入时必须在 handler
返回前调用 `end()`；否则框架会终止连接并报告 `ERR_RESPONSE_NOT_ENDED`。

## 超时与取消

`requestTimeout` 从请求解析完成后开始保护普通 handler，默认值是 600000 毫秒。响应首次调用
`flushHeaders()`、`write()` 或 `stream()` 进入流式模式时，该计时器会停止，因此 SSE 等长连接
不会被 `requestTimeout` 中断，也不需要专门将其设置为 `0`。

客户端断开、普通请求超时或服务关闭时，`req.signal` 会触发。将它传给数据库查询、生成器或其他
异步任务，可以及时停止不再需要的工作。调用 `app.close()` 时，Nova 会主动终止仍在运行的长期流，
并触发其取消信号，避免服务器关闭过程无限等待。

## 响应定界

- 显式设置 `Content-Length` 时，Nova 会校验实际写入字节数，不匹配时终止连接。
- 未设置长度的 HTTP/1.1 响应使用 chunked framing。
- 未设置长度的 HTTP/1.0 响应通过关闭连接定界，连接不会复用。
- `HEAD`、1xx、204、205 和 304 响应不会发送响应体。
