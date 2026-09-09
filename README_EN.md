# Nova

English | [简体中文](./README.md)

> A fast, lightweight Node.js web framework built directly on `node:net`.
> Full-stack control · TypeScript-first · Express-style API

## Features

| Feature                       | Description                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| **Zero runtime dependencies** | Uses only built-in Node.js modules in production                                        |
| **Built-in HTTP parser**      | Parses HTTP/1.1 directly on top of TCP with a ten-state state machine                   |
| **TypeScript-first**          | Ships complete type declarations; no separate `@types` package required                 |
| **Radix tree router**         | O(k) lookup with static, `:param`, and `*` wildcard routes                              |
| **Keep-Alive support**        | Reuses TCP connections, supports pipelining, and defends against Slowloris attacks      |
| **Lifecycle hooks**           | Ten async-capable observation points from connection to shutdown                        |
| **Built-in middleware**       | JSON/form body parsing and static files with caching and range requests                 |
| **Streaming responses**       | Supports Node.js `Readable` streams, async iterables, chunked framing, and backpressure |
| **Familiar API**              | Express-style `app.get()`, `app.post()`, `app.use()`, and `app.route()` methods         |

## Requirements

- Node.js 18 or later
- TypeScript 5 or later when developing TypeScript applications

## Installation

```bash
npm install nova-http
```

To scaffold a new project instead:

```bash
npm create nova-http@latest my-app
```

## Quick start

```typescript
import { bodyParser, createApp } from "nova-http";

const app = createApp();

app.use(bodyParser());

app.get("/", (_req, res) => {
  res.json({ hello: "Nova!" });
});

app.get("/hello/:name", (req, res) => {
  res.json({ greeting: `Hello, ${req.params.name}!` });
});

await app.listen(3000);
```

The server listens on `0.0.0.0` by default. Open <http://localhost:3000> to try it.

## Configuration

Pass an optional configuration object to `createApp()`:

```typescript
const app = createApp({
  port: 3000,
  host: "0.0.0.0",
  maxConnections: 0,
  maxBodySize: 1_048_576,
  headersTimeout: 60_000,
  keepAliveTimeout: 65_000,
  bodyIdleTimeout: 30_000,
  bodyHighWaterMark: 65_536,
  requestTimeout: 600_000,
  trustProxy: false,
});
```

| Option              |     Default | Description                                                            |
| ------------------- | ----------: | ---------------------------------------------------------------------- |
| `port`              |      `3000` | Default port used by `app.listen()`                                    |
| `host`              | `"0.0.0.0"` | Default host used by `app.listen()`                                    |
| `maxConnections`    |         `0` | Maximum concurrent connections; `0` means unlimited                    |
| `maxBodySize`       |   `1048576` | Maximum request body size in bytes                                     |
| `headersTimeout`    |     `60000` | Time allowed to receive complete request headers, in milliseconds      |
| `keepAliveTimeout`  |     `65000` | Idle Keep-Alive timeout, in milliseconds                               |
| `bodyIdleTimeout`   |     `30000` | Idle timeout while receiving request-body bytes                        |
| `bodyHighWaterMark` |     `65536` | Request-body Readable backpressure threshold                           |
| `requestTimeout`    |    `600000` | Ordinary-handler timeout; stops when streaming begins; `0` disables it |
| `trustProxy`        |     `false` | Trust forwarded client IP headers when resolving `req.ip`              |

Manage the server lifecycle and inspect registered routes through the application instance:

```typescript
await app.listen();
await app.listen(8080, "127.0.0.1");
console.log(app.routes);
await app.close();
```

## Routing

Nova supports the common HTTP methods, custom methods, and handlers shared by all built-in methods:

```typescript
app.get(path, ...handlers);
app.post(path, ...handlers);
app.put(path, ...handlers);
app.patch(path, ...handlers);
app.delete(path, ...handlers);
app.head(path, ...handlers);
app.options(path, ...handlers);
app.method("PROPFIND", path, ...handlers);
app.all(path, ...handlers);
```

Static segments have priority over parameters, which have priority over wildcards:

