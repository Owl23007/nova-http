'use strict';

const path = require('path');

const distEntry = path.resolve(__dirname, '../dist/src/index.js');

let createApp;
let bodyParser;
try {
  ({ createApp, bodyParser } = require(distEntry));
} catch (error) {
  console.error('[benchmark] Failed to load dist build from dist/src/index.js.');
  console.error('[benchmark] Run "npm run build" first.');
  console.error(error);
  process.exit(1);
}

const port = Number(process.env.BENCH_PORT || 3901);
const host = process.env.BENCH_HOST || '127.0.0.1';

const app = createApp({
  keepAliveTimeout: 65_000,
  maxBodySize: 1_048_576,
});

app.use(bodyParser());

app.get('/health', (_req, res) => {
  res.send('ok');
});

app.get('/text', (_req, res) => {
  res.send('hello world');
});

app.get('/json', (_req, res) => {
  res.json({
    ok: true,
    framework: 'nova-http',
    timestamp: Date.now(),
  });
});

app.post('/echo', (req, res) => {
  res.json({
    received: req.bodyParsed ?? null,
  });
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`[benchmark] received ${signal}, shutting down\n`);
  try {
    await app.close();
  } catch (error) {
    console.error('[benchmark] graceful shutdown failed', error);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

app.listen(port, host, () => {
  process.stdout.write(`BENCH_READY http://${host}:${port}\n`);
}).catch((error) => {
  console.error('[benchmark] server start failed', error);
  process.exit(1);
});
