import { performance, monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks";

// 每个负载阶段只建立一个采样窗口，避免逐请求计时或修改 socket 热路径
// CPU 百分比以一个逻辑核为 100%，包含进程内运行时辅助线程
export function createProbe() {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  let gcMs = 0;
  let gcCount = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcMs += entry.duration;
      gcCount++;
    }
  });
  observer.observe({ entryTypes: ["gc"] });
  delay.enable();
  const cpu = process.cpuUsage();
  const elu = performance.eventLoopUtilization();
  const start = performance.now();
  return () => {
    const wallMs = performance.now() - start;
    const usage = process.cpuUsage(cpu);
    const loop = performance.eventLoopUtilization(elu);
    delay.disable();
    observer.disconnect();
    return {
      wallMs,
      cpuUserMs: usage.user / 1000,
      cpuSystemMs: usage.system / 1000,
      cpuPercent: (usage.user + usage.system) / (wallMs * 10),
      eventLoopUtilization: loop.utilization,
      eventLoopDelayP99Ms: delay.count ? delay.percentile(99) / 1e6 : null,
      eventLoopDelayMaxMs: delay.count ? delay.max / 1e6 : null,
      gcMs,
      gcCount,
      memory: process.memoryUsage(),
    };
  };
}

let sequence = 0;
// 使用带序号的 IPC 请求关联采样结果，超时、退出和成功路径都移除监听器
export function requestProbe(child, action, cpuProfile = false) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", receive);
      child.off("exit", exited);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const receive = (message) => {
      if (message?.probeId !== id) return;
      cleanup();
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    };
    const exited = () => fail(new Error("Telemetry target exited"));
    const timer = setTimeout(() => fail(new Error("Telemetry IPC timed out")), 10000);
    child.on("message", receive);
    child.once("exit", exited);
    child.send({ probeId: id, action, cpuProfile }, (error) => {
      if (error) fail(error);
    });
  });
}
