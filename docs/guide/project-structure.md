---
description: 区分应用组装与监听，使用子应用组织业务模块。
---

# 项目组织

小型服务可以从一个文件开始。路由增加后，将应用组装、业务模块和进程启动分开，测试就能在随机端口启动同一套应用。

```text
src/
├── app.ts             创建应用，注册中间件和路由
├── server.ts          读取环境变量，监听端口和关闭信号
├── users/
│   ├── routes.ts      HTTP 输入与输出
│   └── service.ts     业务逻辑
└── middleware/
    └── request-id.ts  请求级共享能力
```

这是组织建议；CLI 的 `api` 模板可以作为实际起点，其 TS/JS 版本共享相同用途。

## 组装应用

```ts
import { createApp } from "nova-http";

export function buildApp() {
  const app = createApp();
  const users = createApp();
  users.get("/:id", (req, res) => {
    res.json({ id: req.params.id });
  });
  app.use("/api/users", users);
  return app;
}
```

只有根应用需要调用 `listen()`。子应用处理相对路径，数据库等共享资源可以通过闭包传入业务模块，或通过类型化的[请求上下文](./request#请求上下文)供中间件共享。

## 启动与配置

```ts
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

Nova 不自动读取 `.env`。环境变量读取、校验和业务资源初始化由启动层负责。服务关闭方式见[部署与运行](./deployment)。
