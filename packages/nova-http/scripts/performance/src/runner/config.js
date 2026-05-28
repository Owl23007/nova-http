export function readStressConfig(env = process.env) {
  const host = env.STRESS_HOST || "127.0.0.1";
  const port = Number(env.STRESS_PORT || 3910);

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    duration: Number(env.STRESS_DURATION || 30),
    warmupDuration: Number(env.STRESS_WARMUP_DURATION || 5),
    connections: Number(env.STRESS_CONNECTIONS || 200),
    pipelining: Number(env.STRESS_PIPELINING || 1),
    sampleIntervalMs: Number(env.STRESS_SAMPLE_INTERVAL_MS || 1000),
    metricsToken: env.PROD_API_METRICS_TOKEN || "local-benchmark-token",
    budgets: {
      maxErrorRate: Number(env.STRESS_MAX_ERROR_RATE || 0.01),
      maxP99LatencyMs: Number(env.STRESS_MAX_P99_LATENCY_MS || 250),
    },
  };
}
