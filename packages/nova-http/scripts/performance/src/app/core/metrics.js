import { monitorEventLoopDelay, performance } from "node:perf_hooks";

export function createMetricsRegistry() {
  // event loop delay 与 ELU 用于判断高并发下是否出现明显主线程阻塞
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  const statusCounts = new Map();

  let responses = 0;
  let errors = 0;
  let totalDurationMs = 0;
  let maxDurationMs = 0;
  let lastElu = performance.eventLoopUtilization();

  eventLoopDelay.enable();

  return {
    onResponse({ durationMs, statusCode }) {
      responses += 1;
      totalDurationMs += durationMs;
      maxDurationMs = Math.max(maxDurationMs, durationMs);
      statusCounts.set(statusCode, (statusCounts.get(statusCode) || 0) + 1);
    },

    onError() {
      errors += 1;
    },

    snapshot() {
      // ELU 采用增量统计，压测采样器每次读取到的是上一次采样后的利用率
      const elu = performance.eventLoopUtilization(lastElu);
      lastElu = performance.eventLoopUtilization();

      return {
        pid: process.pid,
        uptimeSeconds: process.uptime(),
        timestamp: Date.now(),
        cpuUsage: process.cpuUsage(),
        memory: process.memoryUsage(),
        eventLoop: {
          utilization: elu.utilization,
          delayMeanMs: eventLoopDelay.mean / 1e6,
          delayMaxMs: eventLoopDelay.max / 1e6,
          delayP99Ms: eventLoopDelay.percentile(99) / 1e6,
        },
        app: {
          responses,
          errors,
          avgDurationMs: responses > 0 ? totalDurationMs / responses : 0,
          maxDurationMs,
          statusCounts: Object.fromEntries(statusCounts),
        },
      };
    },

    close() {
      eventLoopDelay.disable();
    },
  };
}