```typescript
app.get("/users/profile", showProfile);

app.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});

app.get("/assets/*", (req, res) => {
  res.json({ rest: req.params["*"] });
});
```

Use `route()` to group handlers for the same path:

```typescript
app.route("/users/:id").get(getUser).put(updateUser).delete(deleteUser);
```

## Middleware and sub-applications

Middleware uses the familiar `(req, res, next)` signature:

```typescript
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.pathname}`);
  next();
});

app.use("/api", authentication(), requestLogger());

app.use((error: Error, _req, res, _next) => {
  res.status(500).json({ error: error.message });
});
```

Error middleware has four parameters and should be registered after regular middleware. A Nova application can also be mounted as a sub-application:

```typescript
const users = createApp();
users.get("/", listUsers);
users.get("/:id", getUser);

app.use("/api/users", users);
```

## Requests and responses

Frequently used request properties include:

| Property       | Description                                        |
| -------------- | -------------------------------------------------- |
| `req.method`   | HTTP method                                        |
| `req.path`     | Original path including the query string           |
| `req.pathname` | Path without the query string                      |
| `req.headers`  | Ordered `HeaderBlock` preserving duplicate fields  |
| `req.body`     | Backpressure-aware `IncomingBody` readable stream  |
| `req.params`   | Route parameters                                   |
| `req.query`    | Lazily parsed `URLSearchParams`                    |
| `req.cookies`  | Lazily parsed cookie values                        |
| `req.ip`       | Client IP address                                  |
| `req.peer`     | Transport-neutral local and remote address details |
| `req.context`  | Typed request-local state extended by middleware   |
| `req.signal`   | Aborted on disconnect, timeout, or server shutdown |

`RequestLocals` is the declaration-merging extension point for `req.context`. Undeclared keys are
type errors; middleware and plugins can declare their own namespaced state for precise IDE support.
`bodyParser()` declares the optional `context.bodyParserData?: BodyParserData` field.

Request bodies are single-consumer streams. Use `for await (const chunk of req.body)` for the zero-copy path, or explicitly materialize with `req.buffer()`, `req.text()`, or `req.json()`.

Build responses with the fluent response API:

```typescript
res.status(201);
res.setHeader("x-custom", "value");
res.send("Hello");
res.json({ ok: true });
res.html("<h1>Hello</h1>");
res.redirect("/login");

await sendFile(req, res, absolutePath);
```

Import `sendFile` from `nova-http/static`. It supports conditional requests, byte ranges, and
backpressure-aware streaming without coupling the application response object to the filesystem.

## Streaming responses

`stream()` accepts a Node.js `Readable` or an async iterable and ends the response when the source completes:

```typescript
app.get("/stream", async (req, res) => {
  res.setHeader("content-type", "text/plain; charset=utf-8");
  await res.stream(createSource(req.signal));
});

async function* createSource(signal: AbortSignal) {
  for (const chunk of ["Hello", " ", "Nova"]) {
    if (signal.aborted) return;
    yield chunk;
  }
}
```

For manual streaming, await every write and end the response before the handler returns:

```typescript
await res.flushHeaders();
await res.write("first chunk");
await res.write("second chunk");
await res.end();
```

Nova applies HTTP/1.1 chunked framing when the content length is unknown and waits for socket backpressure. `requestTimeout` protects ordinary handlers, but its timer stops as soon as `flushHeaders()`, `write()`, or `stream()` starts a streaming response, so long-lived responses such as server-sent events are not cut off by that timeout. Calling `app.close()` aborts active long-running streams so graceful shutdown cannot wait forever.

## Built-in middleware

### `bodyParser(options?)`

Parses JSON and URL-encoded request bodies into `req.context.bodyParserData`:

```typescript
app.addHook("bodyParser:parsed", ({ req, body, contentType }) => {
  console.log(req.pathname, contentType, body);
});

