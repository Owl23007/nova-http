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
const pipelining = Number(process.env.BENCH_PIPELINING || 1);
const host = process.env.BENCH_HOST || '127.0.0.1';
const basePort = Number(process.env.BENCH_BASE_PORT || 4001);

const FIXED_JSON = {
  ok: true,
  name: 'nova-bench',
  version: 1,
};

const ECHO_BODY = JSON.stringify({
  id: 123,
  name: 'benchmark',
  tags: ['nova', 'http', 'compare'],
  active: true,
});

const scenarios = [
  {
    name: 'GET /json',
    method: 'GET',
    path: '/json',
  },
  {
    name: 'POST /echo',
    method: 'POST',
    path: '/echo',
    body: ECHO_BODY,
    headers: {
      'content-type': 'application/json',
    },
  },
];

const frameworkDefs = [
  { name: 'Nova', starter: startNova },
  { name: 'Fastify', starter: startFastify },
  { name: 'Express', starter: startExpress },
  { name: 'Koa', starter: startKoa },
];

function formatInt(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return Math.round(value).toLocaleString('en-US');
}

function formatNum(value, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error([
          `[benchmark:compare] command failed (${code})`,
          `${command} ${args.join(' ')}`,
          stderr.trim() || '(no stderr)',
        ].join('\n')));
      }
    });
  });
}

function resolveNpmCli() {
  const candidate = path.resolve(
    path.dirname(process.execPath),
    'node_modules/npm/bin/npm-cli.js',
  );
  if (fs.existsSync(candidate)) return candidate;

  try {
    return require.resolve('npm/bin/npm-cli.js');
  } catch (_error) {
    throw new Error('[benchmark:compare] npm-cli.js not found');
  }
}

const npmCli = resolveNpmCli();

async function runAuto(options) {
  const args = [
    npmCli,
    'exec',
    '--yes',
    'autocannon',
    '--',
    '-j',
    '-d',
    String(options.duration),
    '-c',
    String(options.connections),
    '-p',
    String(options.pipelining),
    '-m',
    options.method || 'GET',
  ];

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      args.push('-H', `${key}=${value}`);
    }
  }

  if (typeof options.body === 'string') {
    args.push('-b', options.body);
  }

  args.push(options.url);

  const { stdout } = await runCommand(process.execPath, args, { env: process.env });
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('[benchmark:compare] autocannon output is empty');
  }

  return JSON.parse(trimmed);
}

