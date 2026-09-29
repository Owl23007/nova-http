---
description: 按业务模块拆分应用，并将应用组装与进程启动分开。
---

# 项目组织

小型服务可以从一个文件开始。

随着路由和业务逻辑增加，我们推荐将代码拆成三部分：

- **业务模块**：负责一组相关路由和业务逻辑
- **应用组装**：将各个业务模块挂载到根应用
- **进程启动**：读取配置、初始化资源并监听端口

::: tip
Nova 不强制项目结构。下面只是一种适合多数应用的组织方式，可以根据项目规模和团队习惯调整。
如果你有值得复用的实践，也欢迎通过 Issue 或 PR 分享，一同参与社区建设。❤️
:::

## 项目结构

一个项目可以按业务模块组织：

```text
src/
├── app.ts             // 创建根应用并组装业务模块
├── server.ts          // 读取配置、初始化资源并启动服务
├── users/
│   ├── routes.ts      // 用户模块的 HTTP 输入与输出
│   └── service.ts     // 用户模块的业务逻辑
├── posts/
│   ├── routes.ts      // 帖子模块的 HTTP 输入与输出
│   └── service.ts     // 帖子模块的业务逻辑
└── middleware/
    └── request-id.ts  // 跨模块使用的中间件
```

::: info CLI 模板
CLI 的 `api` 模板采用更简单的结构，按 `routes/` 和 `middlewares/` 拆分代码，并将应用组装和启动放在同一个 `app.ts` 中。项目增长后，更推荐逐步演进为更清晰的结构。

我们确信根据项目规模和团队习惯调整结构是更好的选择，而不是一开始就强制使用复杂的结构。
:::

## 按业务模块拆分

随着业务增加，可以让每个模块独立维护自己的路由和业务逻辑。

如果你熟悉 Spring Boot 或 NestJS，可以把这种组织方式理解为类似的业务模块划分：用户、订单、文章等能力各自维护内部实现，再由应用入口统一组装。

例如用户模块可以分别维护 HTTP 路由和业务逻辑：

```ts
// users/routes.ts
import { createApp } from "nova-http";
import { getUser } from "./service";

export function createUsersApp() {
  const users = createApp();

  users.get("/", (req, res) => {
    res.json([]);
  });

  users.get("/:id", (req, res) => {
    res.json(getUser(req.params.id));
  });

  return users;
}
```

像一般的 RESTful 框架一样，`res.json()` 会自动设置 `Content-Type: application/json`，并将对象序列化为 JSON。

业务逻辑放在同一模块中：

```ts
// users/service.ts
export function getUser(id: string) {
  return { id };
}
```

这里的拆分只是组织方式，也可以按照 controller、service、repository 等职责分层进行拆分。

## 使用子应用组织路由

在 Nova 中，可以使用子应用表示一组相关路由和中间件，再由根应用统一挂载。

在 `app.ts` 中组合各个业务模块：

```ts
// app.ts
import { createApp } from "nova-http";
import { createUsersApp } from "./users/routes";
import { createPostsApp } from "./posts/routes";

export function buildApp() {
  const app = createApp();

  app.use("/api/users", createUsersApp());
  app.use("/api/posts", createPostsApp());

  return app;
}
```

子应用只维护模块内部的相对路由，最终路径由挂载位置决定。

例如：

```ts
app.use("/api/users", users);

users.get("/:id", handler);
```

最终匹配：

`GET /api/users/:id`

| 模块    | 模块内路由 | 最终路由         |
| ------- | ---------- | ---------------- |
| `users` | `/`        | `/api/users/`    |
| `users` | `/:id`     | `/api/users/:id` |
| `posts` | `/:id`     | `/api/posts/:id` |

因此，同一个模块可以挂载到不同位置：

```ts
app.use("/api/v1/users", createUsersApp());
app.use("/api/v1/posts", createPostsApp());
```

模块本身不需要因为路径前缀变化而修改。

关于子应用的挂载、嵌套和匹配规则，见[路由与子应用](./04-router)。

## 共享业务依赖

数据库客户端、配置和其他业务依赖可以在创建模块时传入：

```ts
export function createUsersApp(usersService: UsersService) {
  const users = createApp();

  users.get("/:id", async (req, res) => {
    const user = await usersService.findById(req.params.id);

    res.json(user);
  });

  return users;
}
```

再由应用组装层提供依赖：

```ts
export function buildApp(deps: AppDependencies) {
  const app = createApp();

  app.use("/api/users", createUsersApp(deps.users));

  return app;
}
```

这样，业务模块只使用自己需要的依赖，不需要自行读取环境变量或创建数据库连接。

如果数据需要在一次请求的多个中间件和处理器之间共享，可以使用[请求上下文](./06-request#请求上下文)。

## 启动服务

`server.ts` 负责进程级工作，例如读取环境变量、初始化资源和监听端口：

```ts
// server.ts
import { buildApp } from "./app";

async function main() {
  const port = Number(process.env.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const app = buildApp();

  await app.listen(port, "127.0.0.1");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

只有最外层应用需要监听端口。

将应用组装和进程启动分开后，`buildApp()` 可以用于正常启动、测试或其他运行方式，业务模块不需要关心监听地址。

::: warning
Nova 不自动读取 `.env`。

环境变量读取、配置校验和数据库等资源初始化，应由启动层负责。

服务关闭和生产环境运行方式见[部署与运行](./14-deployment)。
