'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const duration = Number(process.env.BENCH_DURATION || 15);
const connections = Number(process.env.BENCH_CONNECTIONS || 200);
const pipelining = Number(process.env.BENCH_PIPELINING || 1);
const host = process.env.BENCH_HOST || '127.0.0.1';
const port = Number(process.env.BENCH_PORT || 3901);
const baseUrl = `http://${host}:${port}`;

const scenarios = [
  { name: 'GET /text', method: 'GET', path: '/text' },
  { name: 'GET /json', method: 'GET', path: '/json' },
  {
    name: 'POST /echo',
    method: 'POST',
    path: '/echo',
    body: JSON.stringify({
      id: 123,
      name: 'nova',
      active: true,
      tags: ['bench', 'http', 'json'],
    }),
    headers: { 'content-type': 'application/json' },
  },
];

function resolveNpmCli() {
  const candidate = path.resolve(
    path.dirname(process.execPath),
    'node_modules/npm/bin/npm-cli.js',
  );
  if (fs.existsSync(candidate)) {
    return candidate;
  }

  try {
    return require.resolve('npm/bin/npm-cli.js');
  } catch (_error) {
    throw new Error('[benchmark] npm-cli.js not found; cannot run autocannon via npm exec');
  }
}

const npmCli = resolveNpmCli();

function pad(value, width) {
  const text = String(value);
  if (text.length >= width) return text;
  return `${text}${' '.repeat(width - text.length)}`;
}

function formatNumber(value, fractionDigits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toFixed(fractionDigits);
}

function formatInt(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return Math.round(value).toLocaleString('en-US');
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
        const message = [
          `[benchmark] command failed: ${command} ${args.join(' ')}`,
          `[benchmark] exit code: ${code}`,
          stderr.trim() || '(no stderr)',
        ].join('\n');
        reject(new Error(message));
      }
    });
  });
}

function requestHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const ok = res.statusCode === 200;
      res.resume();
      resolve(ok);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServerReady(timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const healthy = await requestHealth(`${baseUrl}/health`);
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`[benchmark] server did not become healthy in ${timeoutMs}ms`);
}

async function stopServer(server) {
  if (!server || server.killed) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!server.killed) {
        server.kill('SIGKILL');
      }
    }, 3_000);

    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    server.kill('SIGTERM');
  });
}

async function runScenario(scenario) {
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
    String(pipelining),
    '-m',
    scenario.method,
  ];

  if (scenario.headers) {
    for (const [key, value] of Object.entries(scenario.headers)) {
      args.push('-H', `${key}=${value}`);
    }
  }

  if (scenario.body) {
    args.push('-b', scenario.body);
  }

  args.push(`${baseUrl}${scenario.path}`);

  const { stdout } = await runCommand(process.execPath, args, { env: process.env });
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`[benchmark] autocannon returned empty output for ${scenario.name}`);
  }

  let result;
  try {
    result = JSON.parse(trimmed);
  } catch (error) {
    throw new Error([
      `[benchmark] failed to parse autocannon JSON for ${scenario.name}`,
      String(error),
      trimmed,
    ].join('\n'));
  }

  return result;
}

function printSummary(results) {
  process.stdout.write('\nBenchmark config\n');
  process.stdout.write(`- target: ${baseUrl}\n`);
  process.stdout.write(`- duration: ${duration}s\n`);
  process.stdout.write(`- connections: ${connections}\n`);
  process.stdout.write(`- pipelining: ${pipelining}\n\n`);

  const header = [
    pad('Scenario', 14),
    pad('Req/s', 12),
    pad('Avg Lat(ms)', 12),
    pad('P99 Lat(ms)', 12),
    pad('MB/s', 10),
    pad('Errors', 10),
    'Non-2xx',
  ].join(' ');
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${'-'.repeat(header.length)}\n`);

  for (const item of results) {
    const row = [
      pad(item.scenario.name, 14),
      pad(formatInt(item.result.requests?.average), 12),
      pad(formatNumber(item.result.latency?.average), 12),
      pad(formatNumber(item.result.latency?.p99), 12),
      pad(formatNumber((item.result.throughput?.average ?? 0) / (1024 * 1024)), 10),
      pad(formatInt(item.result.errors ?? 0), 10),
      formatInt(item.result.non2xx ?? 0),
    ].join(' ');
    process.stdout.write(`${row}\n`);
  }
}

async function main() {
  const serverScript = path.resolve(__dirname, './benchmark-server.js');
  const server = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      BENCH_HOST: host,
      BENCH_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverStderr = '';
  server.stderr.on('data', (chunk) => {
    serverStderr += chunk.toString();
  });

  try {
    await waitForServerReady();

    const results = [];
    for (const scenario of scenarios) {
      process.stdout.write(`[benchmark] running ${scenario.name}\n`);
      const result = await runScenario(scenario);
      results.push({ scenario, result });
    }

    printSummary(results);

    const outputDir = path.resolve(__dirname, '../.tmp');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, `benchmark-${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify({
      generatedAt: new Date().toISOString(),
      node: process.version,
      config: { host, port, duration, connections, pipelining },
      results,
    }, null, 2));
    process.stdout.write(`\n[benchmark] raw results saved: ${outputFile}\n`);
  } finally {
    await stopServer(server);
    if (serverStderr.trim()) {
      process.stderr.write(`[benchmark] server stderr:\n${serverStderr}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
