---
description: 路由注册、RouteBuilder、use 与匹配结果的准确语义。
---

# 路由

这些方法由 `Application` 提供，Nova 实例继承它们。使用教程见[路由与子应用](../guide/router)。

## 方法注册

```ts
app.get(path, ...handlers);
app.post(path, ...handlers);
app.put(path, ...handlers);
app.patch(path, ...handlers);
app.delete(path, ...handlers);
app.head(path, ...handlers);
app.options(path, ...handlers);
app.method(method, path, ...handlers);
app.all(path, ...handlers);
```

方法返回当前应用。path 是字符串，handlers 为 `Middleware | Handler` 的序列，最后一个作为终端处理器。没有处理器时当前实现不注册路由。重复注册相同方法与路径会覆盖最终处理器，避免依赖重复注册的 `routes` 列表表现。

`method` 使用合法 HTTP token 并转为大写。`all` 注册 GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS，不包含任意扩展方法。HEAD 没有 GET 回退，OPTIONS 没有自动业务响应。

## route

```ts
app.route(path: string): RouteBuilder;
```

`RouteBuilder` 提供七种内置方法、`all()` 和 `method(method, ...handlers)`，每次返回构建器，可以对相同路径链式注册。自定义 HTTP 方法也可以通过应用的 `method()` 注册。

## use

```ts
app.use(middleware, ...middlewares);
app.use(prefix, ...middlewares);
app.use(prefix, childApp);
```

接收普通中间件、错误中间件或 Application；返回当前应用。前缀必须以单个 `/` 开头，不含 query、fragment、参数段或通配符段。前缀尾部 `/` 会移除，根路径保持 `/`。

普通前缀中间件只筛选路径，不重写路径。挂载 Application 才会创建相对路径视图。中间件总是在当前应用的路由匹配前运行。

## 匹配行为

静态段优先于参数段，再到 `*`。查询参数不参与匹配。路径会按路由器规则规范化尾部斜杠；参数解码失败时保留原值。精确路径存在但没有对应方法时返回 405 和 Allow；没有路径时返回 404。

`app.routes` 返回 `ReadonlyArray<{ method: HttpMethod; path: string }>`，描述当前应用自己的注册记录，不会展开所有子应用。

独立 Router 的 `add`、`find` 和 `findAllowedMethods` 见[应用内核](./core#router)。
