export function registerRoutes(app, { metrics, metricsToken, readiness }) {
  // live 不依赖外部资源；ready 只在服务完成启动后才返回成功
  app.get("/health/live", (_req, res) => {
    res.send("ok");
  });

  app.get("/health/ready", (_req, res) => {
    if (!readiness.isReady()) {
      res.status(503).json({ ok: false, status: "starting" });
      return;
    }

    res.json({ ok: true, status: "ready" });
  });

  // 指标接口只服务压测工具；未携带 token 时返回 404，避免暴露内部观测面
  app.get("/__metrics", (req, res) => {
    if (req.getHeader("x-benchmark-token") !== metricsToken) {
      res.status(404).send("Not Found");
      return;
    }

    res.json(metrics.snapshot());
  });
}
