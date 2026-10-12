import { stats } from "../../report/results.js";

const number = (value) => (Number.isFinite(value) ? value.toFixed(2) : "n/a");
const median = (rounds, side, key) =>
  stats(rounds.map((r) => r.resources[side][key]).filter(Number.isFinite)).median;
export function report(records, micro, preset) {
  // 失败轮次保留原因，不进入统计，也不把缺失的资源指标补成零
  return [
    "# Breakdown 诊断报告",
    "",
    `配置：${preset}，smoke 仅验证功能，CPU profile 会引入额外开销`,
    "CPU % 为进程 CPU 时间 / 墙钟时间，100% 表示一个核，包含运行时辅助线程；RSS 为窗口结束时快照，不是峰值；GC 和事件循环数据仅用于观察",
    "消融对照和组件微基准不能相加作为请求耗时占比；direct 只绕过应用分发，preencoded 只移除 JSON.stringify，所有响应仍经过完整校验",
    "",
    "| 场景 | 负载 | 目标 | 有效轮数 | QPS 中位数 | CV % | p99 ms | 客户端 CPU % | 服务端 CPU % | 客户端 ELU | 服务端 ELU | 服务端 GC ms |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...records.map((r) => {
      const valid = r.rounds.filter((round) => round.status === "success");
      return `| ${r.load.scenario} | ${r.cell} | ${r.target.id} | ${valid.length}/${r.load.rounds} | ${number(r.statistics.qps.median)} | ${number(r.statistics.qps.cv === null ? null : r.statistics.qps.cv * 100)} | ${number(r.statistics.roundP99.median)} | ${number(median(valid, "client", "cpuPercent"))} | ${number(median(valid, "server", "cpuPercent"))} | ${number(median(valid, "client", "eventLoopUtilization"))} | ${number(median(valid, "server", "eventLoopUtilization"))} | ${number(median(valid, "server", "gcMs"))} |`;
    }),
    "",
    ...records.flatMap((r) =>
      r.rounds
        .filter((round) => round.status === "failed")
        .map(
          (round) =>
            `- FAILED ${r.load.scenario}/${r.cell}/${r.target.id} round ${round.round}: ${round.reason}`,
        ),
    ),
    "",
    "| 场景 / 负载 / 目标 | 客户端 user ms | 客户端 system ms | 服务端 user ms | 服务端 system ms | 服务端事件循环 p99 ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...records.map((r) => {
      const valid = r.rounds.filter((round) => round.status === "success");
      return `| ${r.load.scenario} / ${r.cell} / ${r.target.id} | ${number(median(valid, "client", "cpuUserMs"))} | ${number(median(valid, "client", "cpuSystemMs"))} | ${number(median(valid, "server", "cpuUserMs"))} | ${number(median(valid, "server", "cpuSystemMs"))} | ${number(median(valid, "server", "eventLoopDelayP99Ms"))} |`;
    }),
    "",
    "| 独立组件 | ns/op 中位数 | CV % |",
    "| --- | ---: | ---: |",
    ...micro.map(
      (r) => `| ${r.id} | ${number(r.statistics.median)} | ${number(r.statistics.cv * 100)} |`,
    ),
    "",
    "解读：高 CV 需要在低干扰环境复测；客户端繁忙而服务端有余量，提示压测驱动或传输限制；服务端繁忙时应查看对应 profile；两端 CPU 均低可能存在调度或传输等待，不能据此证明具体操作系统或硬件原因",
    "",
  ].join("\n");
}

export function compare(local, remote) {
  // 可比性检查采用保守策略，跨环境比值和高波动样本不能当作回归证据
  const rows = [];
  for (const left of local) {
    const right = remote.find((r) => r.target.id === left.target.id);
    if (!right) continue;
    const differences = [];
    for (const key of [
      "scenario",
      "profile",
      "connections",
      "pipelining",
      "warmup",
      "duration",
      "rounds",
      "configDigest",
    ])
      if (left.load[key] !== right.load[key]) differences.push(`load.${key}`);
    for (const key of [
      "node",
      "autocannon",
      "fastify",
      "os",
      "release",
      "arch",
      "cpu",
      "cores",
      "memory",
      "runnerImageVersion",
    ])
      if (left.metadata.environment[key] !== right.metadata.environment[key])
        differences.push(`environment.${key}`);
    if (left.target.sha !== right.target.sha) differences.push("target.sha");
    if (left.metadata.driverSha !== right.metadata.driverSha) differences.push("driverSha");
    if (left.metadata.dirty || right.metadata.dirty || left.target.dirty || right.target.dirty)
      differences.push("dirty checkout");
    const complete = [left, right].every(
      (r) =>
        r.statistics.qps.count === r.load.rounds &&
        r.rounds.length === r.load.rounds &&
        r.rounds.every((round) => round.status === "success"),
    );
    const noisy = [left, right].some((r) => r.statistics.qps.cv > 0.05);
    rows.push({
      target: left.target.id,
      localQps: left.statistics.qps.median,
      remoteQps: right.statistics.qps.median,
      localCV: left.statistics.qps.cv,
      remoteCV: right.statistics.qps.cv,
      differences,
      complete,
      noisy,
      comparable: complete && !noisy && !differences.length && left.load.profile !== "smoke",
    });
  }
  return rows;
}
