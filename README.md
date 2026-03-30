# Nova

> 零依赖、基于 `net` 模块手写 HTTP/1.1 解析的高性能 Node.js Web 框架。  
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

| 特性 | 说明 |
| ------ | ------ |
| **零依赖** | 生产环境零第三方依赖，仅使用 Node.js 内置模块 |
| **内置 HTTP 解析** | 基于 `net` 模块 + 9 状态机，全链路可控 |
| **TypeScript 原生** | 源码即 TypeScript，完整类型导出，无需 `@types/nova-http` |
| **Radix Tree 路由** | O(k) 路由查找（k=路径分段数），支持 `:param` 和 `*` 通配符 |
| **Keep-Alive 多路复用** | 单 TCP 连接处理多请求，支持流水线，内置 Slowloris 防御 |
| **全链路钩子** | 10 个生命周期钩子，支持异步，覆盖 连接→解析→路由→响应→断开 全链路 |
| **内置中间件** | `bodyParser`（JSON/urlencoded）、`staticFiles`（ETag/Range/流式） |
| **流式响应** | `sendFile()` 支持 HTTP Range 206、ETag 缓存、背压（drain）感知 |
| **Express 兼容风格** | `app.get/post/use/route()`，中间件签名 `(req, res, next)` |

---

## 快速开始

```typescript
import { createApp, bodyParser } from 'nova-http';

const app = createApp();

app.use(bodyParser());

app.get('/', (_req, res) => {
  res.json({ hello: 'Nova!' });
});

app.get('/hello/:name', (req, res) => {
  res.json({ greeting: `你好，${req.params.name}！` });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('服务已在 http://localhost:3000 启动');
});
```

---

## 安装

**依赖要求：**

- Node.js >= 18.0.0
- TypeScript >= 5.0（仅开发时）

```bash
# npm
npm install nova-http

# 本地开发（克隆仓库后）
npm install
npm run build
```

**`package.json` 推荐配置：**

```json
{
  "dependencies": { "nova-http": "^0.1.0" },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0"
  }
}
```

---

## 核心概念

### 请求处理流程

```text
TCP 连接到达
    │
    ▼
ConnectionHandler          ← 超时管理 / Keep-Alive / 背压
    │
    ▼
BufferReader               ← 滑动窗口 Buffer，零拷贝追加
    │
    ▼
HttpParser (9状态机)       ← 请求行 / 头部 / 定长/分块 Body
    │
    ▼
Nova._dispatch()           ← 全局中间件链
    │
    ▼
Router.find()              ← Radix Tree，O(k) 匹配
    │
    ▼
路由处理器 + 局部中间件
    │
    ▼
NovaResponse._flush()      ← socket.cork() 聚合写入
    │
    ▼
TCP 响应 / Keep-Alive 复用
```

### HTTP 解析器状态机

```text
IDLE
  └=> REQUEST_LINE    解析 "GET /path HTTP/1.1\r\n"
        └=> HEADERS   逐行解析请求头，检测 Content-Length / Transfer-Encoding
              └=> BODY_DETECT
                    ├=> BODY_FIXED     定长 Body（Content-Length）
                    ├=> CHUNK_SIZE     分块传输第一个 chunk-size 行
                    │     └=> CHUNK_DATA → CHUNK_SIZE（循环）
                    └=> DONE          请求解析完成，回调 Nova._dispatch()
```

---

## API 参考

### `createApp`

```typescript
function createApp(config?: NovaConfig): Nova
```

**`NovaConfig` 选项：**

| 字段 | 类型 | 默认值 | 说明 |
| ------ | ------ | -------- | ------ |
| `maxBodySize` | `number` | `1048576` (1MB) | 请求体最大字节数，超出则返回 413 |
| `keepAliveTimeout` | `number` | `65000` | Keep-Alive 空闲超时（毫秒） |
| `headersTimeout` | `number` | `60000` | 接收完整请求头的超时（毫秒），防 Slowloris |
| `requestTimeout` | `number` | `600000` | 单请求最大处理时间（毫秒） |
| `trustProxy` | `boolean` | `false` | 信任 `X-Forwarded-For` 头，影响 `req.ip` |

---

### 路由注册

```typescript
app.get(path, ...handlers)
app.post(path, ...handlers)
app.put(path, ...handlers)
app.patch(path, ...handlers)
app.delete(path, ...handlers)
app.head(path, ...handlers)
app.options(path, ...handlers)
app.all(path, ...handlers)   // 匹配所有 HTTP 方法
```

**路径语法：**

| 模式 | 示例 | 说明 |
| ------ | ------ | ------ |
| 静态路径 | `/users/profile` | 精确匹配 |
| 参数路径 | `/users/:id` | 匹配单段，值存入 `req.params.id` |
| 通配符 | `/static/*` | 匹配剩余所有路径段，值存入 `req.params['*']` |

**优先级：** 静态 > 参数 > 通配符

---

### 链式路由

```typescript
app.route('/users/:id')
  .get((req, res) => { /* 查询 */ })
  .put((req, res) => { /* 更新 */ })
  .delete((req, res) => { /* 删除 */ });
```

