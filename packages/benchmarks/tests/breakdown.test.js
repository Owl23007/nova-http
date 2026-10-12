import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loads, matrix, select } from "../suites/breakdown/config.js";
import { microCases } from "../suites/breakdown/micro.js";
import { requestProbe } from "../suites/breakdown/telemetry.js";
import { compare, report } from "../suites/breakdown/report.js";
import { summarizeProfile } from "../suites/breakdown/profile.js";
import { startTarget } from "../runner/process.js";
import { validate, validatePipeline } from "../suites/http/validate.js";
import { scenarios } from "../suites/http/scenarios.js";
import { measure } from "../suites/http/driver.js";
const require = createRequire(import.meta.url);

it("组件微基准在独立进程中运行并返回完整轮次", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("../suites/breakdown/micro-worker.js", import.meta.url)),
    JSON.stringify({ iterations: 50, rounds: 2 }),
  ]);
  const results = JSON.parse(stdout);
  expect(results).toHaveLength(12);
  for (const result of results) {
    expect(result.rounds).toHaveLength(2);
    expect(result.statistics.count).toBe(2);
    expect(result.statistics.median).toBeGreaterThan(0);
  }
});

it("profile 按采样时间保留 idle，不能把命中次数当成耗时占比", () => {
  const summary = summarizeProfile({
    nodes: [
      { id: 1, callFrame: { functionName: "work", url: "test.js", lineNumber: 0 } },
      { id: 2, callFrame: { functionName: "(idle)", url: "", lineNumber: -1 } },
    ],
    samples: [1, 1, 2],
    timeDeltas: [10, 10, 80],
  });
  expect(summary.sampledUs).toBe(100);
  expect(summary.topSelf[0].function).toBe("(idle)");
  expect(summary.topSelf[0].percent).toBe(80);
});

it("covers concurrency/pipeline axes and rejects invalid or duplicate selections", () => {
  expect(Object.keys(loads)).toHaveLength(6);
  expect(() => select("c1-p1,c1-p1", loads)).toThrow();
  expect(() => select("c0-p1", loads)).toThrow();
  expect(() => select("constructor", loads)).toThrow();
  const cells = matrix(Object.keys(scenarios), Object.keys(loads), [
    { id: "nova" },
    { id: "direct", diagnostic: "direct" },
  ]);
  expect(cells).toHaveLength(30);
  expect(cells.filter((c) => c.targets.length === 2)).toHaveLength(6);
});

it("microbenchmarks perform real parsing, routing, response and dispatch work", async () => {
  for (const test of microCases()) expect(test.check(await test.run()), test.id).toBe(true);
});

for (const diagnostic of [undefined, "preencoded", "direct"]) {
  it(`diagnostic ${diagnostic ?? "normal"} preserves response/pipeline and records a CPU profile`, async () => {
    const server = await startTarget(
      { adapter: "nova", entry: require.resolve("nova-http"), diagnostic },
      "json-small",
      { server: new URL("../suites/breakdown/server.js", import.meta.url) },
    );
    try {
      await validate(server.port, scenarios["json-small"]);
      await validatePipeline(server.port, scenarios["json-small"]);
      await requestProbe(server.child, "start", true);
      const result = await measure(
        server.port,
        scenarios["json-small"],
        { connections: 2, pipelining: 10 },
        1,
        { child: server.child },
      );
      const resources = await requestProbe(server.child, "stop");
      expect(result.checked).toBeGreaterThan(0);
      expect(result.invalid).toBe(0);
      expect(result.raw.errors).toBe(0);
      expect(resources.cpuPercent).toBeGreaterThan(0);
      expect(resources.wallMs).toBeGreaterThan(500);
      expect(resources.memory.rss).toBeGreaterThan(0);
      expect(resources.profile.nodes.length).toBeGreaterThan(0);
      await expect(requestProbe(server.child, "stop")).rejects.toThrow("Probe not started");
    } finally {
      await server.stop();
    }
  });
}

it("does not label noisy, incomplete or different-method runs as comparable", () => {
  const record = {
    target: { id: "nova", sha: "a" },
    load: { rounds: 3, profile: "full", load: "pipeline-10" },
    metadata: { driverSha: "a", environment: { os: "linux" } },
    statistics: { qps: { count: 3, median: 100, cv: 0.01 } },
    rounds: Array.from({ length: 3 }, () => ({ status: "success" })),
  };
  expect(compare([record], [record])[0].comparable).toBe(true);
  const noisy = structuredClone(record);
  noisy.statistics.qps.cv = 0.33;
  noisy.metadata.environment.os = "win32";
  const row = compare([noisy], [record])[0];
  expect(row.comparable).toBe(false);
  expect(row.noisy).toBe(true);
  expect(row.differences).toContain("environment.os");
  noisy.statistics.qps.count = 2;
  expect(compare([noisy], [record])[0].complete).toBe(false);
});

it("reports failed rounds without inventing zero QPS", () => {
  const text = report(
    [
      {
        cell: "c1-p1",
        target: { id: "nova" },
        load: { scenario: "text", rounds: 1 },
        rounds: [{ status: "failed", round: 0, reason: "connection lost" }],
        statistics: { qps: { median: null, cv: null }, roundP99: { median: null } },
      },
    ],
    [],
    "smoke",
  );
  expect(text).toContain("connection lost");
  expect(text).toContain("n/a");
});
