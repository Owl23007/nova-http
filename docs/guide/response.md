---
description: 发送 JSON、文本、重定向和空响应，理解响应提交边界。
---

# 响应

先设置状态和响应头，再发送内容。`send()`、`json()`、`html()` 与 `redirect()` 负责一次性响应；流式内容使用 `write()` 或 `stream()`。

## 状态与内容

```ts
app.get("/health", (_req, res) => {
  res.setHeader("cache-control", "no-store");
  res.status(200).json({ status: "ok" });
});

app.delete("/session", async (_req, res) => {
  res.status(204);
  await res.end();
});
```

`json()` 设置 JSON Content-Type 并序列化，`send()` 发送字符串或 Buffer，`html()` 设置 HTML Content-Type。默认状态是 200。空响应使用 `end()`，不要为 204 人工添加 body。

## 响应头与 Cookie

```ts
res.setHeader("set-cookie", "theme=dark; Path=/; SameSite=Lax");
res.setHeader("set-cookie", "language=zh; Path=/; SameSite=Lax");
```

普通字段同名写入覆盖旧值；`set-cookie` 会追加独立字段。`getHeader()` 与 `removeHeader()` 忽略字段名大小写。

## 提交与结束

`headersSent` 表示响应已提交，之后无法修改状态码或响应头。`writableEnded` 表示响应成功结束；已提交的响应仍可能正在发送，不能用 `headersSent` 判断传输完成。

一次性方法返回 `void`，框架等待底层完成；流式方法返回 Promise，应等待写入并显式结束手动流。每次请求只选择一条响应路径。

::: warning 提交后的错误
响应开始后出现不可恢复错误，框架会终止交互。错误处理器不能再次写入一条 JSON 或 500 响应。错误边界见[错误处理](./error-handling)。
:::

详细签名见 [NovaResponse](../api/response)；文件响应见[静态文件](./static-files)。