---

### 中间件

```typescript
// 全局中间件
app.use(middleware)

// 路径前缀中间件
app.use('/api', middleware)

// 多个中间件
app.use('/api', authMiddleware(), logMiddleware())
```

**中间件签名：**

```typescript
// 普通中间件
type Middleware = (req: NovaRequest, res: NovaResponse, next: NextFunction) => void | Promise<void>

// 错误处理中间件（4 个参数，必须放在所有普通中间件之后）
type ErrorMiddleware = (err: Error, req: NovaRequest, res: NovaResponse, next: NextFunction) => void | Promise<void>
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

| 属性 | 类型 | 说明 |
| ------ | ------ | ------ |
| `method` | `HttpMethod` | HTTP 方法，如 `'GET'` |
| `path` | `string` | 原始路径字符串（含查询字符串） |
| `pathname` | `string` | 不含查询字符串的路径 |
| `httpVersion` | `string` | `'1.0'` 或 `'1.1'` |
| `headers` | `Map<string, string>` | 请求头（键已小写化） |
| `body` | `Buffer` | 原始请求体 Buffer |
| `bodyParsed` | `unknown` | `bodyParser()` 解析后的结构化数据 |
| `params` | `Record<string, string>` | 路径参数，如 `{ id: '42' }` |
| `query` | `URLSearchParams` | 查询字符串（惰性解析） |
| `cookies` | `Record<string, string>` | Cookie 键值对（惰性解析） |
| `ip` | `string` | 客户端 IP（`trustProxy` 时读 X-Forwarded-For） |
| `context` | `Record<string, unknown>` | 中间件间共享的请求上下文 |
| `keepAlive` | `boolean` | 是否为 Keep-Alive 连接 |
| `socket` | `net.Socket` | 底层 TCP socket |

---

### `NovaResponse`

```typescript
// 状态码
res.status(404)

// 响应头
res.setHeader('X-Custom', 'value')
res.getHeader('content-type')
res.removeHeader('x-powered-by')

// 发送响应
res.send(data: string | Buffer)       // 自动推断 Content-Type
res.json(data: unknown)               // application/json
res.html(html: string)                // text/html
res.end()                             // 无 Body

// 重定向
res.redirect(location: string, status?: 301 | 302 | 307 | 308)

// 文件发送（支持 Range 206、ETag 缓存、流式传输）
await res.sendFile(absolutePath: string)
```

---

### 钩子系统

```typescript
app.addHook(hookName, handler)
app.removeHook(hookName, handler)
```

**可用钩子：**

| 钩子名 | 触发时机 | Handler 签名 |
| -------- | --------- | ------------- |
| `onConnect` | TCP 连接建立 | `(socket: net.Socket) => void` |
| `onDisconnect` | TCP 连接断开 | `(socket: net.Socket) => void` |
| `onRequest` | HTTP 请求解析完成，进入中间件前 | `(req: NovaRequest) => void` |
| `onRoute` | 路由匹配成功后 | `(req: NovaRequest, match: RouteMatch) => void` |
| `onBodyParsed` | `bodyParser()` 完成解析后 | `(req: NovaRequest) => void` |
| `onResponse` | 响应发送完成 | `(req: NovaRequest, res: NovaResponse) => void` |
| `onError` | 中间件链抛出未捕获异常 | `(err: Error, req: NovaRequest) => void` |
| `onNotFound` | 路由未命中 | `(req: NovaRequest) => void` |
| `onListen` | 服务开始监听 | `(info: { host: string; port: number }) => void` |
| `onClose` | 服务关闭 | `() => void` |

**示例：**

```typescript
// 全链路耗时统计
app.addHook('onRequest', (req) => {
  req.context['_start'] = process.hrtime.bigint();
});

app.addHook('onResponse', (req) => {
  const ns = process.hrtime.bigint() - (req.context['_start'] as bigint);
  console.log(`${req.pathname} 耗时 ${Number(ns) / 1e6}ms`);
});

// 或直接使用内置插件
const timer = createRequestTimer();
app.addHook('onRequest', timer.onRequest);
app.addHook('onResponse', timer.onResponse);
```

---

### 内置中间件

#### `bodyParser(options?)`

解析 `application/json` 和 `application/x-www-form-urlencoded` 请求体。

```typescript
app.use(bodyParser({
  maxBodySize: 1 * 1024 * 1024,  // 1MB，默认与 app 配置相同
  strict: true,                   // JSON 根值必须是 object/array
}));
```

解析结果写入 `req.bodyParsed`。

#### `staticFiles(root, options?)`

静态文件服务，支持 ETag、Range 206、Gzip（由 Content-Negotiation 决定）。

```typescript
app.use('/static', staticFiles('./public', {
  dotfiles: 'ignore',   // 'ignore' | 'allow' | 'deny'
  maxAge: 3600,         // Cache-Control: max-age=3600（秒）
  index: 'index.html',  // 目录默认索引文件
}));
```

---

## CLI 工具

```bash
# 创建最小化项目
npx nova-http create my-app

# 创建完整 API 项目
npx nova-http create my-api --template api

