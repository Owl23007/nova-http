import { createProductionApp } from "./create-app.js";

// 服务启动入口只负责生命周期编排；业务路由、中间件和基础设施都在 create-app.js 中组装
const { app, config, close, readiness } = await createProductionApp();
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  // 进入关闭流程后立即摘掉 ready，避免压测或上游继续把新流量打进来
  readiness.setReady(false);
  process.stdout.write(`[performance-api] received ${signal}, shutting down\n`);

  try {
    // close 会统一释放 Nova 服务、SQLite、Redis 和事件循环监控资源
    await close();
  } catch (error) {
    console.error("[performance-api] graceful shutdown failed", error);
  } finally {
    process.exit(0);
  }
}

// 本地手动停止和压测 runner 回收子进程都会走同一套优雅关闭逻辑
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

app
  .listen(config.port, config.host, () => {
    // 只有 listen 成功后才标记 ready，runner 会等待 /health/ready 再开始预热和压测
    readiness.setReady(true);
    process.stdout.write(`PERFORMANCE_API_READY http://${config.host}:${config.port}\n`);
  })
  .catch((error) => {
    console.error("[performance-api] server start failed", error);
    process.exit(1);
  });