app.use(
  bodyParser({
    maxSize: 1_048_576,
    types: ["json", "urlencoded"],
    maxParams: 100,
    strict: true,
  }),
);
```

`maxBodySize` is the connection body policy, while `bodyParser.maxSize` limits explicit materialization before parsing. The smaller limit wins; both default to 1 MB. Consume the stream directly with `for await`, or use `req.buffer()`, `req.text()`, and `req.json()`.

The parsed value is available as `req.context.bodyParserData?.body` with type `unknown | undefined`.
The middleware then emits the observational extension event `bodyParser:parsed`. It does not block
the request pipeline and is not emitted for unsupported content types, empty request bodies, or
parse failures.

### `staticFiles(root, options?)`

Serves `GET` and `HEAD` requests with MIME detection, ETags, `Last-Modified`, range requests, and path-traversal protection:

```typescript
app.use(
  "/static",
  staticFiles("./public", {
    maxAge: 3600,
    index: "index.html",
    dotFiles: "ignore",
  }),
);
```

## Lifecycle hooks

Hooks are intended for observation such as logs and metrics. Async hook handlers are fire-and-forget and do not block request processing.

> Middleware participates in control flow; hooks observe the lifecycle. Use middleware or a terminal
> handler when code must stop a request, decide whether to call `next()`, or change application request
> or response semantics. Hook failures are isolated and do not fail an otherwise successful request.

```typescript
app.addHook("onResponse", ({ req, statusCode, durationMs }) => {
  console.log(`${req.method} ${req.pathname} ${statusCode} ${durationMs.toFixed(2)}ms`);
});
```

Core defines `onRequest`, `onRoute`, `onResponse`, `onError`, and `onNotFound`; the server layer defines `onConnect`, `onDisconnect`, `onListen`, and `onClose`. Middleware and plugins can add typed, namespaced extension events such as `bodyParser:parsed` without adding their semantics to core. Handlers can be removed with `app.removeHook(name, handler)`.

`core/hooks` contains the event bus, core lifecycle payloads, and the declaration-merging `HookEvents`
extension point. Server and middleware/plugin modules declare payload types next to the events they
own. Extension authors declare their event on `nova-http` and emit it through
`this.hooks.emitHook(...)` from a normal function middleware. No runtime event-type registry is
required. Hooks are non-blocking observations; request control flow belongs in middleware.

## CLI

Create a minimal TypeScript project:

```bash
npm create nova-http@latest my-app
```

Choose a template or JavaScript:

```bash
npm create nova-http@latest my-api -- --template api --lang ts
npm create nova-http@latest my-app -- --lang js
```

The same generator is available from the framework CLI:

```bash
npx nova-http create my-app
```

Options:

- `--template minimal|api`
- `--lang ts|js`
- `--force` or `-f`

## How it works

Nova owns the full HTTP request path rather than wrapping Node.js `http`:

```text
TCP connection
    ↓
Connection management and timeouts
    ↓
HTTP/1.1 state-machine parser
    ↓
Global middleware
    ↓
Radix tree route matching
    ↓
Route middleware and handler
    ↓
Fixed-length or chunked response writer
    ↓
TCP response / Keep-Alive reuse
```

Working at the TCP layer gives Nova explicit control over parser behavior, header and request timeouts, Keep-Alive policy, request-smuggling checks, and response backpressure.

## Development

This repository is a pnpm workspace:

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## License

[MIT](./LICENSE) © Owl23007

### Request semantics

- `rawTarget` preserves the original request-target. The protocol layer extracts `path` including query; `pathname` excludes query. Escapes and dot segments remain unchanged. The duplicate `target` property is removed.
- `cookies` uses a null-prototype object and preserves percent-encoded values without URI decoding.
- `bodyBytesReceived` counts bytes received so far, not the final body size; `bodySize` is removed.
- `isJson` and `bodyParser` recognize `application/json` and `application/*+json`, ignoring media type case and parameters.
- `trustProxy` defaults to `false`. Use `true` to trust all proxies, a non-negative integer for trusted hops, or `(address, hop) => boolean`. Hop 0 is the socket peer. X-Forwarded-For is traversed right to left until the first untrusted address; an invalid IP stops traversal. There is no X-Real-IP fallback. Hop counts require consistent ingress chain lengths; `true` requires the ingress proxy to sanitize client-supplied forwarding headers.
