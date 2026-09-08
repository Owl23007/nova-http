import { fileURLToPath } from "node:url";

export function readServerConfig(env = process.env) {
  // 所有运行参数都从环境变量读取，便于同一套服务在本地、CI 和压测环境复用
  return {
    host: env.PROD_API_HOST || env.BENCH_HOST || env.STRESS_HOST || "127.0.0.1",
    port: Number(env.PROD_API_PORT || env.BENCH_PORT || env.STRESS_PORT || 3910),
    metricsToken: env.PROD_API_METRICS_TOKEN || "local-benchmark-token",
    maxBodySize: Number(env.PROD_API_MAX_BODY_SIZE || 1_048_576),
    keepAliveTimeout: Number(env.PROD_API_KEEP_ALIVE_TIMEOUT || 65_000),
    headersTimeout: Number(env.PROD_API_HEADERS_TIMEOUT || 60_000),
    requestTimeout: Number(env.PROD_API_REQUEST_TIMEOUT || 120_000),
    maxConnections: Number(env.PROD_API_MAX_CONNECTIONS || 0),
    trustProxy: env.PROD_API_TRUST_PROXY === "1",
    sqlitePath:
      env.PROD_API_SQLITE_PATH ||
      fileURLToPath(new URL("../../../data/performance.sqlite", import.meta.url)),
    redisHost: env.PROD_API_REDIS_HOST || "127.0.0.1",
    redisPort: Number(env.PROD_API_REDIS_PORT || 6379),
    redisDatabase: Number(env.PROD_API_REDIS_DB || 0),
    redisKeyPrefix: env.PROD_API_REDIS_KEY_PREFIX || "nova-http:performance",
  };
}
