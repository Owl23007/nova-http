import { readServerConfig } from "./core/config.js";
import { loadNovaHttp } from "./core/framework.js";
import { createSqliteDatabase } from "./infra/sqlite.js";
import { createRedisClient } from "./infra/redis.js";
import { createMetricsRegistry } from "./core/metrics.js";
import { requestContextMiddleware } from "./middlewares/request-context.js";
import { redisCounterMiddleware, resourceMiddleware } from "./middlewares/resources.js";
import { registerRoutes } from "./router/routes.js";
import { registerSubApps } from "./router/subapps.js";

export async function createProductionApp(env = process.env, runtime = loadNovaHttp()) {
  // 应用组装层只负责串联配置、基础设施、中间件和 subapp，避免业务逻辑散落在启动文件里
  const config = readServerConfig(env);
  const { createApp, bodyParser } = runtime;
  const metrics = createMetricsRegistry();
  const readiness = createReadiness();
  const resources = {
    db: await createSqliteDatabase(config),
    redis: await createRedisClient(config),
  };

  const app = createApp({
    host: config.host,
    port: config.port,
    keepAliveTimeout: config.keepAliveTimeout,
    headersTimeout: config.headersTimeout,
    requestTimeout: config.requestTimeout,
    maxBodySize: config.maxBodySize,
    maxConnections: config.maxConnections,
    trustProxy: config.trustProxy,
  });

  app.addHook("onRequest", ({ req }) => {
    req["_startAt"] = process.hrtime.bigint();
  });
  app.addHook("onResponse", metrics.onResponse);
  app.addHook("onError", metrics.onError);

  // 全局中间件顺序：请求标识 -> 依赖注入 -> 请求体解析 -> Redis 计数
  app.use(requestContextMiddleware());
  app.use(resourceMiddleware(resources));
  app.use(bodyParser({ maxSize: config.maxBodySize, strict: true, maxParams: 100 }));
  app.use(redisCounterMiddleware("performance-api"));

  registerRoutes(app, {
    metrics,
    metricsToken: config.metricsToken,
    readiness,
  });
  registerSubApps(app, createApp);

  return {
    app,
    config,
    metrics,
    readiness,
    resources,
    close: async () => {
      metrics.close();
      await resources.redis.close();
      resources.db.close();
      await app.close();
    },
  };
}

function createReadiness() {
  let ready = false;

  return {
    isReady: () => ready,
    setReady: (value) => {
      ready = value;
    },
  };
}
