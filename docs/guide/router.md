---
description: 注册方法路由，理解匹配优先级、挂载路径和子应用视图。
---

# 路由与子应用

路由由 HTTP 方法、路径和处理器组成。处理器接收 `req` 与 `res`，可以同步发送响应，也可以等待异步业务完成。

## 方法与路径

```ts
import { createApp } from "nova-http";

const app = createApp();
app.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});
app.method("PROPFIND", "/files", (_req, res) => {
  res.status(200).send("Files");
});
```

| 路径             | 匹配示例         | 读取方式          |
| ---------------- | ---------------- | ----------------- |
| `/users/profile` | `/users/profile` | 静态路径          |
| `/users/:id`     | `/users/42`      | `req.params.id`   |
| `/files/*`       | `/files/a/b.txt` | `req.params['*']` |

静态路径优先于参数，参数优先于通配符。查询字符串不参与路由匹配。`all()` 注册七种内置方法；扩展方法仍需显式 `method()` 注册。`HEAD` 需要单独注册，当前路由器没有自动回退到 `GET`。

## 同一路径的多个方法

```ts
app
  .route("/status")
  .get((_req, res) => {
    res.json({ ready: true });
  })
  .head(async (_req, res) => {
    await res.end();
  });
```

路由允许前置[中间件](./middleware)。最后一个函数作为终端处理器，前面的函数通过 `next()` 交出控制权。

## 挂载子应用

```ts
const users = createApp();
users.get("/:id", (req, res) => {
  res.json({ path: req.pathname, id: req.params.id });
});
app.use("/api/users", users);
```

请求 `/api/users/42?active=1` 时，子应用看到的 `pathname` 是 `/42`，查询参数保留。父子请求视图共享 body、headers、context 和取消信号，路径与参数独立。子应用没有匹配路由时回到父应用；路径存在而方法不支持时会返回 405。

::: info 挂载路径与中间件路径
`app.use('/api', middleware)` 只筛选路径，传给普通中间件的路径仍含 `/api`。`app.use('/api', childApp)` 才创建移除前缀的请求视图。挂载前缀必须是字面路径，不能含 `:id` 或 `*` 段；`/api` 不匹配 `/apix`。
:::

## 未命中与方法不允许

没有路径匹配时返回 404；路径匹配但方法未注册时返回 405，并附 `Allow` 响应头。不要用全局中间件直接发送兜底响应，它会在路由匹配之前运行。行为细节见[路由 API](../api/routing)。
