const { bodyParser, createApp, createRequestTimer } = require('nova-http');
const { usersRouter } = require('./routes/users');
const { healthRouter } = require('./routes/health');
const { authMiddleware } = require('./middlewares/auth');
const { requestLogger } = require('./middlewares/logger');

const app = createApp({
  maxBodySize: 1 * 1024 * 1024,
  keepAliveTimeout: 65_000,
});

const timer = createRequestTimer();
app.addHook('onRequest', timer.onRequest);
app.addHook('onResponse', timer.onResponse);

app.addHook('onListen', ({ host, port }) => {
  const localHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  console.log(`\n  {{name}} API 服务已启动`);
  console.log(`  本地: http://${localHost}:${port}`);
  console.log('');
});

app.addHook('onError', ({ error, req }) => {
  const e = error instanceof Error ? error : new Error(String(error));
  const routePath = req ? `${req.method} ${req.pathname}` : 'unknown';
  console.error(`[错误] ${routePath}:`, e.message);
});

app.addHook('onNotFound', ({ res }) => {
  res.status(404).json({ error: '接口不存在' });
});

app.use(requestLogger());
app.use(bodyParser());

app.use('/health', healthRouter);

app.get('/', (_req, res) => {
  res.json({
    name: '{{name}}',
    version: '0.1.0',
    status: 'running',
    docs: '/api/users （需要 Authorization 头）',
  });
});

app.use('/api', authMiddleware(), usersRouter);

app.use((err, _req, res, _next) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error.stack);
  res.status(500).json({ error: '服务器内部错误', message: error.message });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, '0.0.0.0');

