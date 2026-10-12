import { createHash } from "node:crypto";

export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function stats(values) {
  if (!values.length)
    return { count: 0, median: null, mean: null, standardDeviation: null, cv: null };
  if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new Error("Invalid statistics data");
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
    if (!Number.isFinite(value) || value < 0) throw new Error(`Missing or invalid metric: ${key}`);
  return result;
}

export function summarize(rounds) {
  const valid = rounds.filter((r) => r.status === "success");
  return {
    qps: stats(valid.map((r) => r.metrics.qps)),
    roundP99: stats(valid.map((r) => r.metrics.p99)),
  };
}

const invalidRecord = () => {
  throw new Error("Invalid result schema or integrity");
};

export function validateRecord(record) {
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
    invalidRecord();
  for (const round of record.rounds) {
    if (
      !["success", "failed"].includes(round.status) ||
      !Number.isInteger(round.round) ||
      round.round < 0 ||
      !Number.isFinite(Date.parse(round.measuredAt))
    )
      invalidRecord();
    if (round.status === "failed") {
      if (!round.reason) invalidRecord();
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
      invalidRecord();
    if (["errors", "timeouts", "non2xx", "mismatches"].some((key) => round.metrics[key] !== 0))
      invalidRecord();
  }
  if (digest(summarize(record.rounds)) !== digest(record.statistics)) invalidRecord();
  return record;
}

const display = (value, digits = 2) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)).toLocaleString("en-US") : "n/a";

const targetNames = {
  "nova-current": "Nova",
  "nova-baseline": "Nova (Previous Release)",
  "fastify-schema": "Fastify (Schema)",
  "fastify-no-schema": "Fastify (No Schema)",
  "node-http": "Node HTTP",
};

export function formatTargetName(id) {
  return (
    targetNames[id] ??
    id
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

const markdownCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

export function summary(records, { heading = "#" } = {}) {
  const baseline = records.find((record) => record.target.baseline);
  const target = records.find((record) => record.target.id === "nova-current");
  const reference = baseline ?? records.find((record) => record.target.id === "node-http");
  const first = records[0];
  const environment = first?.metadata.environment ?? {};
  const load = first?.load ?? {};
  const paired =
    baseline &&
    target &&
    digest(baseline.load) === digest(target.load) &&
    digest(baseline.metadata.environment) === digest(target.metadata.environment) &&
    baseline.statistics.qps.count === baseline.load.rounds &&
    target.statistics.qps.count === target.load.rounds &&
    baseline.statistics.qps.median > 0;
  const notes = [];
  if (records.some((record) => record.metadata.methodologyChanged))
    notes.push(
      "This change modifies the benchmark methodology. Paired results describe performance under the new driver and are not directly comparable with earlier archives.",
    );
  if (paired)
    notes.push(
      `The same-batch Nova-to-baseline median QPS ratio is ${(target.statistics.qps.median / baseline.statistics.qps.median).toFixed(3)}. Treat this as a descriptive comparison only.`,
    );
  const referenceName = reference ? formatTargetName(reference.target.id) : null;
  const relativeQps = (record) => {
    if (!reference || reference.statistics.qps.median <= 0 || record.statistics.qps.median === null)
      return "n/a";
    const ratio = (record.statistics.qps.median / reference.statistics.qps.median - 1) * 100;
    return `${ratio >= 0 ? "+" : ""}${display(ratio)}%`;
  };
  return [
    `${heading} HTTP Benchmark`,
    "",
    "> [!NOTE]",
    "> Results are descriptive. Compare targets within the same batch; cross-batch values may be affected by runner hardware, images, and system load.",
    "",
    ...notes.flatMap((note) => ["> [!WARNING]", `> ${note}`, ""]),
    `${heading}# Run Configuration`,
    "",
    "| Field | Value |",
    "| :--- | :--- |",
    `| Measured at | ${first?.measuredAt ? `\`${first.measuredAt}\`` : "n/a"} |`,
    `| Scenario | \`${load.scenario ?? "n/a"}\` · ${load.method ?? "n/a"} |`,
    `| Workload | ${load.connections ?? "n/a"} connections · pipeline ${load.pipelining ?? "n/a"} · \`${load.load ?? "legacy"}\` |`,
    `| Timing | ${load.warmup ?? "n/a"} s warm-up · ${load.rounds ?? "n/a"} × ${load.duration ?? "n/a"} s measured rounds |`,
    `| Runtime | Node ${environment.node ?? "n/a"} · ${environment.os ?? "n/a"}/${environment.arch ?? "n/a"} |`,
    `| Runner | ${markdownCell(environment.cpu ?? "n/a")} · ${environment.cores ?? "n/a"} cores · ${environment.memory ? `${display(environment.memory / 1024 ** 3)} GiB` : "memory n/a"} |`,
    "",
    `${heading}# Results`,
    "",
    referenceName
      ? `QPS deltas use **${referenceName}** from this batch as the reference. Higher QPS and lower p99 are better.`
      : "Higher QPS and lower p99 are better.",
    "",
    `| Target | Median QPS | ${referenceName ? `vs ${referenceName}` : "Relative QPS"} | Median p99 | QPS CV | Valid rounds |`,
    "| :--- | ---: | ---: | ---: | ---: | ---: |",
    ...records.map(
      (r) =>
        `| ${markdownCell(formatTargetName(r.target.id))} | ${display(r.statistics.qps.median)} | ${relativeQps(r)} | ${display(r.statistics.roundP99.median)} ms | ${display(r.statistics.qps.cv === null ? null : r.statistics.qps.cv * 100)}% | ${r.statistics.qps.count}/${r.load.rounds} |`,
    ),
    "",
    "<details>",
    "<summary><strong>Round details</strong></summary>",
    "",
    "| Target | Round | Status | QPS | p99 | Throughput | Failures |",
    "| :--- | ---: | :--- | ---: | ---: | ---: | ---: |",
    ...records.flatMap((record) =>
      record.rounds.map((round) =>
        round.status === "success"
          ? `| ${markdownCell(formatTargetName(record.target.id))} | ${round.round + 1} | Passed | ${display(round.metrics.qps)} | ${display(round.metrics.p99)} ms | ${display(round.metrics.throughput)} B/s | ${round.metrics.errors + round.metrics.timeouts + round.metrics.non2xx + round.metrics.mismatches} |`
          : `| ${markdownCell(formatTargetName(record.target.id))} | ${round.round + 1} | Failed — ${markdownCell(round.reason)} | n/a | n/a | n/a | n/a |`,
      ),
    ),
    "",
    "</details>",
    "",
    `${heading}# Interpretation Notes`,
    "",
    "- Smoke runs verify functionality only. A small number of rounds or a high CV is not sufficient evidence of a significant improvement.",
    "- Median p99 is the median of the per-round p99 values, not a percentile recomputed from all requests.",
    "- Prefer same-batch comparisons over absolute values from different batches.",
    "",
  ].join("\n");
}
