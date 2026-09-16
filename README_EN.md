# Nova

English · [简体中文](./README.md)

Nova is a lightweight HTTP framework built directly on Node.js TCP. It provides method routing, middleware, sub-applications, typed lifecycle hooks, and backpressure-aware request and response streams. The production package uses no third-party runtime dependencies.

## Quick start

```sh
npm create nova-http@latest my-app -- --template minimal --lang ts
cd my-app
npm install
npm run dev
```

For a single-file service, run `npm install nova-http` and save this as `app.mjs`:

```js
import { createApp } from "nova-http";

const app = createApp();
app.get("/hello/:name", (req, res) => {
  res.json({ hello: req.params.name });
});
await app.listen(3000, "127.0.0.1");
```

Run `node app.mjs`, then request `http://127.0.0.1:3000/hello/Nova`.

## Documentation

The full documentation is currently maintained in Simplified Chinese:

| Task                 | Reference                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Build an application | [Guide](./docs/guide/introduction.md), [quick start](./docs/guide/getting-started.md)                                                       |
| Look up behavior     | [API](./docs/api/index.md), [configuration](./docs/api/configuration.md), [CLI](./docs/api/cli.md)                                          |
| Stream data          | [Request bodies](./docs/guide/request-body.md), [responses](./docs/guide/streaming-response.md), [SSE example](./docs/guide/recipes/sse.md) |
| Extend the framework | [Architecture](./docs/framework/architecture.md), [extensions](./docs/framework/extensions.md)                                              |
| Upgrade              | [Version notes](./docs/releases/index.md), [core migration](./docs/releases/migrations/core-api.md)                                         |

Documentation describes the current checkout. Pending Changesets include API changes that may not be available in the published npm version.

## Scope

Published packages require Node.js 20 or later and are installation-smoke-tested on Node.js 20, 22 and 24. Repository development requires Node.js 22.22.1 or later within the 22/24 release lines; Node.js 24 is recommended for builds and releases. Nova provides HTTP/1.0 and HTTP/1.1. TLS termination, persistence, authentication and business validation are application or deployment concerns.

The middleware signature is Express-style, but Nova request and response objects do not guarantee compatibility with middleware that depends on Express or Node HTTP internals. `next()` returns void; use `onResponse` for completion observation. Request bodies are single-consumer streams, and manual response writes should be awaited and ended before the handler returns.

## Development

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm docs:dev
```

Full tests require Redis and a Node version with node:sqlite. See [test guidance](./docs/framework/contributing/testing.md). Check documentation examples with `pnpm docs:check` and build with `pnpm docs:build`.

## License

[MIT](./LICENSE) © Owl23007
