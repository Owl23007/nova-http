# nova-http

基于 Node.js `net` 模块实现的零依赖 HTTP 框架，提供 TypeScript 类型、Radix Tree 路由、
中间件、生命周期钩子、Keep-Alive 和背压感知的流式响应。

## 安装

```bash
npm install nova-http
```

## 快速开始

```typescript
import { createApp } from "nova-http";

const app = createApp();

app.get("/", (_req, res) => {
  res.json({ hello: "Nova!" });
});

await app.listen(3000);
```

## 流式响应

```typescript
app.get("/stream", async (req, res) => {
  res.setHeader("content-type", "text/plain; charset=utf-8");

  for await (const chunk of createSource(req.signal)) {
    await res.write(chunk);
  }

  await res.end();
});

async function* createSource(signal: AbortSignal) {
  for (const chunk of ["Hello", " ", "Nova"]) {
    if (signal.aborted) return;
    yield chunk;
  }
}
```

也可以使用 `await res.stream(readableOrAsyncIterable)` 自动消费数据源并结束响应。
`requestTimeout` 覆盖 handler 和完整响应流生命周期；SSE 等长连接可通过
`createApp({ requestTimeout: 0 })` 禁用该限制。

完整 API、示例与设计说明请查看
[GitHub README](https://github.com/Owl23007/nova-http#readme)。