function requestOnce(url, method = 'GET') {
  return new Promise((resolve) => {
    const req = http.request(url, { method }, (res) => {
      const status = res.statusCode || 0;
      res.resume();
      resolve(status);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });
}

async function waitHealthy(baseUrl, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await requestOnce(`${baseUrl}/health`);
    if (status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`[benchmark:compare] ${baseUrl} not healthy in ${timeoutMs}ms`);
}

async function startNova(port) {
  const distEntry = path.resolve(__dirname, '../dist/src/index.js');
  const { createApp, bodyParser } = require(distEntry);

  const app = createApp({
    keepAliveTimeout: 65_000,
    maxBodySize: 1_048_576,
  });

  app.use(bodyParser());
  app.get('/health', (_req, res) => res.send('ok'));
  app.get('/json', (_req, res) => res.json(FIXED_JSON));
  app.post('/echo', (req, res) => res.json({ received: req.bodyParsed ?? null }));

  await app.listen(port, host);

  return {
    close: () => app.close(),
  };
}

async function startFastify(port) {
  const app = Fastify({ logger: false });

  app.get('/health', async () => 'ok');
  app.get('/json', async () => FIXED_JSON);
  app.post('/echo', async (req) => ({ received: req.body ?? null }));

  await app.listen({ port, host });

  return {
    close: () => app.close(),
  };
}

async function startExpress(port) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.type('text/plain').send('ok');
  });

  app.get('/json', (_req, res) => {
    res.json(FIXED_JSON);
  });

  app.post('/echo', (req, res) => {
    res.json({ received: req.body ?? null });
  });

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startKoa(port) {
  const app = new Koa();
  const router = new KoaRouter();

  app.use(koaBodyParser());

  router.get('/health', (ctx) => {
    ctx.type = 'text/plain';
    ctx.body = 'ok';
  });

  router.get('/json', (ctx) => {
    ctx.body = FIXED_JSON;
  });

  router.post('/echo', (ctx) => {
    ctx.body = { received: ctx.request.body ?? null };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function getFrameworkVersions() {
  return {
    nova: require('../package.json').version,
    express: require('express/package.json').version,
    fastify: require('fastify/package.json').version,
    koa: require('koa/package.json').version,
  };
}

function printSummary(allResults) {
  process.stdout.write('\nCompare config\n');
  process.stdout.write(`- duration: ${duration}s\n`);
  process.stdout.write(`- connections: ${connections}\n`);
  process.stdout.write(`- pipelining: ${pipelining}\n\n`);

  for (const scenario of scenarios) {
    process.stdout.write(`${scenario.name}\n`);
    const header = [
      pad('Framework', 10),
      pad('Req/s', 12),
      pad('Avg Lat(ms)', 12),
      pad('P99 Lat(ms)', 12),
      pad('Errors', 8),
      'Vs Nova',
    ].join(' ');
    process.stdout.write(`${header}\n`);
    process.stdout.write(`${'-'.repeat(header.length)}\n`);

    const rows = allResults
      .map((item) => ({
        framework: item.framework,
        result: item.results.find((r) => r.scenario === scenario.name),
      }))
      .filter((item) => item.result);

    const novaReq = rows.find((r) => r.framework === 'Nova')?.result.requestsPerSec ?? 0;

    for (const row of rows) {
      const ratio = novaReq > 0 ? row.result.requestsPerSec / novaReq : 0;
      const line = [
        pad(row.framework, 10),
        pad(formatInt(row.result.requestsPerSec), 12),
        pad(formatNum(row.result.avgLatencyMs), 12),
        pad(formatNum(row.result.p99LatencyMs), 12),
        pad(formatInt(row.result.errors), 8),
        row.framework === 'Nova' ? '1.00x' : `${formatNum(ratio, 2)}x`,
      ].join(' ');
      process.stdout.write(`${line}\n`);
    }

    process.stdout.write('\n');
  }
}

async function runFramework(framework, port) {
  const baseUrl = `http://${host}:${port}`;
  const server = await framework.starter(port);

  try {
    await waitHealthy(baseUrl);
    await requestOnce(`${baseUrl}/json`);
    await requestOnce(`${baseUrl}/echo`, 'POST');

    const results = [];
    for (const scenario of scenarios) {
      process.stdout.write(`[benchmark:compare] ${framework.name} -> ${scenario.name}\n`);
      const result = await runAuto({
        url: `${baseUrl}${scenario.path}`,
        method: scenario.method,
        connections,
        duration,
        pipelining,
        headers: scenario.headers,
        body: scenario.body,
      });

      results.push({
        scenario: scenario.name,
        requestsPerSec: result.requests?.average ?? 0,
        avgLatencyMs: result.latency?.average ?? 0,
        p99LatencyMs: result.latency?.p99 ?? 0,
        errors: result.errors ?? 0,
        non2xx: result.non2xx ?? 0,
      });
    }

    return results;
  } finally {
    await server.close();
  }
}

async function main() {
  const versions = getFrameworkVersions();
  const allResults = [];

  for (let i = 0; i < frameworkDefs.length; i += 1) {
    const framework = frameworkDefs[i];
    const port = basePort + i;
    const results = await runFramework(framework, port);
    allResults.push({
      framework: framework.name,
      port,
      results,
    });
  }

  printSummary(allResults);

  const outputDir = path.resolve(__dirname, '../.tmp');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `benchmark-compare-${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    node: process.version,
    versions,
    config: { duration, connections, pipelining, host, basePort },
    results: allResults,
  }, null, 2));

  process.stdout.write(`[benchmark:compare] raw results saved: ${outputFile}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
