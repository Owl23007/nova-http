import { describe, it, expect } from "vitest";
import { run } from "../runner/engine.js";
import { orderForRound, profiles } from "../config/profiles.js";
import { metrics, stats, digest, summarize, validateRecord } from "../report/results.js";
import { scenarios } from "../suites/http/scenarios.js";

const raw = {
  requests: { average: 100 },
  throughput: { average: 1000 },
  latency: { p50: 1, p90: 2, p99: 3, average: 1.5 },
  errors: 0,
  timeouts: 0,
  non2xx: 0,
  mismatches: 0,
};
describe("独立测量和统计", () => {
  it("轮换顺序且不修改原列表", () => {
    const ids = ["a", "b", "c"];
    expect(orderForRound(ids, 1)).toEqual(["b", "c", "a"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });
  it("拒绝缺失值并保留零有效轮数", () => {
    expect(() => metrics({})).toThrow();
    expect(stats([]).median).toBeNull();
    expect(stats([1, 2, 3, 4]).median).toBe(2.5);
  });
  it("每轮重启且只记录正式结果，异常仍清理", async () => {
    let starts = 0;
    let stops = 0;
    const durations = [];
    const records = await run({
      targets: [{ id: "a" }, { id: "b" }],
      scenario: scenarios.text,
      scenarioName: "text",
      profile: { ...profiles.smoke, rounds: 2, warmup: 2 },
      profileName: "smoke",
      metadata: {},
      start: async () => {
        starts++;
        return {
          port: 1,
          stop: async () => {
            stops++;
          },
          log: () => "",
        };
      },
      check: async () => ({}),
      pipeline: async () => {},
      load: async (_port, _scenario, _profile, duration) => {
        durations.push(duration);
        return {
          raw: { ...raw, requests: { average: duration === 2 ? 999 : 100 } },
          checked: 1,
          invalid: 0,
          sampling: "all-responses",
        };
      },
    });
    expect(starts).toBe(4);
    expect(stops).toBe(4);
    expect(durations).toEqual([2, 1, 2, 1, 2, 1, 2, 1]);
    expect(records[0].statistics.qps.mean).toBe(100);
  });
  it("失败不计分且释放进程", async () => {
    let stopped = false;
    const [record] = await run({
      targets: [{ id: "a" }],
      scenario: scenarios.text,
      scenarioName: "text",
      profile: profiles.smoke,
      profileName: "smoke",
      metadata: {},
      start: async () => ({
        port: 1,
        stop: async () => {
          stopped = true;
        },
        log: () => "",
      }),
      check: async () => {
        throw new Error("响应错误");
      },
    });
    expect(stopped).toBe(true);
    expect(record.statistics.qps.count).toBe(0);
    expect(record.rounds[0].reason).toBe("响应错误");
  });
  it("校验摘要和可重算统计", () => {
    const round = {
      status: "success",
      round: 0,
      raw,
      rawDigest: digest(raw),
      metrics: metrics(raw),
      checked: 1,
      invalid: 0,
      sampling: "all-responses",
    };
    const record = {
      schemaVersion: 1,
      suite: "http-v1",
      target: { id: "node", version: "24" },
      metadata: { environment: { node: "24" }, source: {} },
      load: { profile: "smoke", rounds: 1 },
      rounds: [round],
      statistics: summarize([round]),
    };
    expect(validateRecord(record)).toBe(record);
    round.rawDigest = "fake";
    expect(() => validateRecord(record)).toThrow();
  });
});
