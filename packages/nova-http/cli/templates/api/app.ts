import {
  bodyParser,
  createApp,
  createRequestTimer,
  type ErrorMiddleware,
  type NovaRequest,
  type NovaResponse,
} from 'nova-http';
import * as fs from 'fs';
import * as path from 'path';
import { usersRouter } from './routes/users';
import { healthRouter } from './routes/health';
import { authMiddleware } from './middlewares/auth';
import { requestLogger } from './middlewares/logger';

const app = createApp({
  maxBodySize: 1 * 1024 * 1024, // 1 MB
  keepAliveTimeout: 65_000,
});

function readAppVersion(): string {
  const candidates = [
    path.resolve(__dirname, 'package.json'),
    path.resolve(__dirname, '..', 'package.json'),
  ];

  for (const packageJsonPath of candidates) {
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
      if (packageJson.version) {
        return packageJson.version;
      }
    } catch {
      // Ignore unreadable package.json and keep searching.
    }
  }

  return '{{projectVersion}}';
}

const APP_VERSION = readAppVersion();

// 全链路钩子
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
  const e = error as Error;
  const path = req ? `${req.method} ${req.pathname}` : 'unknown';
  console.error(`[错误] ${path}:`, e.message);
});

app.addHook('onNotFound', ({ res }) => {
  res.status(404).json({ error: '接口不存在' });
});

// 全局中间件
app.use(requestLogger());
app.use(bodyParser());

// 路由挂载
app.use('/health', healthRouter);

app.get('/', (_req: NovaRequest, res: NovaResponse) => {
  res.json({
    name: '{{name}}',
    version: APP_VERSION,
    status: 'running',
    docs: '/api/users （需要 Authorization 头）',
  });
});

app.use('/api', authMiddleware(), usersRouter);

// 全局错误处理
const errorHandler: ErrorMiddleware = (err, _req, res, _next) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error.stack);
  res.status(500).json({ error: '服务器内部错误', message: error.message });
};

app.use(errorHandler);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, '0.0.0.0');
