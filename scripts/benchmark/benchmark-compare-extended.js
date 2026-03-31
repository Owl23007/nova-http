'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const express = require('express');
const Fastify = require('fastify');
const Koa = require('koa');
const KoaRouter = require('@koa/router');
const koaBodyParser = require('koa-bodyparser');

const duration = Number(process.env.BENCH_DURATION || 10);
const connections = Number(process.env.BENCH_CONNECTIONS || 200);
const defaultPipelining = Number(process.env.BENCH_PIPELINING || 1);
const host = process.env.BENCH_HOST || '127.0.0.1';
const basePort = Number(process.env.BENCH_BASE_PORT || 4201);
const middlewareDepth = Number(process.env.BENCH_MIDDLEWARE_DEPTH || 5);

const SMALL_BODY_OBJ = { id: 1, action: 'ping', ok: true };
const LARGE_BODY_OBJ = {
  id: 2,
  tags: ['nova', 'bench', 'payload'],
  payload: 'x'.repeat(4 * 1024),
};
const SMALL_BODY = JSON.stringify(SMALL_BODY_OBJ);
const LARGE_BODY = JSON.stringify(LARGE_BODY_OBJ);

const FIXED_JSON = { ok: true, framework: 'bench', n: 42 };
const HEAVY_JSON = {
  ok: true,
  framework: 'bench',
  payload: 'y'.repeat(8 * 1024),
  arr: Array.from({ length: 64 }, (_, i) => i),
};

const scenarios = [
  { name: 'GET /json', method: 'GET', path: '/json' },
  { name: 'GET /json-heavy', method: 'GET', path: '/json-heavy' },
  {
    name: 'POST /echo-small',
    method: 'POST',
    path: '/echo-small',
    body: SMALL_BODY,
    headers: { 'content-type': 'application/json' },
  },
  {
    name: 'POST /echo-large',
    method: 'POST',
    path: '/echo-large',
    body: LARGE_BODY,
    headers: { 'content-type': 'application/json' },
  },
  {
    name: 'GET /json (p10)',
    method: 'GET',
    path: '/json',
    pipelining: 10,
  },
];

const frameworkDefs = [
  { name: 'Nova', starter: startNova },
  { name: 'Fastify', starter: startFastify },
  { name: 'Express', starter: startExpress },
  { name: 'Koa', starter: startKoa },
];

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`;
}

function formatInt(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return Math.round(value).toLocaleString('en-US');
}

function formatNum(value, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

function resolveNpmCli() {
  const candidate = path.resolve(
    path.dirname(process.execPath),
    'node_modules/npm/bin/npm-cli.js',
  );
  if (fs.existsSync(candidate)) return candidate;
  try {
    return require.resolve('npm/bin/npm-cli.js');
  } catch {
    throw new Error('[benchmark:extended] npm-cli.js not found');
  }
}

const npmCli = resolveNpmCli();

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error([
          `[benchmark:extended] command failed (${code})`,
          `${command} ${args.join(' ')}`,
          stderr.trim() || '(no stderr)',
        ].join('\n')));
      }
    });
  });
}

async function runAuto(url, scenario) {
  const args = [
    npmCli,
    'exec',
    '--yes',
    'autocannon',
    '--',
    '-j',
    '-d',
    String(duration),
    '-c',
    String(connections),
    '-p',
    String(scenario.pipelining ?? defaultPipelining),
    '-m',
    scenario.method,
  ];

  if (scenario.headers) {
    for (const [k, v] of Object.entries(scenario.headers)) {
      args.push('-H', `${k}=${v}`);
    }
  }
  if (typeof scenario.body === 'string') {
    args.push('-b', scenario.body);
  }
  args.push(`${url}${scenario.path}`);

  const { stdout } = await runCommand(process.execPath, args, { env: process.env });
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('[benchmark:extended] autocannon output is empty');
  return JSON.parse(trimmed);
}

function requestOnce(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const status = res.statusCode || 0;
      res.resume();
      resolve(status);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function waitHealthy(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await requestOnce(`${baseUrl}/health`);
    if (status === 200) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`[benchmark:extended] ${baseUrl} not healthy in ${timeoutMs}ms`);
}

async function startNova(port) {
  const { createApp, bodyParser } = require(path.resolve(__dirname, '../dist/src/index.js'));
  const app = createApp({ keepAliveTimeout: 65_000, maxBodySize: 2 * 1024 * 1024 });
  app.use(bodyParser());

  for (let i = 0; i < middlewareDepth; i += 1) {
    app.use((_req, _res, next) => next());
  }

  app.get('/health', (_req, res) => res.send('ok'));
  app.get('/json', (_req, res) => res.json(FIXED_JSON));
  app.get('/json-heavy', (_req, res) => res.json(HEAVY_JSON));
  app.post('/echo-small', (req, res) => res.json({ received: req.bodyParsed ?? null }));
  app.post('/echo-large', (req, res) => res.json({ received: req.bodyParsed ?? null }));

  await app.listen(port, host);
  return { close: () => app.close() };
}

async function startFastify(port) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  for (let i = 0; i < middlewareDepth; i += 1) {
    app.addHook('preHandler', (_req, _reply, done) => done());
  }

  app.get('/health', async () => 'ok');
  app.get('/json', async () => FIXED_JSON);
  app.get('/json-heavy', async () => HEAVY_JSON);
  app.post('/echo-small', async (req) => ({ received: req.body ?? null }));
  app.post('/echo-large', async (req) => ({ received: req.body ?? null }));

  await app.listen({ port, host });
  return { close: () => app.close() };
}

async function startExpress(port) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  for (let i = 0; i < middlewareDepth; i += 1) {
    app.use((_req, _res, next) => next());
  }

  app.get('/health', (_req, res) => res.type('text/plain').send('ok'));
  app.get('/json', (_req, res) => res.json(FIXED_JSON));
  app.get('/json-heavy', (_req, res) => res.json(HEAVY_JSON));
  app.post('/echo-small', (req, res) => res.json({ received: req.body ?? null }));
  app.post('/echo-large', (req, res) => res.json({ received: req.body ?? null }));

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });
  return { close: () => new Promise((resolve) => server.close(resolve)) };
}

async function startKoa(port) {
  const app = new Koa();
  const router = new KoaRouter();
  app.use(koaBodyParser({ jsonLimit: '2mb' }));

  for (let i = 0; i < middlewareDepth; i += 1) {
    app.use(async (_ctx, next) => { await next(); });
  }

  router.get('/health', (ctx) => { ctx.type = 'text/plain'; ctx.body = 'ok'; });
  router.get('/json', (ctx) => { ctx.body = FIXED_JSON; });
  router.get('/json-heavy', (ctx) => { ctx.body = HEAVY_JSON; });
  router.post('/echo-small', (ctx) => { ctx.body = { received: ctx.request.body ?? null }; });
  router.post('/echo-large', (ctx) => { ctx.body = { received: ctx.request.body ?? null }; });

  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });
  return { close: () => new Promise((resolve) => server.close(resolve)) };
}

async function runFramework(def, port) {
  const baseUrl = `http://${host}:${port}`;
  const server = await def.starter(port);
  try {
    await waitHealthy(baseUrl);
    const out = [];
    for (const scenario of scenarios) {
      process.stdout.write(`[benchmark:extended] ${def.name} -> ${scenario.name}\n`);
      const result = await runAuto(baseUrl, scenario);
      out.push({
        scenario: scenario.name,
        requestsPerSec: result.requests?.average ?? 0,
        avgLatencyMs: result.latency?.average ?? 0,
        p99LatencyMs: result.latency?.p99 ?? 0,
        throughputMBps: (result.throughput?.average ?? 0) / (1024 * 1024),
        errors: result.errors ?? 0,
        non2xx: result.non2xx ?? 0,
      });
    }
    return out;
  } finally {
    await server.close();
  }
}

