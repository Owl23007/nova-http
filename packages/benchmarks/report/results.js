import { createHash } from "node:crypto";

export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function stats(values) {
  if (!values.length)
    return { count: 0, median: null, mean: null, standardDeviation: null, cv: null };
  if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new Error("统计数据无效");
  const sorted = [...values].toSorted((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const standardDeviation = Math.sqrt(
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length,
  );
  const middle = Math.floor(values.length / 2);
  return {
    count: values.length,
    median: values.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    mean,
    standardDeviation,
    cv: mean ? standardDeviation / mean : null,
  };
}

export function metrics(raw) {
  const result = {
    qps: raw.requests?.average,
    throughput: raw.throughput?.average,
    p50: raw.latency?.p50,
    p90: raw.latency?.p90,
    p99: raw.latency?.p99,
    latencyMean: raw.latency?.average,
    errors: raw.errors,
    timeouts: raw.timeouts,
    non2xx: raw.non2xx,
    mismatches: raw.mismatches,
  };
  for (const [key, value] of Object.entries(result))
    if (!Number.isFinite(value) || value < 0) throw new Error(`缺少或无效的指标: ${key}`);
  return result;
}

export function summarize(rounds) {
  const valid = rounds.filter((r) => r.status === "success");
  return {
    qps: stats(valid.map((r) => r.metrics.qps)),
    roundP99: stats(valid.map((r) => r.metrics.p99)),
  };
}

export function validateRecord(record) {
  const fail = () => {
    throw new Error("结果 schema 或完整性无效");
  };
  if (
    record.schemaVersion !== 1 ||
    record.suite !== "http-v1" ||
    !Number.isFinite(Date.parse(record.measuredAt)) ||
    !record.target?.id ||
    !record.target?.version ||
    !record.metadata?.environment?.node ||
    !record.metadata?.source ||
    !record.load?.profile ||
    !Array.isArray(record.rounds) ||
    record.rounds.length !== record.load.rounds
  )
    fail();
  for (const round of record.rounds) {
    if (
      !["success", "failed"].includes(round.status) ||
      !Number.isInteger(round.round) ||
      round.round < 0 ||
      !Number.isFinite(Date.parse(round.measuredAt))
    )
      fail();
    if (round.status === "failed") {
      if (!round.reason) fail();
      continue;
    }
    if (
      !round.raw ||
      digest(round.raw) !== round.rawDigest ||
      digest(metrics(round.raw)) !== digest(round.metrics) ||
      round.invalid !== 0 ||
      !["before", "after", "pipelineBefore", "pipelineAfter"].every(
        (key) => round.validation?.[key] === true,
      ) ||
      !(round.checked > 0) ||
      round.sampling !== "all-responses"
    )
      fail();
    if (["errors", "timeouts", "non2xx", "mismatches"].some((key) => round.metrics[key] !== 0))
      fail();
  }
  if (digest(summarize(record.rounds)) !== digest(record.statistics)) fail();
  return record;
}

export function summary(records) {
  const baseline = records.find((record) => record.target.baseline);
  const target = records.find((record) => record.target.id === "nova-current");
  const paired =
    baseline &&
    target &&
    digest(baseline.load) === digest(target.load) &&
    digest(baseline.metadata.environment) === digest(target.metadata.environment) &&
    baseline.statistics.qps.count === baseline.load.rounds &&
    target.statistics.qps.count === target.load.rounds &&
    baseline.statistics.qps.median > 0;
  return [
    "# HTTP benchmark",
    "",
    "同批次顺序测量；smoke 仅验证功能；三轮统计不用于宣称显著改善；轮次 p99 不是合并请求 p99",
    records.some((record) => record.metadata.methodologyChanged)
      ? "本次 PR 修改了方法学，配对结果仅表示新驱动下的表现，不与旧套件归档直接比较"
      : "",
    paired
      ? `同批次 target/baseline QPS 中位数比值：${(target.statistics.qps.median / baseline.statistics.qps.median).toFixed(3)}，仅作描述比较`
      : "",
    "",
    "| 目标 | 场景 | Profile | 有效轮数 | QPS 中位数 | QPS CV | 轮次 p99 中位数 |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: |",
    ...records.map(
      (r) =>
        `| ${r.target.id} | ${r.load.scenario} | ${r.load.profile} | ${r.statistics.qps.count}/${r.load.rounds} | ${r.statistics.qps.median ?? "failed"} | ${r.statistics.qps.cv ?? "n/a"} | ${r.statistics.roundP99.median ?? "failed"} |`,
    ),
    "",
  ].join("\n");
}
