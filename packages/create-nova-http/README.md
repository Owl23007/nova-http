# create-nova-http

Initializer package for Nova HTTP projects.

The initializer follows the `nova-http` package version. `create-nova-http@0.2.1`
therefore creates projects that depend on `nova-http@^0.2.1`.

## Usage

```bash
npm create nova-http@latest my-app
```

Or:

```bash
npx create-nova-http@latest my-app
```

## Options

```bash
npm create nova-http@latest my-app -- --template api --lang ts
```

Available options:

- --template minimal|api
- --lang ts|js
- --force

Generated API projects use Nova's public request lifecycle hooks for logging and
support both TypeScript and JavaScript templates.
