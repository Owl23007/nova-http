---
layout: home
footer: false
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

<div class="home-paths" aria-label="探索 Nova 文档">
<section aria-labelledby="build-with-nova">

<span class="home-eyebrow">BUILD WITH NOVA</span>

<h2 id="build-with-nova">构建应用</h2>

<DocLinks :items="[
  { title: '快速开始', description: '使用脚手架创建项目，启动并运行你的第一个 Nova 应用。', href: '/guide/getting-started' },
  { title: '进阶开发', description: '编写中间件、使用钩子，为应用添加可复用的扩展。', href: '/framework/extensions' },
  { title: 'API 参考', description: '查阅请求、响应和路由接口，以及配置参数与默认值。', href: '/api/' },
]" />

</section>
<section aria-labelledby="inside-nova">

<span class="home-eyebrow">INSIDE NOVA</span>

<h2 id="inside-nova">理解框架</h2>

<DocLinks :items="[
  { title: '架构设计', description: '了解请求分发、HTTP 解析与 TCP 连接管理如何分工。', href: '/framework/architecture' },
  { title: '参与贡献', description: '搭建开发环境，了解源码结构并参与贡献。', href: '/framework/contributing/setup' },
  { title: '版本与迁移', description: '查看版本变更、待发布功能，以及后续的前进路线。', href: '/releases/' },
]" />

</section>
</div>

</div>
