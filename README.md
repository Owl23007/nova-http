# Nova

[English](./README_EN.md) · [应用开发](./docs/guide/introduction.md) · [API 参考](./docs/api/index.md) · [框架开发](./docs/framework/index.md)

Nova 是基于 Node.js TCP 的轻量 HTTP 框架，使用 TypeScript 编写，生产运行不依赖第三方包。提供方法路由、中间件、子应用、类型化生命周期钩子，以及支持背压的请求体和响应流。

## 快速开始

```sh
npm create nova-http@latest my-app -- --template minimal --lang ts
cd my-app
npm install
npm run dev
```

也可以安装 `npm install nova-http`，创建 `app.mjs`：

```js
import { createApp } from "nova-http";

const app = createApp();
app.get("/hello/:name", (req, res) => {
  res.json({ hello: req.params.name });
});
await app.listen(3000, "127.0.0.1");
```

执行 `node app.mjs`，请求 `http://127.0.0.1:3000/hello/Nova`。

## 文档

| 任务             | 入口                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 创建与组织应用   | [快速开始](./docs/guide/getting-started.md)、[路由](./docs/guide/router.md)、[中间件](./docs/guide/middleware.md)                |
| 处理输入与输出   | [请求体](./docs/guide/request-body.md)、[流式响应](./docs/guide/streaming-response.md)、[静态文件](./docs/guide/static-files.md) |
| 查询接口与默认值 | [API](./docs/api/index.md)、[配置](./docs/api/configuration.md)、[CLI](./docs/api/cli.md)                                        |
| 测试与部署       | [应用测试](./docs/guide/testing.md)、[部署](./docs/guide/deployment.md)                                                          |
| 扩展与修改框架   | [架构](./docs/framework/architecture.md)、[扩展](./docs/framework/extensions.md)、[贡献](./docs/framework/contributing/setup.md) |
| 升级现有代码     | [版本说明](./docs/releases/index.md)、[Core API 迁移](./docs/releases/migrations/core-api.md)                                    |

文档站包含完整示例、参数参考、内核说明和设计记录。本站与仓库文档描述当前工作区，尚未发布的重构可能与 npm 版本不同。

## 运行范围

包声明 Node.js ≥ 18，仓库 CI 测试 Node.js 20、22、24；贡献工具链使用 Node.js 24。Nova 的接口采用 Express 风格，但不承诺兼容依赖 Express 或 Node HTTP 对象内部实现的中间件。

服务器提供 HTTP/1.0 与 HTTP/1.1，TLS 可由入口代理处理。数据库、认证和业务校验由应用组织。性能测量见[方法与历史报告](./docs/framework/performance/index.md)。

## 本地开发

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm docs:dev
```

全量测试需要 Redis 与 node:sqlite，按模块验证的命令见[测试与回归](./docs/framework/contributing/testing.md)。文档提交前运行 `pnpm docs:check` 和 `pnpm docs:build`。

## 许可证

[MIT](./LICENSE) © Owl23007
