import { readStressConfig } from "./config.js";
import { scenarios } from "./scenarios.js";
import { runAutocannon } from "./autocannon.js";
import { requestOk } from "./http-client.js";
import { startMetricSampler, summarizeSamples } from "./sampler.js";
import { startServerProcess, stopServerProcess } from "./server-process.js";
import { hasBudgetFailure, normalizeResult, printSummary, writeReport } from "./report.js";

const stressConfig = readStressConfig();

async function main() {
  // 压测流程：启动服务 -> 等待 ready -> 逐场景预热和压测 -> 汇总报告 -> 关闭服务
  const server = startServerProcess(stressConfig);

  try {
    await waitForServerReady(stressConfig, server);

    const scenarioResults = [];
    for (const scenario of scenarios) {
      scenarioResults.push(await runScenario(stressConfig, scenario));
    }

    const normalizedResults = scenarioResults.map((item) => item.normalized);
    printSummary(stressConfig, normalizedResults);

    const outputFile = writeReport(stressConfig, scenarioResults);
    process.stdout.write(`\n[stress] raw results saved: ${outputFile}\n`);

    if (hasBudgetFailure(stressConfig, normalizedResults)) {
      process.exitCode = 1;
    }
  } finally {
    await stopServerProcess(server.process);
    const stderr = server.getStderr().trim();
    if (stderr) {
      process.stderr.write(`[stress] server stderr:\n${stderr}\n`);
    }
  }
}

async function runScenario(runConfig, scenario) {
  process.stdout.write(`[stress] warmup ${scenario.name}\n`);
  // 每个场景先预热，降低 JIT、连接建立、缓存冷启动对正式结果的影响
  await runAutocannon(runConfig, scenario, runConfig.warmupDuration);
  await sleep(1000);

  process.stdout.write(`[stress] running ${scenario.name}\n`);
  const sampler = startMetricSampler(runConfig);

  try {
    const result = await runAutocannon(runConfig, scenario, runConfig.duration);
    await sampler.stop();
    return {
      normalized: normalizeResult(scenario, result, sampler.samples, summarizeSamples),
      raw: result,
      samples: sampler.samples,
    };
  } catch (error) {
    await sampler.stop();
    throw error;
  }
}

async function waitForServerReady(runConfig, server, timeoutMs = 15_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { exitCode, signalCode } = server.getExitStatus();
    if (exitCode !== null || signalCode !== null) {
      const stderr = server.getStderr().trim();
      throw new Error(
        [
          `[stress] server exited before becoming ready`,
          `[stress] exit: ${exitCode ?? signalCode}`,
          stderr || "(no stderr)",
        ].join("\n"),
      );
    }

    if (await requestOk(`${runConfig.baseUrl}/health/ready`)) return;
    await sleep(250);
  }

  const stdout = server.getStdout().trim();
  const stderr = server.getStderr().trim();
  throw new Error(
    [
      `[stress] server did not become ready in ${timeoutMs}ms`,
      stdout ? `[stress] server stdout:\n${stdout}` : "",
      stderr ? `[stress] server stderr:\n${stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
