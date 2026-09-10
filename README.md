# Nova

[English](./README_EN.md) | 简体中文

> 基于 `net` 模块的高性能轻量 Node.js Web 框架。  
> 全链路可控 · TypeScript 原生 · Express 风格 API

---

## 目录

- [特性](#特性)
- [快速开始](#快速开始)
- [安装](#安装)
- [核心概念](#核心概念)
- [API 参考](#api-参考)
  - [createApp](#createapp)
  - [路由注册](#路由注册)
  - [链式路由](#链式路由)
  - [中间件](#中间件)
  - [NovaRequest](#novarequest)
  - [NovaResponse](#novaresponse)
  - [钩子系统](#钩子系统)
  - [内置中间件](#内置中间件)
- [CLI 工具](#cli-工具)
- [架构说明](#架构说明)
- [性能调优指南](#性能调优指南)
- [扩展点文档](#扩展点文档)

---

## 特性

| 特性                    | 说明                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| **零依赖**              | 生产环境零第三方依赖，仅使用 Node.js 内置模块                     |
| **内置 HTTP 解析**      | 基于 `net` 模块 + 10 状态机，全链路可控                           |
| **TypeScript 原生**     | 源码即 TypeScript，完整类型导出，无需 `@types/nova-http`          |
| **Radix Tree 路由**     | O(k) 路由查找（k=路径分段数），支持 `:param` 和 `*` 通配符        |
| **Keep-Alive 多路复用** | 单 TCP 连接处理多请求，支持流水线，内置 Slowloris 防御            |
| **全链路钩子**          | 10 个生命周期钩子，支持异步，覆盖 连接→解析→路由→响应→断开 全链路 |
| **内置中间件**          | `bodyParser`（JSON/urlencoded）、`staticFiles`（ETag/Range/流式） |
| **流式响应**            | 支持 AsyncIterable、Readable、chunked framing 与背压感知          |
| **Express 兼容风格**    | `app.get/post/use/route()`，中间件签名 `(req, res, next)`         |

---

## 快速开始

```typescript
import { createApp, bodyParser } from "nova-http";

const app = createApp();

app.use(bodyParser());

app.get("/", (_req, res) => {
  res.json({ hello: "Nova!" });
});

app.get("/hello/:name", (req, res) => {
  res.json({ greeting: `你好，${req.params.name}！` });
});

await app.listen(3000, "0.0.0.0", () => {
  console.log("服务已在 http://localhost:3000 启动");
});
```

---

## 安装

**依赖要求：**

- Node.js >= 18.0.0
- TypeScript >= 5.0（dev）

```bash
# npm
npm install nova-http

# 本地开发
npm install
npm run build
```

---

## 核心概念

### 请求处理流程

```text
TCP 连接到达
    │
    ▼
Http1ConnectionCoordinator ← 输入与应用生命周期 / 超时 / 连接复用
    │
    ▼
SegmentedInput             ← 分段 TCP 字节流，追加时不 concat
    │
    ▼
Head scanner/parser        ← 严格 CRLF / 有界 head 连续化 / HeaderBlock
    │
    ▼
Message framing            ← 独立解决 TE / CL 优先级与冲突
    │
    ▼
IncomingBody               ← Readable 零拷贝视图 / 背压 / fixed 与 chunked 解码
    │
    ▼
Nova._dispatch()           ← head 完成后立即进入中间件链
    │
    ▼
Router.find()              ← Radix Tree，O(k) 匹配
    │
    ▼
路由处理器 + 局部中间件
    │
    ▼
NovaResponse writer        ← fixed/chunked framing + 背压控制
    │
    ▼
TCP 响应 / Keep-Alive 复用
```

### HTTP 输入模型

```text
READ_HEAD → HEAD_READY → READ_BODY → MESSAGE_COMPLETE
                │             │
                │             └─ fixed/chunked 数据视图推入 Readable
                └─ handler 可在 body 未完成时开始消费
```

请求头在单个 TCP Buffer 内时使用 `subarray()`，跨段时最多复制一次
请求体保持流式路径，`Readable.push()` 返回 `false` 时会停止解码并暂停 socket

---

## API 参考

### `createApp`

```typescript
function createApp(config?: NovaConfig): Nova;
```

**`NovaConfig` 选项：**

| 字段                | 类型         | 默认值          | 说明                                                                  |
| ------------------- | ------------ | --------------- | --------------------------------------------------------------------- |
| `port`              | `number`     | `3000`          | `app.listen()` 未传端口时使用的默认端口                               |
| `host`              | `string`     | `"0.0.0.0"`     | `app.listen()` 未传主机时使用的默认地址                               |
| `maxConnections`    | `number`     | `0`             | 最大并发连接数，`0` 表示不限制                                        |
| `maxBodySize`       | `number`     | `1048576` (1MB) | 请求体最大字节数，超出则返回 413                                      |
| `keepAliveTimeout`  | `number`     | `65000`         | Keep-Alive 空闲超时（毫秒）                                           |
| `headersTimeout`    | `number`     | `60000`         | 接收完整请求头的超时（毫秒），防 Slowloris                            |
| `requestTimeout`    | `number`     | `600000`        | 普通 handler 的处理超时（毫秒），进入流式模式后停止计时；`0` 表示禁用 |
| `bodyIdleTimeout`   | `number`     | `30000`         | 请求体连续无输入的超时（毫秒）；`0` 表示禁用                          |
| `bodyHighWaterMark` | `number`     | `65536`         | 请求体 Readable 的背压水位                                            |
| `trustProxy`        | `TrustProxy` | `false`         | 信任代理 IP 请求头，影响 `req.ip`                                     |

服务生命周期和已注册路由可通过应用实例管理：

```typescript
await app.listen(); // 使用 createApp() 中的 port 和 host
await app.listen(8080, "127.0.0.1"); // 覆盖默认监听配置
console.log(app.routes); // ReadonlyArray<{ method, path }>
await app.close(); // 停止接收连接并优雅关闭活跃连接
```

---

### 路由注册

```typescript
app.get(path, ...handlers);
app.post(path, ...handlers);
app.put(path, ...handlers);
app.patch(path, ...handlers);
app.delete(path, ...handlers);
app.head(path, ...handlers);
app.options(path, ...handlers);
app.method(method, path, ...handlers); // 注册 WebDAV 等扩展 HTTP 方法
app.all(path, ...handlers); // 匹配所有 HTTP 方法
```

**路径语法：**

| 模式     | 示例             | 说明                                         |
| -------- | ---------------- | -------------------------------------------- |
| 静态路径 | `/users/profile` | 精确匹配                                     |
| 参数路径 | `/users/:id`     | 匹配单段，值存入 `req.params.id`             |
| 通配符   | `/static/*`      | 匹配剩余所有路径段，值存入 `req.params['*']` |

**优先级：** 静态 > 参数 > 通配符

---

### 链式路由

```typescript
app
  .route("/users/:id")
  .get((req, res) => {
    /* 查询 */
  })
  .put((req, res) => {
    /* 更新 */
  })
  .delete((req, res) => {
    /* 删除 */
  });
```

---

### 中间件

```typescript
// 全局中间件
app.use(middleware);

// 路径前缀中间件
app.use("/api", middleware);

// 多个中间件
app.use("/api", authMiddleware(), logMiddleware());
```

挂载路径仅支持以 `/` 开头的字面路径前缀，不支持路由参数或通配符。例如，
`app.use("/users/:id", middleware)` 和 `app.use("/files/*", middleware)` 会在注册时抛出错误。

**中间件签名：**

```typescript
// 普通中间件
type Middleware = (req: NovaRequest, res: NovaResponse, next: NextFunction) => void | Promise<void>;

// 错误处理中间件（4 个参数，必须放在所有普通中间件之后）
type ErrorMiddleware = (
  err: Error,
  req: NovaRequest,
  res: NovaResponse,
  next: NextFunction,
) => void | Promise<void>;
```

**示例：**

```typescript
// 请求日志
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.pathname}`);
  next();
});

// 错误处理
app.use((err: Error, _req, res, _next) => {
  res.status(500).json({ error: err.message });
});
```

---

### `NovaRequest`

| 属性          | 类型                     | 说明                                            |
| ------------- | ------------------------ | ----------------------------------------------- |
| `method`      | `HttpMethod`             | HTTP 方法，如 `'GET'`                           |
| `path`        | `string`                 | 原始路径字符串（含查询字符串）                  |
| `pathname`    | `string`                 | 不含查询字符串的路径                            |
| `httpVersion` | `'1.0' \| '1.1'`         | HTTP 版本                                       |
| `headers`     | `HeaderBlock`            | 保留顺序和重复项的请求字段                      |
| `body`        | `IncomingBody`           | 支持背压的 Node.js `Readable` 请求体            |
| `trailers`    | `HeaderBlock`            | 消息体完成后可用的独立 Trailer 字段             |
| `params`      | `Record<string, string>` | 路径参数，如 `{ id: '42' }`                     |
| `query`       | `URLSearchParams`        | 查询字符串（惰性解析）                          |
| `cookies`     | `Record<string, string>` | Cookie 键值对（惰性解析）                       |
| `ip`          | `string`                 | 客户端 IP（`trustProxy` 时读 X-Forwarded-For）  |
| `context`     | `RequestLocals`          | 可由 middleware/plugin 类型扩展的请求级共享状态 |
| `connection`  | `ConnectionIntent`       | close / upgrade / CONNECT 连接意图              |
| `peer`        | `ConnectionInfo`         | 与传输实现无关的远端/本地地址信息               |
| `signal`      | `AbortSignal`            | 客户端断开、超时或服务关闭时触发                |

`RequestLocals` 是 `req.context` 的声明合并扩展点。未声明字段会产生类型错误；middleware/plugin
可以声明自己拥有的 namespaced 状态，获得完整的 IDE 提示。`bodyParser()` 已声明可选的
`context.bodyParserData?: BodyParserData`。

请求体默认不物化，可直接 `for await (const chunk of req.body)` 消费，或使用 `await req.buffer()`、`await req.text()`、`await req.json()`
未消费完请求体时连接不会被复用

---

### `NovaResponse`

```typescript
// 响应状态（只读）
res.statusCode
res.headersSent
res.writableEnded
res.bodyBytesWritten

// 状态码
res.status(404)

// 响应头
res.setHeader('X-Custom', 'value')
res.getHeader('content-type')
res.removeHeader('x-powered-by')

// 发送响应
res.send(data: string | Buffer)       // 未设置时使用 text/plain
res.json(data: unknown)               // application/json
res.html(html: string)                // text/html
await res.end(chunk?: string | Buffer | Uint8Array)

// 通用流式响应
await res.flushHeaders()
await res.write(chunk: string | Buffer | Uint8Array)
await res.stream(source: Readable | AsyncIterable<StreamChunk>)

// 重定向
res.redirect(location: string, status?: number)

// 文件发送是独立的 static adapter
await sendFile(req, res, absolutePath)
```

流式写入会自动处理 HTTP/1.1 chunked framing 与 socket 背压，业务只需发送原始数据块。
手动调用 `write()` 时必须逐次 `await`，并在 handler 返回前调用 `end()`。
如果预先设置了 `Content-Length`，框架会校验最终写入字节数；未知长度的 HTTP/1.0
响应会使用连接关闭定界，因此无法复用该连接。

`requestTimeout` 从请求解析完成后开始保护普通 handler；响应首次调用 `flushHeaders()`、`write()`
或 `stream()` 进入流式模式时停止计时，因此 SSE 等长流不需要为了绕过请求超时而设置
`requestTimeout: 0`。客户端断开、普通请求超时或服务关闭时，`req.signal` 会触发，可将其传给
上游任务以尽快释放资源。`app.close()` 会主动终止仍在运行的长期流，避免优雅关闭无限等待。

```typescript
app.get("/generate", async (_req, res) => {
  res.setHeader("content-type", "text/plain; charset=utf-8");

  await res.stream(generateTokens());
});

async function* generateTokens() {
  yield "Hello";
  yield " ";
  yield "Nova";
}
```

---

### 钩子系统

```typescript
app.addHook(hookName, handler);
app.removeHook(hookName, handler);
```

Hook handler 接收一个上下文对象，并可返回 `void` 或 `Promise<void>`。Hook 用于日志和指标等观测任务；异步 handler 以 fire-and-forget 方式执行，不会阻塞请求链路。

> Middleware 参与控制流，Hook 观察生命周期
> 需要终止请求、决定是否 `next()`或修改业务请求/响应时，应使用 middleware 或终端 handler。
> Hook 异常会被隔离，不会使已成功的请求失败。

下表是框架内置的 core 与 server 生命周期事件。Middleware/plugin 可以通过 namespace 定义扩展
事件，不需要把业务语义加入 core。

**可用钩子：**

| 钩子名         | 触发时机                        | 上下文字段                             |
| -------------- | ------------------------------- | -------------------------------------- |
| `onConnect`    | TCP 连接建立                    | `{ connection, timestamp }`            |
| `onDisconnect` | TCP 连接断开                    | `{ connection, timestamp }`            |
| `onRequest`    | HTTP 请求解析完成，进入中间件前 | `{ req, res, timestamp }`              |
| `onRoute`      | 路由匹配成功后                  | `{ req, res, routePath, params }`      |
| `onResponse`   | 响应发送完成                    | `{ req, res, durationMs, statusCode }` |
| `onError`      | 请求、解析、连接或 hook 出错    | `{ error, req?, res?, connection? }`   |
| `onNotFound`   | 路由未命中                      | `{ req, res }`                         |
| `onListen`     | 服务开始监听                    | `{ host, port }`                       |
| `onClose`      | 服务关闭                        | 无参数                                 |

`core/hooks` 提供事件总线、core 生命周期 payload 和 `HookEvents` 声明合并扩展点。
Server 和 middleware/plugin 各自在事件所属模块中声明 payload 类型。第三方 middleware
可以声明 namespaced 事件，并通过 middleware 调用上下文发送它：

```typescript
declare module "nova-http" {
  interface HookEvents {
    "cache:hit": { req: NovaRequest; key: string };
  }
}

const cacheMiddleware: Middleware = function (req, _res, next) {
  this?.hooks.emitHook("cache:hit", { req, key: req.pathname });
  next();
};
```

扩展事件无需运行时注册。事件用于观察且不阻塞请求流程；鉴权、拒绝请求等控制流逻辑应由
middleware 完成。

**示例：**

```typescript
// 全链路耗时统计
app.addHook("onResponse", ({ req, statusCode, durationMs }) => {
  console.log(`${req.pathname} ${statusCode} ${durationMs.toFixed(3)}ms`);
});
```

---

### 内置中间件

#### `bodyParser(options?)`

解析 `application/json` 和 `application/x-www-form-urlencoded` 请求体。

```typescript
app.addHook("bodyParser:parsed", ({ req, body, contentType }) => {
  console.log(req.pathname, contentType, body);
});

app.use(
  bodyParser({
    maxSize: 1 * 1024 * 1024, // 最大解析大小，默认 1MB
    types: ["json", "urlencoded"], // 要解析的 body 类型
    maxParams: 100, // urlencoded 最大参数数量
    strict: true, // JSON 根值必须是 object/array
  }),
);
```

解析结果写入 `req.context.bodyParserData`：

```typescript
app.post("/users", (req, res) => {
  const body = req.context.bodyParserData?.body; // unknown | undefined
});
```

随后发送观察型扩展事件 `bodyParser:parsed`。该事件不会阻塞请求链路；未匹配支持的
Content-Type、空请求体或解析失败时不会发送。

#### `staticFiles(root, options?)`

静态文件服务，仅处理 `GET` 和 `HEAD`，支持 MIME 类型、ETag、Last-Modified、Range 206、目录索引和路径穿越防护。

```typescript
app.use(
  "/static",
  staticFiles("./public", {
    dotFiles: "ignore", // 'ignore' | 'allow' | 'deny'
    maxAge: 3600, // Cache-Control: max-age=3600（秒）
    index: "index.html", // string | false
  }),
);
```

---

## CLI 工具

```bash
# 创建最小化项目
npx nova-http create my-app

# 创建完整 API 项目
npx nova-http create my-api --template api

# 创建 JavaScript 项目
npx nova-http create my-app --lang js

# 强制覆盖已存在目录
npx nova-http create my-app --force

# initializer 入口
npx create-nova-http my-app
```

**可用模板：**

| 模板      | 描述                                     |
| --------- | ---------------------------------------- |
| `minimal` | 最小化 Hello World，适合快速体验         |
| `api`     | 完整 CRUD API + 路由/中间件/身份验证示例 |

**本地校验：**

```bash
pnpm build
pnpm check:cli
pnpm check:templates
```

这些命令会验证：

- 打包后的 CLI 是否仍可执行
- `nova-http create ...` 与 `create-nova-http ...` 两种入口是否都能生成项目
- `minimal` / `api` 的 TypeScript 和 JavaScript 版本能否正确替换变量
- TypeScript 模板能否通过类型检查，JavaScript 模板能否通过语法检查
- 生成项目的 `nova-http` 依赖版本是否与当前框架包版本同步

说明：运行时包名为 `nova-http`，对应 initializer 包名为 `create-nova-http`，因此用户侧命令应为 `npm create nova-http`。

---

## 架构说明

```text
nova/
├── packages/
│   ├── nova-http/
│   │   ├── src/
│   │   │   ├── app/                       公共组合门面
│   │   │   ├── core/                      路由、中间件与应用分发内核
│   │   │   ├── message/                   协议与应用交换的数据和端口契约
│   │   │   ├── protocol/http1/            纯 HTTP/1 解析与响应序列化
│   │   │   ├── server/                    Node TCP、超时、背压与连接协调适配器
│   │   │   ├── static/                    文件、MIME 与 Range 适配器
│   │   │   ├── middlewares/                内置中间件
│   │   │   └── index.ts                    稳定公共 API
│   │   └── cli/                            CLI 与 TS/JS 模板
│   └── create-nova-http/                    独立 initializer 包
├── docs/                                    VitePress 文档站
├── scripts/                                 仓库级校验脚本
└── package.json                             pnpm workspace 脚本
```

依赖方向由边界契约固定：`core → message`、`protocol/http1 → message`，`server` 负责组合
`core + protocol/http1 + message`，最外层 `app` 再组装 server 和可选适配器。`core` 不依赖
HTTP/1 或 Node Socket，HTTP/1 协议实现也不依赖应用内核或 Socket。该约束由架构测试持续校验。

### 关键设计决策

**为什么使用 `net` 模块而非 `http` 模块？**

Node.js `http` 模块基于 `llhttp`（C++ 解析器），无法从 JavaScript 层控制解析细节。`net` 模块提供原始 TCP 流，让 Nova 对以下层面拥有完整控制权：

- **超时粒度**：可区分 "接收头部超时"（防 Slowloris）和 "请求处理超时"
- **Keep-Alive 策略**：自定义空闲超时、连接复用策略
- **请求走私防御**：主动检测 CL+TE 冲突，立即返回 400
- **背压感知**：直接监听 `socket.drain` 事件，流式传输时无内存堆积
- **性能调优**：`socket.cork()/uncork()` 减少系统调用，`TCP_NODELAY` 消除 Nagle 延迟

---

## 性能调优指南

### 1. 调整连接超时

```typescript
const app = createApp({
  headersTimeout: 30_000, // 降低以更快丢弃慢连接
  keepAliveTimeout: 30_000, // 根据客户端行为调整
  requestTimeout: 120_000, // 普通 handler 进入流式模式前的处理时限
});
```

### 2. Body 大小限制

```typescript
const uploadLimit = 50 * 1024 * 1024;
const app = createApp({ maxBodySize: uploadLimit });

// parser 层和 bodyParser 层都允许该大小
app.post("/upload", bodyParser({ maxSize: uploadLimit }), handler);
```

`maxBodySize` 是连接层的 body policy，不参与消息 framing 判定；`bodyParser.maxSize` 是显式物化前的二次限制，两者同时使用时以较小值为准

### 3. 使用钩子而非中间件做观测

钩子为 fire-and-forget（非阻塞），中间件会阻塞请求链路。对于日志、指标采集，优先使用钩子：

```typescript
// 推荐：用钩子做指标采集
app.addHook('onResponse', ({ req, statusCode }) => {
  metrics.record(req.method, req.pathname, statusCode);
});

// 谨慎：用中间件做阻塞式日志（会增加 P99 延迟）
app.use(async (req, res, next) => {
  await writeToLogFile(...);  // I/O 操作
  next();
});
```

### 4. 静态文件缓存策略

```typescript
app.use(
  staticFiles("./public", {
    maxAge: 86400, // 强缓存 1 天（生产环境）
    dotFiles: "ignore",
  }),
);
```

### 5. 流式大文件

```typescript
import { sendFile } from "nova-http/static";

app.get("/download/:file", async (req, res) => {
  // sendFile 自动处理 Range、ETag、drain 背压
  await sendFile(req, res, path.join(STORAGE_DIR, req.params["file"]!));
});
```

---

## 扩展点文档

### 自定义中间件

```typescript
import type { Middleware } from "nova-http";

export function rateLimiter(maxRpm: number): Middleware {
  const counts = new Map<string, number>();

  setInterval(() => counts.clear(), 60_000);

  return (req, res, next) => {
    const ip = req.ip;
    const count = (counts.get(ip) ?? 0) + 1;
    counts.set(ip, count);

    if (count > maxRpm) {
      res.status(429).json({ error: "请求过于频繁，请稍后重试" });
      return;
    }

    next();
  };
}
```

### 插件模式

```typescript
import type { Nova } from "nova-http";

export function metricsPlugin(app: Nova): void {
  const counters = { total: 0, errors: 0 };

  app.addHook("onRequest", () => {
    counters.total++;
  });
  app.addHook("onError", () => {
    counters.errors++;
  });

  // 暴露指标端点
  app.get("/metrics", (_req, res) => {
    res.json(counters);
  });
}

// 使用
metricsPlugin(app);
```

### 子应用路由挂载

```typescript
const usersApp = createApp();
usersApp.get("/", listUsers);
usersApp.post("/", createUser);
usersApp.get("/:id", getUser);

// 挂载到 /api/users
app.use("/api/users", usersApp);
```

---

## 许可证

MIT © Owl23007

### 请求语义

- `rawTarget` 保留原始 request-target；`path` 是协议层提取的路径及 query，`pathname` 不含 query。它们不解码、不消除点路径段；不再提供重复的 `target`。
- `cookies` 使用无原型对象，保留百分号编码值，不自动执行 URI 解码。
- `bodyBytesReceived` 表示当前已接收字节数，不代表完整 body 大小；原 `bodySize` 已移除。
- `isJson` 和 `bodyParser` 支持 `application/json` 及 `application/*+json`；媒体类型匹配忽略大小写和参数。
- `trustProxy` 默认为 `false`；`true` 信任全部代理；非负整数表示从 socket 对端开始信任的跳数；`(address, hop) => boolean` 判断每一跳，socket 对端的 hop 为 0。沿 X-Forwarded-For 从右向左取第一个不受信任的地址，遇到无效 IP 停止，不使用 X-Real-IP 回退。使用跳数时须确保所有入口的代理链长度符合配置；`true` 要求入口代理清理客户端提供的转发头。
