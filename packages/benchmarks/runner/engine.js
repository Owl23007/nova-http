import { orderForRound } from "../config/profiles.js";
import { startTarget } from "./process.js";
import { validate, validatePipeline } from "../suites/http/validate.js";
import { measure } from "../suites/http/driver.js";
import { digest, metrics, summarize } from "../report/results.js";

export async function run({
  targets,
  scenario,
  scenarioName,
  profile,
  profileName,
  metadata,
  signal,
  onRecord = async (_record) => {},
  start = startTarget,
  check = validate,
  pipeline = validatePipeline,
  load = measure,
}) {
  const records = targets.map((target) => ({
    schemaVersion: 1,
    suite: "http-v1",
    adapterVersion: 1,
    target,
    metadata,
    measuredAt: new Date().toISOString(),
    load: {
      ...profile,
      profile: profileName,
      scenario: scenarioName,
      method: scenario.method,
      bodyBytes: Buffer.byteLength(scenario.body ?? ""),
      configDigest: digest({ profile, scenario }),
    },
    rounds: [],
    statistics: summarize([]),
  }));
  for (let round = 0; round < profile.rounds; round++) {
    const order = orderForRound(targets, round);
    for (const target of order) {
      const record = records.find((r) => r.target.id === target.id);
      const result = {
        round,
        order: order.map((t) => t.id),
        measuredAt: new Date().toISOString(),
        status: "failed",
      };
      let server;
      try {
        if (signal?.aborted) throw new Error("运行取消");
        server = await start(target, scenarioName, { signal });
        result.responseHeaders = await check(server.port, scenario);
        await pipeline(server.port, scenario);
        result.validation = {
          before: true,
          pipelineBefore: true,
          after: false,
          pipelineAfter: false,
        };
        const warmup = await load(server.port, scenario, profile, profile.warmup, {
          signal,
          child: server.child,
        });
        const warmMetrics = metrics(warmup.raw);
        result.warmup = warmup;
        if (
          warmup.invalid ||
          !warmup.checked ||
          ["errors", "timeouts", "non2xx", "mismatches"].some((key) => warmMetrics[key] > 0)
        )
          throw new Error("预热失败");
        Object.assign(
          result,
          await load(server.port, scenario, profile, profile.duration, {
            signal,
            child: server.child,
          }),
        );
        result.rawDigest = digest(result.raw);
        result.metrics = metrics(result.raw);
        await check(server.port, scenario);
        result.validation.after = true;
        await pipeline(server.port, scenario);
        result.validation.pipelineAfter = true;
        if (
          result.invalid ||
          !result.checked ||
          ["errors", "timeouts", "non2xx", "mismatches"].some((key) => result.metrics[key] > 0)
        )
          throw new Error("测量存在连接、超时、状态码或语义错误");
        result.status = "success";
      } catch (error) {
        result.reason = error.message;
      } finally {
        if (server) {
          await server.stop();
          result.serverLog = server.log();
        }
      }
      record.rounds.push(result);
      record.statistics = summarize(record.rounds);
      await onRecord(record);
    }
  }
  return records;
}
