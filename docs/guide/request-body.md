---
description: 选择一次性读取、bodyParser 或流式消费，并配置大小限制。
---

# 请求体

请求头解析完成后即可进入处理器，此时 body 可能尚未完整到达。`req.body` 是单次消费的 `IncomingBody` 流；选择一种读取方式，并把结果保存给后续逻辑。

## 读取 JSON 或文本

```ts
app.post("/echo", async (req, res) => {
  const text = await req.text("utf8", { maxSize: 64 * 1024 });
  res.send(text);
});
```

`req.buffer()` 返回 Buffer，`req.text()` 返回字符串，`req.json()` 聚合后执行 JSON 解析。`json<T>()` 的泛型只影响静态类型，不会校验业务字段；输入仍需运行时校验。

## 使用 bodyParser

```ts
import { bodyParser } from "nova-http";

app.post("/echo-json", bodyParser(), (req, res) => {
  const data = req.context.bodyParserData;
  if (!data) {
    res.status(415).json({ error: "Expected a non-empty JSON or form body" });
    return;
  }
  res.json(data.body);
});
```

`bodyParser()` 支持 JSON、`application/*+json` 和 URL 编码表单。默认 JSON 根值必须是对象或数组。空请求体或不支持的媒体类型会跳过；格式错误返回 400，超出物化大小限制返回 413。不要在它之后再次读取原始流。

## 按流消费

```ts
import { createHash } from "node:crypto";

app.post("/digest", async (req, res) => {
  const hash = createHash("sha256");
  for await (const chunk of req.body) hash.update(chunk);
  res.json({ sha256: hash.digest("hex") });
});
```

流式消费保留背压，适合增量计算或转发。不要在这个路由前注册会物化相同 body 的中间件。请求体未完整消费时，连接不会被复用；收到的 trailer 通过独立的 `req.trailers` 读取，不参与最初的请求决策。

## 大小与时间限制

`maxBodySize` 约束连接接收的总 body 字节数，`bodyParser.maxSize` 或读取方法的 `maxSize` 约束物化大小。两层限制同时生效。`bodyHighWaterMark` 是缓冲水位，不能替代总量限制。

`bodyIdleTimeout` 约束输入停顿；应用处理超时从请求头就绪、开始分发时计时。配置值见[配置参考](../api/configuration)。
