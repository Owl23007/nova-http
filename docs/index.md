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

<p class="home-summary"><span class="home-brand-line">Built for the flow of HTTP on Node.js.</span><span class="home-brand-subtitle">从 Socket 读写开始，让流模型贯穿 HTTP 全生命周期</span></p>

<ul class="home-tags" aria-label="框架特点">
<li>Zero Runtime Dependencies</li>
<li>Streaming First</li>
<li>Explicit Flow Control</li>
</ul>

<div class="home-actions">
<a class="primary" href="./guide/getting-started">快速开始 →</a>
<a href="./framework/">了解设计</a>
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

app.post("/echo", async (req, res) => {
  for await (const chunk of req.body) {
    await res.write(chunk);
  }

  await res.end();
});

await app.listen(3000);
```

</div>
</div>
</div>
<div class="home-capabilities">
<div>

<div class="home-capability-number" aria-hidden="true">01</div>

## 流式优先

请求与响应以流处理，背压、取消与持续输出贯穿整个生命周期。

<p class="home-capability-tech"><code>Readable</code> · <code>AsyncIterable</code> · <code>Backpressure</code></p>

</div>
<div>

<div class="home-capability-number" aria-hidden="true">02</div>

## 显式控制

控制流由代码明确表达。继续、响应、结束或失败，都不依赖框架猜测。

<p class="home-capability-tech"><code>next()</code> · <code>write()</code> · <code>Hooks</code></p>

</div>
<div>

<div class="home-capability-number" aria-hidden="true">03</div>

## 链路连续

应用、协议与传输各司其职，通过统一契约衔接完整的 HTTP 链路。

<p class="home-capability-tech"><code>Application</code> · <code>Protocol</code> · <code>Transport</code></p>

</div>
</div>

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