function printSummary(allResults) {
  process.stdout.write('\nExtended compare config\n');
  process.stdout.write(`- duration: ${duration}s\n`);
  process.stdout.write(`- connections: ${connections}\n`);
  process.stdout.write(`- default pipelining: ${defaultPipelining}\n`);
  process.stdout.write(`- middleware depth: ${middlewareDepth}\n\n`);

  for (const scenario of scenarios) {
    process.stdout.write(`${scenario.name}\n`);
    const header = [
      pad('Framework', 10),
      pad('Req/s', 12),
      pad('Avg Lat', 10),
      pad('P99 Lat', 10),
      pad('MB/s', 10),
      pad('Err', 6),
      'Vs Nova',
    ].join(' ');
    process.stdout.write(`${header}\n`);
    process.stdout.write(`${'-'.repeat(header.length)}\n`);

    const rows = allResults.map((entry) => ({
      framework: entry.framework,
      result: entry.results.find((r) => r.scenario === scenario.name),
    })).filter((x) => x.result);

    const novaReq = rows.find((r) => r.framework === 'Nova')?.result.requestsPerSec ?? 0;
    for (const row of rows) {
      const ratio = novaReq > 0 ? row.result.requestsPerSec / novaReq : 0;
      process.stdout.write([
        pad(row.framework, 10),
        pad(formatInt(row.result.requestsPerSec), 12),
        pad(formatNum(row.result.avgLatencyMs), 10),
        pad(formatNum(row.result.p99LatencyMs), 10),
        pad(formatNum(row.result.throughputMBps), 10),
        pad(formatInt(row.result.errors), 6),
        row.framework === 'Nova' ? '1.00x' : `${formatNum(ratio)}x`,
      ].join(' '));
      process.stdout.write('\n');
    }
    process.stdout.write('\n');
  }
}

async function main() {
  const allResults = [];
  for (let i = 0; i < frameworkDefs.length; i += 1) {
    const def = frameworkDefs[i];
    const port = basePort + i;
    const results = await runFramework(def, port);
    allResults.push({ framework: def.name, port, results });
  }

  printSummary(allResults);

  const outputDir = path.resolve(__dirname, '../.tmp');
  fs.mkdirSync(outputDir, { recursive: true });
  const outFile = path.join(outputDir, `benchmark-compare-extended-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    node: process.version,
    config: {
      duration, connections, defaultPipelining, host, basePort, middlewareDepth,
    },
    results: allResults,
  }, null, 2));
  process.stdout.write(`[benchmark:extended] raw results saved: ${outFile}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
