---
description: Nova 的适用场景、接口边界与应用开发阅读路线。
---

# 简介

Nova 是用 TypeScript 编写、直接运行在 Node.js TCP 之上的 HTTP 框架。它提供方法路由、中间件、子应用、请求上下文、生命周期钩子，以及支持背压的请求体和响应流。

## 适用场景

可以用 Nova 构建 JSON API、文件服务和 SSE 接口，也可以通过公开内核入口研究或扩展请求分发。数据库、身份认证、业务校验和部署编排由应用选择与组织。

生产包没有第三方运行依赖；HTTP/1 解析、消息定界和连接协调由项目自身实现。需要了解实现时，从[架构与边界](../framework/architecture)进入。

## 使用边界

Nova 的 `get()`、`use()` 和中间件签名采用常见的 Express 风格，但请求和响应是 Nova 自身的类型。依赖 Express 或 Node `IncomingMessage`、`ServerResponse` 实现细节的中间件不能直接视为兼容。

当前服务器适配器处理 HTTP/1.0 和 HTTP/1.1。TLS 可在入口代理终止；项目未提供 HTTP/2、WebSocket、multipart 解析或通用插件注册系统。扩展通过函数、中间件、Hooks 与子应用组合。

::: info 文档版本
本站描述当前工作区。发布包要求 Node.js ≥ 20，并在 Node.js 20、22、24 上验证产物；仓库开发要求 Node.js 22.22.1 或 24。已记录的版本变更与尚未归入发行版的接口见[版本说明](../releases/)。
:::

## 从这里开始

<DocLinks :items="[
  { title: '快速开始', description: '安装、启动并通过 HTTP 请求验证第一个接口。', href: '/guide/getting-started' },
  { title: 'JSON API 示例', description: '阅读包含请求体校验和状态码的完整应用。', href: '/guide/recipes/rest-api' },
  { title: 'API 参考', description: '已有使用经验时，直接查找签名、配置与返回值。', href: '/api/' },
]" />
