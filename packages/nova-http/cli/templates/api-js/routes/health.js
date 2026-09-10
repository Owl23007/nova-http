const { createApp } = require("nova-http");

const router = createApp();

/**
 * GET /health
 * 健康检查端点，用于负载均衡器 / k8s liveness probe
 */
router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    node: process.version,
  });
});

module.exports = { healthRouter: router };
