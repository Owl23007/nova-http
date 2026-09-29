---
description: 使用 CLI 创建 Nova 项目，或运行一个最小 HTTP 服务。
---

# 快速开始

准备 [Node.js](https://nodejs.org/) 20 或更高版本与 npm。

推荐使用 CLI 创建项目。如果只是想快速体验 Nova，也可以直接运行一个最小单文件服务。

## 创建项目

运行交互式 CLI：

```sh
npm create nova-http@latest
```

按照提示选择项目名称、模板和开发语言，然后进入项目并启动开发服务器。

也可以通过参数直接创建：

```sh
npm create nova-http@latest my-app -- --template minimal --lang ts
cd my-app
npm install
npm run dev
```

`--lang` 用于选择 `ts` 或 `js`，`--template` 用于选择项目模板。

省略参数时，CLI 会通过交互提示完成选择。完整参数、默认值和模板列表见 [CLI 参考](../api/09-cli)。

## 运行单文件服务

如果只想快速了解 Nova 的基本用法，可以从一个空目录开始：

```sh
npm init -y
npm install nova-http
```

创建 `app.mjs`：

<<< @/examples/hello.mjs{js}

启动服务：

```sh
node app.mjs
```

这里使用 `.mjs` 以直接启用 ESM 和顶层 `await`。

CLI 创建的 TypeScript 项目已经包含对应的开发配置，不需要将这个单文件示例复制到模板项目中。

## 验证响应

访问示例路由：

```sh
curl http://127.0.0.1:3000/hello/Nova
```

预期响应：

```json
{ "hello": "Nova" }
```

在 Windows PowerShell 中，如果 `curl` 被解析为别名，可以使用 `curl.exe`。

端口被占用时，修改 `app.listen()` 使用的端口。使用 `Ctrl+C` 停止服务。

## 下一步

如果这是你第一次使用 Nova，可以从下面三个方向继续阅读：

<DocLinks :items="[
  { title: '了解执行顺序', description: '沿请求生命周期了解连接、解析、中间件、路由与响应的执行顺序。', href: '/framework/03-request-lifecycle' },
  { title: '项目组织', description: '查看一个 Nova 项目通常如何组织路由、中间件、配置和其他模块。', href: '/guide/03-project-structure' },
  { title: '构建应用', description: '从路由开始，逐步了解中间件、响应处理和应用组合等常用能力。', href: '/guide/04-router' },
]" />
