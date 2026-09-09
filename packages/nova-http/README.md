# nova-http

[Full English documentation](https://github.com/Owl23007/nova-http/blob/master/README_EN.md) · [中文文档与 API 参考](https://github.com/Owl23007/nova-http#readme)

A zero-dependency HTTP framework built directly on Node.js `net`. Nova provides a TypeScript-first API, radix-tree routing, middleware, lifecycle hooks, Keep-Alive connections, and backpressure-aware streaming.

## Installation

```bash
npm install nova-http
```

Requires Node.js 18 or later.

## Quick start

```typescript
import { bodyParser, createApp } from "nova-http";

const app = createApp();

app.use(bodyParser());

app.get("/", (_req, res) => {
  res.json({ hello: "Nova!" });
});

app.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});

await app.listen(3000);
```

## Highlights

- Zero runtime dependencies
- Built-in HTTP/1.1 parser on top of TCP
- Static, parameter, and wildcard routing
- Express-style middleware and mountable sub-applications
- JSON and URL-encoded body parsing
- Static files with ETags, `Last-Modified`, and range requests
- Node.js `Readable` and async-iterable streaming
- Backpressure-aware response writes
- Backpressure-aware streaming request bodies
- Ten lifecycle hooks for logs and metrics
- Keep-Alive, header timeouts, request timeouts, and body-size limits

## Streaming

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

For manual streaming, await every `res.write()` call and finish with `res.end()`. `requestTimeout` protects ordinary handlers but stops once the response enters streaming mode, so server-sent events and other long-lived streams are not cut off by it. Calling `app.close()` aborts active long-running streams during graceful shutdown.

## Built-in middleware

```typescript
import { bodyParser, staticFiles } from "nova-http";

app.use(bodyParser({ maxSize: 1_048_576 }));
app.use("/static", staticFiles("./public", { maxAge: 3600 }));
```

## Create a project

```bash
npm create nova-http@latest my-app
npm create nova-http@latest my-api -- --template api --lang ts
```

Templates are available for TypeScript and JavaScript. Use `--template minimal|api`, `--lang ts|js`, and `--force` to customize generation.

## Documentation

See the links at the top of this page for the complete API reference, examples, and design notes.

## License

MIT © Owl23007