# 强制覆盖已存在目录
npx nova-http create my-app --force

# initializer 入口（为未来 npm create 接入做预演）
npx create-nova-http my-app
```

**可用模板：**

| 模板 | 描述 |
| ------ | ------ |
| `minimal` | 最小化 Hello World，适合快速体验 |
| `api` | 完整 CRUD API + 路由/中间件/身份验证示例 |

**本地前验：**

```bash
npm run verify:create
```

这个脚本会验证：

- 打包后的 CLI 是否仍可执行
- `nova-http create ...` 与 `create-nova-http ...` 两种入口是否都能生成项目
- `minimal` / `api` 模板是否都能正确替换变量并通过本地 TypeScript 构建
- 重复创建时不带 `--force` 会失败，带 `--force` 可覆盖

说明：运行时包名为 `nova-http`，对应 initializer 包名为 `create-nova-http`，因此用户侧命令应为 `npm create nova-http`。

---

## 架构说明

```text
nova/
├== src/
│   ├== core/
│   │   ├== BufferReader.ts       滑动窗口 TCP Buffer 读取器
│   │   ├== HttpParser.ts         9 状态机 HTTP/1.1 解析器
│   │   ├== NovaRequest.ts        请求对象（惰性属性）
│   │   ├== NovaResponse.ts       响应对象（直写 net.Socket）
│   │   ├== ConnectionHandler.ts  TCP 连接生命周期管理器
│   │   ├== Router.ts             Radix Tree 路由器
│   │   ├== MiddlewareChain.ts    异步中间件组合器
│   │   ├== Hooks.ts              EventEmitter 生命周期钩子
│   │   └== Nova.ts               主应用类
│   ├== middlewares/
│   │   ├== bodyParser.ts         请求体解析中间件
│   │   ├== staticFiles.ts        静态文件中间件
│   │   └== index.ts              中间件桶导出
│   └== index.ts                  包主入口（公共 API）
├== cli/
│   ├== nova.ts                   CLI 工具入口（nova-http create）
│   ├== create-nova.ts            initializer 入口（create-nova-http）
│   ├== shared.ts                 CLI 共享实现
│   └== templates/
│       ├== minimal/              最小化项目模板
│       └== api/                  完整 API 项目模板
├== package.json
├== tsconfig.json
└== tsconfig.build.json
```

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
  headersTimeout: 30_000,    // 降低以更快丢弃慢连接
  keepAliveTimeout: 30_000,  // 根据客户端行为调整
  requestTimeout: 120_000,   // 接口最长处理时间
});
```

### 2. Body 大小限制

```typescript
// 上传接口设较大限制
app.post('/upload', bodyParser({ maxBodySize: 50 * 1024 * 1024 }), handler);

// 默认限制 1MB 防止 OOM
const app = createApp({ maxBodySize: 1 * 1024 * 1024 });
```

### 3. 使用钩子而非中间件做观测

钩子为 fire-and-forget（非阻塞），中间件会阻塞请求链路。对于日志、指标采集，优先使用钩子：

```typescript
// 推荐：用钩子做指标采集
app.addHook('onResponse', (req, res) => {
  metrics.record(req.method, req.pathname, res._statusCode);
});

// 谨慎：用中间件做阻塞式日志（会增加 P99 延迟）
app.use(async (req, res, next) => {
  await writeToLogFile(...);  // I/O 操作
  next();
});
```

### 4. 静态文件缓存策略

```typescript
app.use(staticFiles('./public', {
  maxAge: 86400,   // 强缓存 1 天（生产环境）
  dotfiles: 'ignore',
}));
```

### 5. 流式大文件

```typescript
app.get('/download/:file', async (req, res) => {
  // sendFile 自动处理 Range、ETag、drain 背压
  await res.sendFile(path.join(STORAGE_DIR, req.params['file']!));
});
```

---

## 扩展点文档

### 自定义中间件

```typescript
import type { Middleware } from 'nova-http';

export function rateLimiter(maxRpm: number): Middleware {
  const counts = new Map<string, number>();

  setInterval(() => counts.clear(), 60_000);

  return (req, res, next) => {
    const ip = req.ip;
    const count = (counts.get(ip) ?? 0) + 1;
    counts.set(ip, count);

    if (count > maxRpm) {
      res.status(429).json({ error: '请求过于频繁，请稍后重试' });
      return;
    }

    next();
  };
}
```

### 插件模式（钩子组合）

```typescript
import type { Nova } from 'nova-http';

export function metricsPlugin(app: Nova): void {
  const counters = { total: 0, errors: 0 };

  app.addHook('onRequest', () => { counters.total++; });
  app.addHook('onError', () => { counters.errors++; });

  // 暴露指标端点
  app.get('/metrics', (_req, res) => {
    res.json(counters);
  });
}

// 使用
metricsPlugin(app);
```

### 子应用路由挂载

```typescript
const usersApp = createApp();
usersApp.get('/', listUsers);
usersApp.post('/', createUser);
usersApp.get('/:id', getUser);

// 挂载到 /api/users
app.use('/api/users', usersApp);
```

---

## 许可证

MIT © Nova Contributors
