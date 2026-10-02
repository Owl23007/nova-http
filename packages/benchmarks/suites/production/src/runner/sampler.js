import { requestJson } from "./http-client.js";

export function startMetricSampler(config) {
  // 采样器定时拉取服务内部 metrics，用于补齐 autocannon 不提供的 CPU/内存指标
  const samples = [];
  let previous = null;
  let stopped = false;

  async function sample() {
    if (stopped) return;

    try {
      const current = await requestJson(`${config.baseUrl}/__metrics`, {
        headers: { "x-benchmark-token": config.metricsToken },
      });

      let cpuPercent = 0;
      if (previous) {
        // CPU 使用率按进程 CPU 时间增量 / 墙钟时间增量计算，单核满载约等于 100%
        const cpuDeltaMicros =
          current.cpuUsage.user +
          current.cpuUsage.system -
          previous.cpuUsage.user -
          previous.cpuUsage.system;
        const wallDeltaMicros = Math.max((current.timestamp - previous.timestamp) * 1000, 1);
        cpuPercent = (cpuDeltaMicros / wallDeltaMicros) * 100;
      }

      samples.push({
        timestamp: current.timestamp,
        cpuPercent,
        rssBytes: current.memory.rss,
        heapUsedBytes: current.memory.heapUsed,
        externalBytes: current.memory.external,
        eventLoopUtilization: current.eventLoop.utilization,
        eventLoopDelayP99Ms: current.eventLoop.delayP99Ms,
        appResponses: current.app.responses,
        appErrors: current.app.errors,
      });
      previous = current;
    } catch (error) {
      samples.push({
        timestamp: Date.now(),
        error: error.message,
      });
    }
  }

  const timer = setInterval(() => {
    void sample();
  }, config.sampleIntervalMs);

  void sample();

  return {
    samples,
    stop: async () => {
      clearInterval(timer);
      await sample();
      stopped = true;
    },
  };
}

export function summarizeSamples(samples) {
  // 报告只汇总数值采样点；偶发采样错误保留在 raw samples 中方便排查
  const numericSamples = samples.filter((sample) => typeof sample.cpuPercent === "number");
  if (numericSamples.length === 0) {
    return {
      count: 0,
      avgCpuPercent: 0,
      maxCpuPercent: 0,
      minRssBytes: 0,
      maxRssBytes: 0,
      rssDeltaBytes: 0,
      maxHeapUsedBytes: 0,
      maxEventLoopDelayP99Ms: 0,
    };
  }

  const rss = numericSamples.map((sample) => sample.rssBytes);

  return {
    count: numericSamples.length,
    avgCpuPercent:
      numericSamples.reduce((sum, sample) => sum + sample.cpuPercent, 0) / numericSamples.length,
    maxCpuPercent: Math.max(...numericSamples.map((sample) => sample.cpuPercent)),
    minRssBytes: Math.min(...rss),
    maxRssBytes: Math.max(...rss),
    rssDeltaBytes: rss[rss.length - 1] - rss[0],
    maxHeapUsedBytes: Math.max(...numericSamples.map((sample) => sample.heapUsedBytes)),
    maxEventLoopDelayP99Ms: Math.max(...numericSamples.map((sample) => sample.eventLoopDelayP99Ms)),
  };
}
