# Releasing `nova-http` 0.1.x

## Before Publishing

Run these commands from the repo root:

```bash
npm run build
npm run typecheck
npm run verify:create
pnpm -C examples typecheck
```

If you want to inspect the exact publish payload without using the global npm cache:

```bash
npm_config_cache=.tmp/npm-cache npm pack --dry-run --json
```

Verify at least these points:

- `LICENSE` is included
- `dist/src/index.js` and `dist/src/index.d.ts` are included
- `dist/cli/nova.js` and `dist/cli/create-nova.js` are included
- `dist/cli/templates/minimal/*` and `dist/cli/templates/api/*` are included
- publish name is `nova-http`
- initializer name is `create-nova-http`

## Publish

```bash
npm publish --access public
```

Then publish the initializer package that maps to `npm create nova-http`:

- package name: `create-nova-http`
- executable: `create-nova-http`
- generated app dependency: `nova-http`

## After Publishing

Smoke test the public install path:

```bash
npm create nova-http my-app
cd my-app
npm install
npm run dev
```

Confirm:

- the project installs `nova-http`
- TypeScript types resolve without extra declarations
- both `minimal` and `api` templates still work
