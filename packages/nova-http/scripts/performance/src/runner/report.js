import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeResult(scenario, result, samples, summarizeSamples) {
  // 将 autocannon 原始结果和资源采样统一成稳定 JSON schema，便于 CI 或历史对比消费。
  const requests = result.requests?.total || 0;
  const failures = (result.errors || 0) + (result.timeouts || 0) + (result.non2xx || 0);
  const attempts = requests + failures;
  const errorRate = attempts > 0 ? failures / attempts : 0;

  return {
    scenario: scenario.name,
    method: scenario.method,
    path: scenario.path,
    qps: result.requests?.average ?? 0,
    avgLatencyMs: result.latency?.average ?? 0,
    p975LatencyMs: result.latency?.p97_5 ?? 0,
    p99LatencyMs: result.latency?.p99 ?? 0,
    maxLatencyMs: result.latency?.max ?? 0,
    throughputBytesPerSec: result.throughput?.average ?? 0,
    requests,
    failures,
    errors: result.errors ?? 0,
    timeouts: result.timeouts ?? 0,
    non2xx: result.non2xx ?? 0,
    errorRate,
    resource: summarizeSamples(samples),
  };
}

export function printSummary(config, results) {
  // 控制台只打印核心指标，完整原始数据写入 reports/*.json。
  process.stdout.write("\nStress test config\n");
  process.stdout.write(`- target: ${config.baseUrl}\n`);
  process.stdout.write(`- duration: ${config.duration}s\n`);
  process.stdout.write(`- warmup: ${config.warmupDuration}s\n`);
  process.stdout.write(`- connections: ${config.connections}\n`);
  process.stdout.write(`- pipelining: ${config.pipelining}\n`);
  process.stdout.write(
    `- budgets: errorRate <= ${config.budgets.maxErrorRate}, p99 <= ${config.budgets.maxP99LatencyMs}ms\n\n`,
  );

  const header = [
    pad("Scenario", 14),
    pad("QPS", 12),
    pad("Avg(ms)", 10),
    pad("P97.5(ms)", 10),
    pad("P99(ms)", 10),
    pad("ErrRate", 10),
    pad("CPU avg/max", 16),
    pad("RSS delta", 12),
    "Result",
  ].join(" ");

  process.stdout.write(`${header}\n`);
  process.stdout.write(`${"-".repeat(header.length)}\n`);

  for (const item of results) {
    const passed =
      item.errorRate <= config.budgets.maxErrorRate &&
      item.p99LatencyMs <= config.budgets.maxP99LatencyMs;
    const row = [
      pad(item.scenario, 14),
      pad(formatInt(item.qps), 12),
      pad(formatNumber(item.avgLatencyMs), 10),
      pad(formatNumber(item.p975LatencyMs), 10),
      pad(formatNumber(item.p99LatencyMs), 10),
      pad(`${formatNumber(item.errorRate * 100, 3)}%`, 10),
      pad(
        `${formatNumber(item.resource.avgCpuPercent, 1)}/${formatNumber(
          item.resource.maxCpuPercent,
          1,
        )}%`,
        16,
      ),
      pad(`${formatNumber(item.resource.rssDeltaBytes / 1024 / 1024, 2)}MB`, 12),
      passed ? "PASS" : "FAIL",
    ].join(" ");
    process.stdout.write(`${row}\n`);
  }
}

export function writeReport(config, scenarioResults) {
  const normalizedResults = scenarioResults.map((item) => item.normalized);
  const reportsDir = fileURLToPath(new URL("../../reports/", import.meta.url));
  fs.mkdirSync(reportsDir, { recursive: true });

  const outputFile = path.join(reportsDir, `stress-test-${Date.now()}.json`);

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        node: process.version,
        config,
        results: normalizedResults,
        rawResults: scenarioResults.map((item) => ({
          scenario: item.normalized.scenario,
          raw: item.raw,
          samples: item.samples,
        })),
      },
      null,
      2,
    ),
  );

  return outputFile;
}

export function hasBudgetFailure(config, results) {
  // 性能预算失败时返回非零退出码，方便在 CI 中做回归门禁。
  return results.some(
    (item) =>
      item.errorRate > config.budgets.maxErrorRate ||
      item.p99LatencyMs > config.budgets.maxP99LatencyMs,
  );
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function formatInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return Math.round(value).toLocaleString("en-US");
}

function formatNumber(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}
