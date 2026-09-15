---
description: Application、Router 与手动请求分发的公开内核入口。
---

# 应用内核

```ts
import { Application, Router, Hooks, NovaRequest, NovaResponse } from "nova-http/core";
```

这些运行时类用于扩展和协议适配。普通应用从主入口调用 `createApp()` 即可。内核没有 TCP 监听方法，也不依赖 HTTP/1 实现。

## Application

`new Application()` 创建路由、中间件和 Hooks 容器。实例支持[路由 API](./routing)，公开 `hooks: Hooks`，以及以下分发方法：

```ts
app.dispatch(req: NovaRequest, res: NovaResponse): Promise<void>;
```

执行当前应用中间件、路由、错误路径和默认响应，等待输出完成，再通知参与应用的成功完成观察者。分发结束不自动代表底层连接可复用，输入完整性与连接策略由协调层判断。

## Router

```ts
const router = new Router();
router.add("GET", "/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});
const match = router.find("GET", "/users/42");
```

| 方法 / 属性                    | 返回值                | 作用                   |
| ------------------------------ | --------------------- | ---------------------- |
| `add(method, path, handler)`   | `void`                | 注册单个 Handler       |
| `find(method, pathname)`       | `RouteMatch \| null`  | 查询处理器和参数       |
| `findAllowedMethods(pathname)` | `string[]`            | 当前匹配路径注册的方法 |
| `routes`                       | 只读 method/path 数组 | 注册记录               |

`RouteMatch` 包含 `handler: Handler` 和 `params: Record<string, string>`。独立 Router 只匹配，不自动将参数赋给 req；Application 负责注入参数和调用处理器。

## 构造请求与响应

```ts
new NovaRequest(meta: IncomingRequestMeta, signal: AbortSignal);
new NovaResponse(sink: ResponseSink, options: ResponseOptions);
```

ResponseOptions 的 signal 与 onFailure 都必填。协调层持有 AbortController、请求体输入和传输资源；onFailure 是不可恢复输出失败的同步通知，不应抛错。构造的完整契约见[消息参考](./message)，所有权规则见[响应与取消](../framework/internals/response-lifecycle)。

## 边界

Hooks 的注册、移除与派发见 [Hooks](./hooks)。入口也重导出处理函数、消息与上下文类型。MiddlewareChain、composeRoute、createRouteBuilder 和 BUILTIN_HTTP_METHODS 为内部实现，不提供深路径导入承诺。
