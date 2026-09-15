---
description: 使用 next 组织请求控制流，处理异步操作和中止响应。
---

# 中间件

中间件适合校验输入、鉴权和填充请求上下文。全局中间件在路由匹配前执行，路由中间件只参与对应路由。

## 继续或结束请求

```ts
import { createApp, type Middleware } from "nova-http";

const app = createApp();
const requireClient: Middleware = (req, res, next) => {
  if (!req.getHeader("x-client-id")) {
    res.status(400).json({ error: "Missing x-client-id" });
    return;
  }
  next();
};

app.get("/private", requireClient, (_req, res) => {
  res.json({ ok: true });
});
```

每条执行分支必须调用 `next()`、发送响应或抛出错误。只返回而没有响应或 `next()`，会使中间件链等待。发送响应后立即 `return`，避免继续处理业务。

## 异步操作

在调用 `next()` 之前等待当前中间件负责的工作。`NextFunction` 返回 `void`，`await next()` 不会等待下游完成，因此不能用它测量完整请求耗时；耗时观测使用 [`onResponse`](./hooks)。

```ts
import { setTimeout } from "node:timers/promises";

app.use(async (req, _res, next) => {
  await setTimeout(1, undefined, { signal: req.signal });
  next();
});
```

不要在交出控制权后继续执行需要框架捕获错误的异步任务。处理器抛错或 `next(error)` 会进入[错误处理](./error-handling)。

## 注册范围

```ts
app.use(requireClient); // 所有请求
app.use("/api", requireClient); // 字面路径前缀
```

全局中间件按 `use()` 的注册顺序执行，然后才匹配路由。前缀中间件保留 `req.pathname` 原值。需要相对路径时使用[子应用挂载](./router#挂载子应用)。

函数需要访问所属应用的 Hooks 时，使用普通函数和 `Middleware` 类型，参见[扩展开发](../framework/extensions)。
