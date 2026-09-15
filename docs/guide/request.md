---
description: 读取路径、查询参数、HTTP 字段与类型化请求上下文。
---

# 请求与上下文

`NovaRequest` 提供路由处理所需的路径、字段、请求体和取消信号。查询参数和 Cookie 在首次读取时解析，请求体需要显式消费。

## 路径与查询参数

```ts
app.get("/search", (req, res) => {
  const query = req.query.get("q") ?? "";
  const tags = req.query.getAll("tag");
  res.json({ query, tags });
});
```

对于 `/search?q=nova&tag=http&tag=node`，`path` 包含查询字符串，`pathname` 是 `/search`，`rawTarget` 保存原始请求目标。路径不做 URI 解码或点路径段消除；路由参数有自己的解码逻辑。

## 字段与 Cookie

```ts
const contentType = req.getHeader("content-type");
const values = req.headers.getAll("x-tag");
const session = req.cookies.session;
```

Header 名称查询忽略大小写，`get()` 返回首个值，`getAll()` 保留重复字段。Cookie 值保持百分号编码，不自动执行 URI 解码。`req.ip` 的来源由 [`trustProxy`](../api/configuration#代理信任) 决定。

## 请求上下文

使用声明合并定义中间件拥有的字段，并在运行时设置值。字段标为可选，处理器才能显式应对中间件尚未执行的情况。

```ts
import { randomUUID } from "node:crypto";
import { createApp } from "nova-http";

declare module "nova-http" {
  interface RequestContext {
    requestId?: string;
  }
}

const app = createApp();
app.use((req, res, next) => {
  req.context.requestId = randomUUID();
  res.setHeader("x-request-id", req.context.requestId);
  next();
});
```

子应用共享同一个 context 对象。修改字段可以跨视图共享，避免整体替换 `req.context`。

## 取消信号

将 `req.signal` 传给支持 AbortSignal 的异步操作。断连、超时和服务关闭可能取消请求；业务库必须实际支持该信号才能停止工作。属性与读取方法的完整列表见 [NovaRequest](../api/request)。
