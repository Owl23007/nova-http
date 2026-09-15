---
description: 使用 CLI 创建项目，或运行一个最小 JavaScript HTTP 服务。
---

# 快速开始

准备 Node.js 与 npm。以下两种方式都可以启动服务；CLI 会生成项目结构，单文件方式便于查看最小代码。

## 创建项目

::: code-group

```sh [TypeScript]
npm create nova-http@latest my-app -- --template minimal --lang ts
cd my-app
npm install
npm run dev
```

```sh [JavaScript]
npm create nova-http@latest my-app -- --template minimal --lang js
cd my-app
npm install
npm run dev
```

:::

默认生成 `minimal` TypeScript 模板。需要路由和中间件分目录的起点时，使用 `--template api`。完整选项见 [CLI 参考](../api/cli)。

## 运行单文件服务

在空目录中执行 `npm init -y` 和 `npm install nova-http`，创建 `app.mjs`：

<<< @/examples/hello.mjs{js}

```sh
node app.mjs
```

`.mjs` 使用 ESM，允许顶层 `await`。TypeScript 模板已有自身的编译和启动配置，无需将此文件改名后直接替换模板。

## 验证响应

```sh
curl http://127.0.0.1:3000/hello/Nova
```

预期响应：

```json
{ "hello": "Nova" }
```

Windows PowerShell 如果将 `curl` 解析为别名，可以使用 `curl.exe`。端口被占用时修改 `app.listen()` 的端口；停止本地服务使用 Ctrl+C。

接下来阅读[路由与子应用](./router)，或从[项目组织](./project-structure)开始拆分业务模块。
