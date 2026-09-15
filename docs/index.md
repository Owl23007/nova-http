---
layout: home
title: Nova 文档
description: 构建 Node.js HTTP 应用，理解从 TCP 到响应的完整链路。
---

<div class="nova-home vp-doc">
<div class="home-intro">
<div>
<span class="home-eyebrow">NOVA / HTTP FRAMEWORK</span>

<h1 class="home-title">从<a class="home-title-link" href="/guide/request"> 请求 </a>到<a class="home-title-link" href="/guide/response"> 响应 </a><br>保持清晰与可控</h1>

<p class="home-summary"><span class="home-brand-line">Built for the flow of HTTP on Node.js.</span><span class="home-brand-subtitle">面向流设计的轻量级 Node.js HTTP 框架</span></p>

<ul class="home-tags" aria-label="框架特点">
<li>Zero Runtime Dependencies</li>
<li>Streaming First</li>
<li>Explicit Flow Control</li>
</ul>

<div class="home-actions">
<a class="primary" href="./guide/getting-started">快速开始 →</a>
<a href="./framework/">框架开发</a>
</div>

<HomeCommand
  command="npm create nova-http@latest"
  copy-label="复制命令"
  copied-label="命令已复制"
/>
</div>
<div class="home-code-stage" aria-label="Nova 代码示例">
<div class="home-code">
<div class="home-code-header">
<span class="home-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
<span>app.mjs</span><span class="home-code-language">JavaScript</span>
</div>

```js
import { createApp } from "nova-http";

const app = createApp();

app.get("/hello/:name", (req, res) => {
  res.json({ hello: req.params.name });
});

await app.listen(3000, "127.0.0.1");
```

<div class="home-terminal" aria-label="启动命令与服务地址">
<pre><code><span class="terminal-prompt">$</span> npm install nova-http
<span class="terminal-prompt">$</span> node app.mjs</code></pre>
<div class="home-server-address"><span aria-hidden="true">→</span> http://127.0.0.1:3000</div>
</div>

</div>
</div>
</div>
<div class="home-capabilities">
<div>

<span class="home-capability-number" aria-hidden="true">01</span>

## 清晰的应用 API

方法路由、子应用、请求上下文。

</div>
<div>

<span class="home-capability-number" aria-hidden="true">02</span>

## 原生流控制

Readable、Async Iterable、背压控制。

</div>
<div>

<span class="home-capability-number" aria-hidden="true">03</span>

## 明确的协议边界

Application / Protocol / Transport 分层。

</div>
</div>
<figure class="home-architecture" aria-label="请求处理路径：Application、Router 与 Middleware、Request / Response、HTTP/1.1 Protocol、TCP">
<figcaption><span>NOVA / REQUEST PATH</span><span>请求处理路径</span></figcaption>
<div class="architecture-flow">
<div class="architecture-node architecture-app">Application</div>
<span class="architecture-arrow" aria-hidden="true">↓</span>
<div class="architecture-routing"><span>Router</span><span aria-hidden="true">→</span><span>Middleware</span></div>
<span class="architecture-arrow" aria-hidden="true">↓</span>
<div class="architecture-node architecture-exchange"><span>Request</span><span aria-hidden="true">→</span><span>Response</span></div>
<span class="architecture-arrow" aria-hidden="true">↓</span>
<div class="architecture-node">HTTP/1.1 Protocol</div>
<span class="architecture-arrow" aria-hidden="true">↓</span>
<div class="architecture-node architecture-tcp">TCP</div>
</div>
</figure>

<div class="home-paths">
<div>

<span class="home-eyebrow">BUILD WITH NOVA</span>

## 构建应用

<DocLinks :items="[
  { title: '安装与第一个接口', description: '选择 JavaScript 或 TypeScript，启动并验证服务。', href: '/guide/getting-started' },
  { title: '指南与实践', description: '组织路由、读取请求体、处理错误和部署服务。', href: '/guide/introduction' },
  { title: 'API 与配置', description: '查找签名、默认值、返回值和行为边界。', href: '/api/' },
]" />

</div>
<div>

<span class="home-eyebrow">INSIDE NOVA</span>

## 理解框架

<DocLinks :items="[
  { title: '架构与请求生命周期', description: '从消息契约到连接复用，追踪一次请求。', href: '/framework/architecture' },
  { title: '开发与贡献', description: '配置工作区，运行测试，验证和发布变更。', href: '/framework/contributing/setup' },
  { title: '版本与迁移', description: '区分已记录版本与工作区变更，查阅升级步骤。', href: '/releases/' },
]" />

</div>
</div>

</div>
